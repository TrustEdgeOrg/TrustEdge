from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy.orm import Session

from app.features.devices.models.device import Device
from app.features.dns_queries.models.dns_query import DnsQuery
from app.features.vpn.models.ip_lease import IpLease
from app.features.network_attribution.models.device_network_context import DeviceNetworkContext
from app.features.network_attribution.repositories.network_attribution_repository import (
    AppUsageRollupRepository,
    NetworkContextRepository,
)
from app.features.network_attribution.schemas.network_attribution import (
    AppUsageHourlyListResponse,
    AppUsageHourlyRead,
    AppUsageSummaryItem,
    AppUsageSummaryResponse,
    NetworkAttributionReportRequest,
    NetworkAttributionReportResponse,
    NetworkMapEdge,
    NetworkMapNode,
    NetworkMapResponse,
)
from app.features.network_attribution.services.app_catalog import normalize_app
from app.features.vpn.models.vpn_peer import VpnPeer
from app.shared.config import settings
from app.shared.domain_utils import extract_root_domain


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


@dataclass(frozen=True)
class ResolvedAttribution:
    app_slug: str
    app_display_name: str


class NetworkAttributionService:
    def __init__(self, db: Session):
        self.db = db
        self.rollup_repo = AppUsageRollupRepository(db)
        self.context_repo = NetworkContextRepository(db)

    def ingest(self, device: Device, payload: NetworkAttributionReportRequest) -> NetworkAttributionReportResponse:
        if not settings.NETWORK_ATTRIBUTION_ENABLED:
            return NetworkAttributionReportResponse(stored=False, intervals_received=0)

        latest_observed: Optional[datetime] = None
        latest_slug = ""
        latest_display = ""
        latest_bundle = ""

        for interval in payload.intervals:
            normalized = normalize_app(bundle_id=interval.bundle_id, app_name=interval.app_name)
            self.rollup_repo.add_active_seconds(
                device.id,
                app_slug=normalized.app_slug,
                app_display_name=normalized.app_display_name,
                started_at=interval.started_at,
                duration_sec=interval.duration_sec,
            )
            observed = interval.started_at
            if observed.tzinfo is None:
                observed = observed.replace(tzinfo=timezone.utc)
            observed = observed + timedelta(seconds=interval.duration_sec)
            if latest_observed is None or observed >= latest_observed:
                latest_observed = observed
                latest_slug = normalized.app_slug
                latest_display = normalized.app_display_name
                latest_bundle = interval.bundle_id.strip()

        if latest_observed is not None:
            self.context_repo.upsert(
                device.id,
                app_slug=latest_slug,
                app_display_name=latest_display,
                bundle_id=latest_bundle,
                observed_at=latest_observed,
            )

        self.db.commit()
        return NetworkAttributionReportResponse(
            stored=True,
            intervals_received=len(payload.intervals),
        )

    def resolve_attribution(self, device_id: int, query_timestamp: datetime) -> Optional[ResolvedAttribution]:
        if not settings.NETWORK_ATTRIBUTION_ENABLED:
            return None

        ctx = self.context_repo.get(device_id)
        if ctx is None:
            return None

        if query_timestamp.tzinfo is None:
            query_timestamp = query_timestamp.replace(tzinfo=timezone.utc)

        max_age = max(1, int(settings.NETWORK_ATTRIBUTION_MAX_AGE_SEC))
        observed_at = _as_utc(ctx.observed_at)
        age = abs((query_timestamp - observed_at).total_seconds())
        if age > max_age:
            return None

        return ResolvedAttribution(app_slug=ctx.app_slug, app_display_name=ctx.app_display_name)

    def list_hourly(self, device_id: int, *, hours: int = 168, app_slug: Optional[str] = None) -> AppUsageHourlyListResponse:
        hours = max(1, min(hours, 24 * 30))
        since = datetime.now(timezone.utc) - timedelta(hours=hours)
        rollups = self.rollup_repo.list_rollups(device_id, since=since, app_slug=app_slug)
        items = [
            AppUsageHourlyRead(
                window_start=r.window_start,
                hour_utc=r.hour_utc,
                app_slug=r.app_slug,
                app_display_name=r.app_display_name,
                active_seconds=r.active_seconds,
                sample_count=r.sample_count,
                active_minutes=round(r.active_seconds / 60.0, 2),
                usage_share_pct=round((r.active_seconds / 3600.0) * 100.0, 2),
            )
            for r in rollups
        ]
        return AppUsageHourlyListResponse(device_id=device_id, hours=hours, items=items)

    def summarize(self, device_id: int, *, hours: int = 168) -> AppUsageSummaryResponse:
        hours = max(1, min(hours, 24 * 30))
        since = datetime.now(timezone.utc) - timedelta(hours=hours)
        rows = self.rollup_repo.summarize(device_id, since=since)
        items = [
            AppUsageSummaryItem(
                app_slug=slug,
                app_display_name=display,
                total_active_seconds=total_sec,
                total_active_hours=round(total_sec / 3600.0, 2),
                hourly_bucket_count=buckets,
                avg_active_minutes_per_hour=round(avg_min, 2),
            )
            for slug, display, total_sec, buckets, avg_min in rows
        ]
        return AppUsageSummaryResponse(device_id=device_id, hours=hours, items=items)

    def build_map(self, *, minutes: int = 15) -> NetworkMapResponse:
        minutes = max(1, min(minutes, 60))
        now = datetime.now(timezone.utc)
        since = now - timedelta(minutes=minutes)
        max_age = max(1, int(settings.NETWORK_ATTRIBUTION_MAX_AGE_SEC))

        if not settings.NETWORK_ATTRIBUTION_ENABLED:
            return NetworkMapResponse(generated_at=now, minutes=minutes, nodes=[], edges=[])

        contexts = (
            self.db.query(DeviceNetworkContext)
            .filter(DeviceNetworkContext.observed_at >= since - timedelta(seconds=max_age))
            .all()
        )
        dns_rows = (
            self.db.query(DnsQuery)
            .filter(DnsQuery.timestamp >= since, DnsQuery.attributed_app_slug.isnot(None))
            .order_by(DnsQuery.timestamp.desc())
            .limit(400)
            .all()
        )

        device_rows = (
            self.db.query(Device.id, Device.hostname, IpLease.ip)
            .join(IpLease, Device.ip_lease_id == IpLease.id)
            .filter(IpLease.released_at.is_(None))
            .all()
        )
        ip_to_device: dict[str, tuple[int, str, str]] = {
            ip: (device_id, hostname or ip, ip) for device_id, hostname, ip in device_rows
        }
        device_meta: dict[int, tuple[str, str]] = {
            device_id: (hostname or ip, ip) for device_id, hostname, ip in device_rows
        }

        nodes: dict[str, NetworkMapNode] = {}
        edge_map: dict[tuple[str, str, str], NetworkMapEdge] = {}

        def ensure_device(device_id: int) -> str:
            node_id = f"device:{device_id}"
            if node_id not in nodes:
                label, client_ip = device_meta.get(device_id, (f"Device {device_id}", ""))
                nodes[node_id] = NetworkMapNode(
                    id=node_id,
                    type="device",
                    label=label,
                    client_ip=client_ip or None,
                    device_id=device_id,
                )
            return node_id

        def ensure_app(slug: str, display: str) -> str:
            node_id = f"app:{slug}"
            if node_id not in nodes:
                nodes[node_id] = NetworkMapNode(
                    id=node_id,
                    type="app",
                    label=display,
                    app_slug=slug,
                )
            return node_id

        def ensure_domain(domain: str, blocked: bool) -> str:
            node_id = f"domain:{domain}"
            existing = nodes.get(node_id)
            if existing is None:
                nodes[node_id] = NetworkMapNode(
                    id=node_id,
                    type="domain",
                    label=domain,
                    blocked=blocked,
                )
            elif blocked and not existing.blocked:
                nodes[node_id] = existing.model_copy(update={"blocked": True})
            return node_id

        def add_edge(source: str, target: str, kind: str, *, blocked: bool = False) -> None:
            key = (source, target, kind)
            edge = edge_map.get(key)
            if edge is None:
                edge_map[key] = NetworkMapEdge(
                    source=source,
                    target=target,
                    kind=kind,
                    query_count=1,
                    blocked_count=1 if blocked and kind == "dns" else 0,
                )
                return
            edge_map[key] = edge.model_copy(
                update={
                    "query_count": edge.query_count + 1,
                    "blocked_count": edge.blocked_count + (1 if blocked and kind == "dns" else 0),
                }
            )

        for ctx in contexts:
            device_id = f"device:{ctx.device_id}"
            ensure_device(ctx.device_id)
            app_id = ensure_app(ctx.app_slug, ctx.app_display_name)
            fresh = abs((now - _as_utc(ctx.observed_at)).total_seconds()) <= max_age
            ctx_node = nodes[device_id]
            nodes[device_id] = ctx_node.model_copy(update={"fresh": fresh})
            add_edge(device_id, app_id, "foreground")

        dns_group: dict[tuple[int, str, str], tuple[int, int]] = {}
        for row in dns_rows:
            match = ip_to_device.get(row.client_ip)
            if match is None:
                continue
            device_id, _, _ = match
            slug = (row.attributed_app_slug or "").strip()
            if not slug:
                continue
            root_domain = extract_root_domain(row.domain)
            key = (device_id, slug, root_domain)
            blocked = bool(row.blocked)
            prev = dns_group.get(key)
            if prev is None:
                dns_group[key] = (1, 1 if blocked else 0)
            else:
                dns_group[key] = (prev[0] + 1, prev[1] + (1 if blocked else 0))

        per_pair_domains: dict[tuple[int, str], list[tuple[str, int, int]]] = {}
        for (device_id, slug, domain), (count, blocked_count) in dns_group.items():
            pair = (device_id, slug)
            per_pair_domains.setdefault(pair, []).append((domain, count, blocked_count))

        for (device_id, slug), domains in per_pair_domains.items():
            domains.sort(key=lambda item: (-item[1], item[0]))
            display = next(
                (row.attributed_app_display_name for row in dns_rows if row.attributed_app_slug == slug),
                slug.replace("_", " ").title(),
            )
            device_node = ensure_device(device_id)
            app_node = ensure_app(slug, display or slug)
            add_edge(device_node, app_node, "foreground")
            for domain, count, blocked_count in domains[:8]:
                domain_node = ensure_domain(domain, blocked_count > 0)
                key = (app_node, domain_node, "dns")
                edge_map[key] = NetworkMapEdge(
                    source=app_node,
                    target=domain_node,
                    kind="dns",
                    query_count=count,
                    blocked_count=blocked_count,
                )

        attributed_roots: set[tuple[int, str]] = {
            (device_id, root_domain) for device_id, _slug, root_domain in dns_group.keys()
        }
        all_dns_rows = (
            self.db.query(DnsQuery)
            .filter(DnsQuery.timestamp >= since)
            .order_by(DnsQuery.timestamp.desc())
            .limit(400)
            .all()
        )
        direct_group: dict[tuple[int, str], tuple[int, int]] = {}
        for row in all_dns_rows:
            if (row.attributed_app_slug or "").strip():
                continue
            match = ip_to_device.get(row.client_ip)
            if match is None:
                continue
            device_id, _, _ = match
            root_domain = extract_root_domain(row.domain)
            key = (device_id, root_domain)
            if key in attributed_roots:
                continue
            blocked = bool(row.blocked)
            prev = direct_group.get(key)
            if prev is None:
                direct_group[key] = (1, 1 if blocked else 0)
            else:
                direct_group[key] = (prev[0] + 1, prev[1] + (1 if blocked else 0))

        for (device_id, root_domain), (count, blocked_count) in direct_group.items():
            device_node = ensure_device(device_id)
            domain_node = ensure_domain(root_domain, blocked_count > 0)
            key = (device_node, domain_node, "dns_direct")
            edge_map[key] = NetworkMapEdge(
                source=device_node,
                target=domain_node,
                kind="dns_direct",
                query_count=count,
                blocked_count=blocked_count,
            )

        return NetworkMapResponse(
            generated_at=now,
            minutes=minutes,
            nodes=list(nodes.values()),
            edges=list(edge_map.values()),
        )

    def enrich_dns_queries(self, queries: list) -> None:
        """Attach attributed app fields from latest endpoint context (in-place)."""
        if not settings.NETWORK_ATTRIBUTION_ENABLED or not queries:
            return

        from app.features.devices.repositories.device_repository import DeviceRepository

        device_repo = DeviceRepository(self.db)
        cache: dict[int, Optional[ResolvedAttribution]] = {}

        for q in queries:
            device = device_repo.get_by_client_ip(q.client_ip)
            if not device:
                continue
            if device.id not in cache:
                cache[device.id] = self.resolve_attribution(device.id, q.timestamp)
            resolved = cache[device.id]
            if resolved is None:
                continue
            q.attributed_app_slug = resolved.app_slug
            q.attributed_app_display_name = resolved.app_display_name

    @staticmethod
    def get_device_by_vpn_device_id(db: Session, vpn_device_id: str) -> Optional[Device]:
        peer = db.query(VpnPeer).filter(VpnPeer.device_id == vpn_device_id.strip()).first()
        if peer is None:
            return None
        lease = (
            db.query(IpLease)
            .filter(IpLease.peer_id == peer.id, IpLease.released_at.is_(None))
            .order_by(IpLease.id.desc())
            .first()
        )
        if lease is None:
            return None
        return db.query(Device).filter(Device.ip_lease_id == lease.id).first()
