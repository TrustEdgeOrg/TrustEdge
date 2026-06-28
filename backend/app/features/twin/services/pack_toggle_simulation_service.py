from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Set, Tuple

from sqlalchemy.orm import Session

from app.features.devices.models.device import Device
from app.features.dns_queries.repositories.domain_first_seen_repository import (
    DomainFirstSeenRepository,
)
from app.features.policy.pack_loader import domains_for_packs, pack_domain_counts
from app.features.policy.repositories.policy_repository import PolicyRepository
from app.features.policy.services.policy_dns_service import PolicyDnsService
from app.features.twin.domain_match import root_matches_block_set
from app.features.twin.schemas.twin_simulation import (
    DeviceSimulationImpactRead,
    PackInfoRead,
    PackStateRead,
    PackToggleSimulationResponse,
    RecentHitSample,
    SimulationSummaryRead,
)
from app.features.vpn.models.ip_lease import IpLease


class PackToggleSimulationService:
    LOOKBACK_HOURS = 24
    RECENT_HITS_SAMPLE_LIMIT = 20

    def __init__(self, db: Session):
        self.db = db
        self.policy_repo = PolicyRepository(db)
        self.dns_svc = PolicyDnsService(db)
        self.first_seen_repo = DomainFirstSeenRepository(db)

    def simulate(self, pack_slug: str, enabled_globally: bool) -> PackToggleSimulationResponse:
        pack = self.policy_repo.get_pack_by_slug(pack_slug)
        if pack is None:
            raise ValueError(f"unknown pack slug: {pack_slug}")

        now = datetime.now(timezone.utc)
        baseline = self.dns_svc.build_dns_sync()
        proposed = self.dns_svc.build_dns_sync(
            global_pack_overrides={pack_slug: enabled_globally},
        )

        baseline_blocks = self._blocks_by_device(baseline.entries)
        proposed_blocks = self._blocks_by_device(proposed.entries)
        added_by_device = self._added_blocks_by_device(baseline_blocks, proposed_blocks)

        pack_domains = domains_for_packs([pack_slug])
        domain_counts = pack_domain_counts()

        device_meta = self._device_metadata()
        recent_rows = self._recent_activity(now)
        recent_hits, device_recent = self._match_recent_hits(
            recent_rows, added_by_device, device_meta
        )

        device_impacts: List[DeviceSimulationImpactRead] = []
        for device_id, added in sorted(added_by_device.items()):
            if not added:
                continue
            hostname, _ = device_meta.get(device_id, (None, None))
            device_impacts.append(
                DeviceSimulationImpactRead(
                    device_id=device_id,
                    hostname=hostname,
                    added_block_count=len(added),
                    recent_hits=sorted(device_recent.get(device_id, [])),
                )
            )

        devices_affected = len(device_impacts)
        all_added = set().union(*added_by_device.values()) if added_by_device else set()
        newly_blocked_domain_count = len(all_added)

        return PackToggleSimulationResponse(
            generated_at=now,
            lookback_hours=self.LOOKBACK_HOURS,
            pack=PackInfoRead(
                slug=pack.slug,
                name=pack.name,
                domain_count=domain_counts.get(pack.slug, len(pack_domains)),
            ),
            current_state=PackStateRead(enabled_globally=pack.enabled_globally),
            proposed_state=PackStateRead(enabled_globally=enabled_globally),
            summary=SimulationSummaryRead(
                devices_affected=devices_affected,
                newly_blocked_domain_count=newly_blocked_domain_count,
                recent_hits_count=len(recent_hits),
                recent_hits_sample=recent_hits[: self.RECENT_HITS_SAMPLE_LIMIT],
            ),
            devices=device_impacts,
        )

    @staticmethod
    def _blocks_by_device(entries) -> Dict[int, Set[str]]:
        blocks: Dict[int, Set[str]] = {}
        for entry in entries:
            if entry.allowlist_only:
                continue
            blocks[entry.device_id] = set(entry.block_domains)
        return blocks

    @staticmethod
    def _added_blocks_by_device(
        baseline: Dict[int, Set[str]],
        proposed: Dict[int, Set[str]],
    ) -> Dict[int, Set[str]]:
        device_ids = set(baseline) | set(proposed)
        added: Dict[int, Set[str]] = {}
        for device_id in device_ids:
            delta = proposed.get(device_id, set()) - baseline.get(device_id, set())
            if delta:
                added[device_id] = delta
        return added

    def _device_metadata(self) -> Dict[int, Tuple[Optional[str], Optional[str]]]:
        rows = (
            self.db.query(Device.id, Device.hostname, IpLease.ip)
            .outerjoin(IpLease, Device.ip_lease_id == IpLease.id)
            .all()
        )
        return {device_id: (hostname, ip) for device_id, hostname, ip in rows}

    def _recent_activity(self, now: datetime) -> List[Tuple[str, str, datetime]]:
        since = now - timedelta(hours=self.LOOKBACK_HOURS)
        return self.first_seen_repo.list_recent_since(since)

    def _match_recent_hits(
        self,
        recent_rows: List[Tuple[str, str, datetime]],
        added_by_device: Dict[int, Set[str]],
        device_meta: Dict[int, Tuple[Optional[str], Optional[str]]],
    ) -> Tuple[List[RecentHitSample], Dict[int, Set[str]]]:
        ip_to_device: Dict[str, int] = {}
        for device_id, (_, ip) in device_meta.items():
            if ip:
                ip_to_device[ip] = device_id

        hits: List[RecentHitSample] = []
        device_recent: Dict[int, Set[str]] = {}

        for client_ip, root_domain, last_seen_at in recent_rows:
            device_id = ip_to_device.get(client_ip)
            if device_id is None:
                continue
            added = added_by_device.get(device_id)
            if not added or not root_matches_block_set(root_domain, added):
                continue
            hostname, _ = device_meta.get(device_id, (None, None))
            device_recent.setdefault(device_id, set()).add(root_domain)
            hits.append(
                RecentHitSample(
                    root_domain=root_domain,
                    device_id=device_id,
                    hostname=hostname,
                    last_seen_at=last_seen_at,
                    query_count_estimate=1,
                )
            )

        return hits, device_recent
