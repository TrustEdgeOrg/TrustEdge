from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Optional, Set

from sqlalchemy.orm import Session

from app.features.devices.models.device import Device
from app.features.network_attribution.schemas.network_attribution import (
    NetworkMapEdge,
    NetworkMapNode,
    NetworkMapResponse,
)
from app.features.network_attribution.services.network_attribution_service import (
    NetworkAttributionService,
)
from app.features.network_flows.services.flow_map_service import merge_flows_into_map
from app.features.network_flows.services.flow_store import StoredFlow, list_recent_flows
from app.features.policy.repositories.policy_repository import PolicyRepository
from app.features.policy.services.policy_dns_service import PolicyDnsService
from app.features.twin.graph.ids import (
    device_id,
    domain_id,
    edge_id,
    flow_session_id,
    infra_id,
    ip_id,
    l4_service_id,
    policy_pack_id,
    policy_profile_id,
    policy_rule_id,
)
from app.features.twin.graph.model import TwinGraph
from app.features.twin.graph.schemas import TwinEdge, TwinGraphSnapshot, TwinLayer, TwinNode
from app.shared.config import settings
from app.shared.domain_utils import extract_root_domain


MAP_EDGE_TO_RELATION: dict[str, str] = {
    "foreground": "runs",
    "dns": "queries",
    "dns_direct": "queries_direct",
    "dns_to_flow": "correlates",
}

INFRA_CHAIN: tuple[tuple[str, str, str], ...] = (
    ("wireguard", "ec2_gateway", "terminates_at"),
    ("ec2_gateway", "dns_resolver", "terminates_at"),
)


@dataclass
class _BuilderState:
    nodes: Dict[str, TwinNode] = field(default_factory=dict)
    edges: Dict[str, TwinEdge] = field(default_factory=dict)
    observed_domains: Set[str] = field(default_factory=set)
    device_profiles: Dict[int, int] = field(default_factory=dict)


class TwinGraphBuilder:
    """Assemble canonical twin graph from attribution, flows, and policy state."""

    def __init__(self, db: Session):
        self.db = db
        self.state = _BuilderState()

    def build(
        self,
        *,
        minutes: int = 1,
        include_flows: bool = True,
        include_policy: bool = True,
    ) -> TwinGraphSnapshot:
        attribution = NetworkAttributionService(self.db)
        base_map = attribution.build_map(minutes=minutes)
        if include_flows and settings.NETWORK_FLOWS_ENABLED:
            base_map = merge_flows_into_map(base_map, minutes=minutes)

        self._ingest_observed_map(base_map)
        if include_flows and settings.NETWORK_FLOWS_ENABLED:
            self._ingest_flow_resolutions(minutes=minutes)
        self._ingest_infra_topology()
        if include_policy:
            self._ingest_policy_layer()

        graph = TwinGraph()
        for node in self.state.nodes.values():
            graph.add_node(node)
        for edge in self.state.edges.values():
            graph.add_edge(edge)

        layer_counts = {
            layer: sum(1 for node in self.state.nodes.values() if node.layer == layer)
            for layer in ("observed", "desired", "simulated")
        }
        return graph.to_snapshot(
            generated_at=base_map.generated_at,
            window_minutes=minutes,
            meta={
                "include_flows": include_flows and settings.NETWORK_FLOWS_ENABLED,
                "include_policy": include_policy,
                "node_count": len(self.state.nodes),
                "edge_count": len(self.state.edges),
                "layer_counts": layer_counts,
                "builder_version": 1,
            },
        )

    def _upsert_node(self, node: TwinNode) -> None:
        existing = self.state.nodes.get(node.id)
        if existing is None:
            self.state.nodes[node.id] = node
            return
        merged_props = {**existing.properties, **node.properties}
        self.state.nodes[node.id] = existing.model_copy(
            update={
                "label": node.label or existing.label,
                "properties": merged_props,
                "last_seen_at": node.last_seen_at or existing.last_seen_at,
                "first_seen_at": existing.first_seen_at or node.first_seen_at,
                "stale": node.stale,
            }
        )

    def _upsert_edge(
        self,
        *,
        relation: str,
        source_id: str,
        target_id: str,
        layer: TwinLayer,
        weight: float = 1.0,
        properties: Optional[dict] = None,
        bidirectional: bool = False,
    ) -> None:
        eid = edge_id(relation, source_id, target_id)
        props = properties or {}
        existing = self.state.edges.get(eid)
        if existing is None:
            self.state.edges[eid] = TwinEdge(
                id=eid,
                source_id=source_id,
                target_id=target_id,
                relation=relation,  # type: ignore[arg-type]
                layer=layer,
                weight=weight,
                properties=props,
                bidirectional=bidirectional,
            )
            return
        self.state.edges[eid] = existing.model_copy(
            update={
                "weight": existing.weight + weight,
                "properties": {**existing.properties, **props},
            }
        )

    def _ingest_observed_map(self, map_data: NetworkMapResponse) -> None:
        map_nodes = {node.id: node for node in map_data.nodes}
        app_to_device: dict[str, str] = {}
        flow_client_ip: dict[str, str] = {}

        for node in map_data.nodes:
            twin = self._map_node_to_twin(node, map_data.generated_at)
            if twin is not None:
                self._upsert_node(twin)
                if twin.entity_type == "domain":
                    self.state.observed_domains.add(twin.id)

        for edge in map_data.edges:
            if edge.kind == "foreground":
                app_to_device[edge.target] = edge.source

        for edge in map_data.edges:
            if edge.kind == "flow_session":
                client_ip = self._resolve_flow_client_ip(
                    edge.source, map_nodes, app_to_device, flow_client_ip
                )
                if client_ip:
                    flow_client_ip[edge.target] = client_ip
                self._expand_flow_node(edge.target, client_ip, map_data.generated_at)
                relation = "opens" if edge.source.startswith("app:") else "opens_direct"
                flow_nid = self._twin_flow_id(edge.target, client_ip)
                if flow_nid:
                    self._upsert_edge(
                        relation=relation,
                        source_id=edge.source,
                        target_id=flow_nid,
                        layer="observed",
                        weight=float(edge.query_count),
                        properties={"blocked_count": edge.blocked_count},
                    )
                continue

            if edge.kind == "dns_to_flow":
                client_ip = flow_client_ip.get(edge.target)
                self._expand_flow_node(edge.target, client_ip, map_data.generated_at)
                flow_nid = self._twin_flow_id(edge.target, client_ip)
                if flow_nid:
                    self._upsert_edge(
                        relation="correlates",
                        source_id=edge.source,
                        target_id=flow_nid,
                        layer="observed",
                        weight=float(edge.query_count),
                        bidirectional=True,
                    )
                continue

            relation = MAP_EDGE_TO_RELATION.get(edge.kind)
            if relation is None:
                continue
            self._upsert_edge(
                relation=relation,
                source_id=edge.source,
                target_id=edge.target,
                layer="observed",
                weight=float(edge.query_count),
                properties={"blocked_count": edge.blocked_count},
            )

    def _map_node_to_twin(
        self,
        node: NetworkMapNode,
        observed_at: datetime,
    ) -> Optional[TwinNode]:
        if node.type == "flow":
            return None
        entity_type = node.type  # device, app, domain
        props: dict = {}
        if node.app_slug:
            props["app_slug"] = node.app_slug
        if node.client_ip:
            props["client_ip"] = node.client_ip
        if node.device_id is not None:
            props["device_id"] = node.device_id
        if node.blocked is not None:
            props["blocked"] = node.blocked
        if node.fresh is not None:
            props["fresh"] = node.fresh
        return TwinNode(
            id=node.id,
            entity_type=entity_type,  # type: ignore[arg-type]
            layer="observed",
            label=node.label,
            properties=props,
            last_seen_at=observed_at,
            stale=bool(node.fresh is False),
        )

    @staticmethod
    def _resolve_flow_client_ip(
        source_id: str,
        map_nodes: dict[str, NetworkMapNode],
        app_to_device: dict[str, str],
        flow_client_ip: dict[str, str],
    ) -> str:
        if source_id.startswith("device:"):
            node = map_nodes.get(source_id)
            return (node.client_ip or "") if node else ""
        if source_id.startswith("app:"):
            device_nid = app_to_device.get(source_id)
            if not device_nid:
                return ""
            node = map_nodes.get(device_nid)
            return (node.client_ip or "") if node else ""
        return ""

    @staticmethod
    def _parse_map_flow_id(flow_nid: str) -> Optional[tuple[str, str, int]]:
        if not flow_nid.startswith("flow:"):
            return None
        parts = flow_nid.split(":", 3)
        if len(parts) != 4:
            return None
        _prefix, protocol, dest_ip, port_str = parts
        try:
            port = int(port_str)
        except ValueError:
            return None
        return protocol, dest_ip, port

    def _twin_flow_id(self, map_flow_id: str, client_ip: Optional[str]) -> Optional[str]:
        parsed = self._parse_map_flow_id(map_flow_id)
        if parsed is None or not client_ip:
            return None
        protocol, dest_ip, port = parsed
        return flow_session_id(protocol, dest_ip, port, client_ip)

    def _expand_flow_node(
        self,
        map_flow_id: str,
        client_ip: Optional[str],
        observed_at: datetime,
    ) -> None:
        parsed = self._parse_map_flow_id(map_flow_id)
        if parsed is None or not client_ip:
            return
        protocol, dest_ip, port = parsed
        fsid = flow_session_id(protocol, dest_ip, port, client_ip)
        if fsid in self.state.nodes:
            return

        self._upsert_node(
            TwinNode(
                id=fsid,
                entity_type="flow_session",
                layer="observed",
                label=f"{protocol.upper()}/{port} → {dest_ip}",
                properties={
                    "protocol": protocol,
                    "dest_ip": dest_ip,
                    "dest_port": port,
                    "client_ip": client_ip,
                },
                last_seen_at=observed_at,
            )
        )
        l4_nid = l4_service_id(protocol, port)
        self._upsert_node(
            TwinNode(
                id=l4_nid,
                entity_type="l4_service",
                layer="observed",
                label=f"{protocol.upper()} {port}",
                properties={"protocol": protocol, "port": port},
            )
        )
        ip_nid = ip_id(dest_ip)
        self._upsert_node(
            TwinNode(
                id=ip_nid,
                entity_type="ip_address",
                layer="observed",
                label=dest_ip,
                properties={"addr": dest_ip},
            )
        )
        self._upsert_edge(
            relation="uses_service",
            source_id=fsid,
            target_id=l4_nid,
            layer="observed",
        )
        self._upsert_edge(
            relation="destinates",
            source_id=fsid,
            target_id=ip_nid,
            layer="observed",
        )

    def _ingest_flow_resolutions(self, *, minutes: int) -> None:
        flows = list_recent_flows(max_age_sec=max(60, minutes * 60))
        for flow in flows:
            self._ingest_stored_flow_resolution(flow)

    def _ingest_stored_flow_resolution(self, flow: StoredFlow) -> None:
        if not flow.correlated_domain:
            return
        root = extract_root_domain(flow.correlated_domain)
        d_nid = domain_id(root)
        if d_nid not in self.state.nodes:
            self._upsert_node(
                TwinNode(
                    id=d_nid,
                    entity_type="domain",
                    layer="observed",
                    label=root,
                    properties={},
                    last_seen_at=flow.observed_at,
                )
            )
            self.state.observed_domains.add(d_nid)
        ip_nid = ip_id(flow.dest_ip)
        self._upsert_node(
            TwinNode(
                id=ip_nid,
                entity_type="ip_address",
                layer="observed",
                label=flow.dest_ip,
                properties={"addr": flow.dest_ip},
                last_seen_at=flow.observed_at,
            )
        )
        self._upsert_edge(
            relation="resolves_to",
            source_id=d_nid,
            target_id=ip_nid,
            layer="observed",
            properties={"client_ip": flow.client_ip},
        )

    def _ingest_infra_topology(self) -> None:
        infra_labels = {
            "wireguard": "WireGuard",
            "ec2_gateway": "EC2 Gateway",
            "dns_resolver": "TrustEdge DNS",
        }
        for kind, label in infra_labels.items():
            self._upsert_node(
                TwinNode(
                    id=infra_id(kind),
                    entity_type="infra_component",
                    layer="desired",
                    label=label,
                    properties={"kind": kind},
                )
            )
        for source_kind, target_kind, relation in INFRA_CHAIN:
            self._upsert_edge(
                relation=relation,
                source_id=infra_id(source_kind),
                target_id=infra_id(target_kind),
                layer="desired",
            )

        for node in self.state.nodes.values():
            if node.entity_type != "device":
                continue
            self._upsert_edge(
                relation="routed_via",
                source_id=node.id,
                target_id=infra_id("wireguard"),
                layer="desired",
            )

    def _ingest_policy_layer(self) -> None:
        policy_repo = PolicyRepository(self.db)
        dns_svc = PolicyDnsService(self.db)
        sync = dns_svc.build_dns_sync()

        for pack in policy_repo.list_packs():
            pid = policy_pack_id(pack.slug)
            self._upsert_node(
                TwinNode(
                    id=pid,
                    entity_type="policy_pack",
                    layer="desired",
                    label=pack.name,
                    properties={
                        "slug": pack.slug,
                        "enabled_globally": pack.enabled_globally,
                    },
                )
            )

        profile_ids: Set[int] = set()
        for profile in policy_repo.list_profiles():
            profile_ids.add(profile.id)
            ppid = policy_profile_id(profile.id)
            self._upsert_node(
                TwinNode(
                    id=ppid,
                    entity_type="policy_profile",
                    layer="desired",
                    label=profile.name,
                    properties={
                        "slug": profile.slug,
                        "enabled_pack_slugs": list(profile.enabled_pack_slugs or []),
                    },
                )
            )
            for slug in profile.enabled_pack_slugs or []:
                self._upsert_edge(
                    relation="includes",
                    source_id=ppid,
                    target_id=policy_pack_id(slug),
                    layer="desired",
                )

        for entry in sync.entries:
            dev_nid = device_id(entry.device_id)
            if dev_nid not in self.state.nodes:
                self._upsert_node(
                    TwinNode(
                        id=dev_nid,
                        entity_type="device",
                        layer="observed",
                        label=f"Device {entry.device_id}",
                        properties={
                            "device_id": entry.device_id,
                            "client_ip": entry.client_ip,
                        },
                    )
                )

            profile = None
            device = self.db.query(Device).filter(Device.id == entry.device_id).first()
            if device:
                profile = (
                    policy_repo.get_profile_by_id(device.policy_profile_id)
                    if device.policy_profile_id
                    else policy_repo.get_default_profile()
                )
            if profile is None:
                continue

            ppid = policy_profile_id(profile.id)
            profile_ids.add(profile.id)
            self.state.device_profiles[entry.device_id] = profile.id
            self._upsert_edge(
                relation="assigned",
                source_id=dev_nid,
                target_id=ppid,
                layer="desired",
            )
            self._upsert_edge(
                relation="enforces",
                source_id=infra_id("dns_resolver"),
                target_id=ppid,
                layer="desired",
            )

            quarantine = policy_repo.get_active_quarantine(entry.device_id)
            if quarantine:
                q_nid = f"quarantine:{entry.device_id}"
                self._upsert_node(
                    TwinNode(
                        id=q_nid,
                        entity_type="quarantine",
                        layer="desired",
                        label=f"Quarantine device {entry.device_id}",
                        properties={
                            "device_id": entry.device_id,
                            "score": quarantine.score,
                            "expires_at": quarantine.expires_at.isoformat(),
                        },
                    )
                )
                self._upsert_edge(
                    relation="quarantined",
                    source_id=dev_nid,
                    target_id=q_nid,
                    layer="desired",
                )

            if entry.allowlist_only:
                continue

            blocked_set = {d.lower().rstrip(".") for d in entry.block_domains}
            for domain in blocked_set:
                d_nid = domain_id(domain)
                if d_nid not in self.state.observed_domains:
                    continue
                rule_nid = policy_rule_id(profile.id, domain)
                self._upsert_node(
                    TwinNode(
                        id=rule_nid,
                        entity_type="policy_rule",
                        layer="desired",
                        label=f"block {domain}",
                        properties={"action": "block", "domain": domain},
                    )
                )
                self._upsert_edge(
                    relation="blocks",
                    source_id=rule_nid,
                    target_id=d_nid,
                    layer="desired",
                )
                for slug in profile.enabled_pack_slugs or []:
                    pack_domains = self._pack_contains_domain(slug, domain)
                    if pack_domains:
                        self._upsert_edge(
                            relation="defines",
                            source_id=policy_pack_id(slug),
                            target_id=rule_nid,
                            layer="desired",
                        )
                        break
                else:
                    self._upsert_edge(
                        relation="defines",
                        source_id=ppid,
                        target_id=rule_nid,
                        layer="desired",
                    )

    @staticmethod
    def _pack_contains_domain(slug: str, domain: str) -> bool:
        from app.features.policy.pack_loader import load_all_packs

        packs = load_all_packs()
        normalized = domain.lower().rstrip(".")
        return normalized in packs.get(slug, ())
