from __future__ import annotations

from typing import Optional

from app.features.network_attribution.schemas.network_attribution import (
    NetworkMapEdge,
    NetworkMapNode,
    NetworkMapResponse,
)
from app.features.network_flows.services.flow_store import StoredFlow, list_recent_flows
from app.shared.config import settings
from app.shared.domain_utils import extract_root_domain


def _flow_node_id(protocol: str, dest_ip: str, dest_port: Optional[int]) -> str:
    port = dest_port if dest_port is not None else 0
    return f"flow:{protocol}:{dest_ip}:{port}"


def _flow_label(flow: StoredFlow) -> str:
    port = flow.dest_port if flow.dest_port is not None else 0
    proto = flow.protocol.upper()
    if flow.correlated_domain:
        return f"{proto}/{port} {flow.correlated_domain}"
    return f"{proto}/{port} → {flow.dest_ip}"


def merge_flows_into_map(
    base: NetworkMapResponse,
    *,
    minutes: int,
) -> NetworkMapResponse:
    if not settings.NETWORK_FLOWS_ENABLED:
        return base

    flows = list_recent_flows(max_age_sec=max(60, minutes * 60))
    if not flows:
        return base

    nodes = {n.id: n for n in base.nodes}
    edge_map: dict[tuple[str, str, str], NetworkMapEdge] = {
        (e.source, e.target, e.kind): e for e in base.edges
    }

    def ensure_flow_node(flow: StoredFlow) -> str:
        node_id = _flow_node_id(flow.protocol, flow.dest_ip, flow.dest_port)
        if node_id not in nodes:
            nodes[node_id] = NetworkMapNode(
                id=node_id,
                type="flow",
                label=_flow_label(flow),
            )
        return node_id

    def add_edge(source: str, target: str, kind: str) -> None:
        key = (source, target, kind)
        existing = edge_map.get(key)
        if existing is None:
            edge_map[key] = NetworkMapEdge(
                source=source,
                target=target,
                kind=kind,
                query_count=1,
                blocked_count=0,
            )
            return
        edge_map[key] = existing.model_copy(update={"query_count": existing.query_count + 1})

    for flow in flows:
        flow_id = ensure_flow_node(flow)

        if flow.correlated_domain:
            root = extract_root_domain(flow.correlated_domain)
            domain_id = f"domain:{root}"
            if domain_id not in nodes:
                nodes[domain_id] = NetworkMapNode(
                    id=domain_id,
                    type="domain",
                    label=root,
                )
            add_edge(domain_id, flow_id, "dns_to_flow")
            continue

        if flow.attributed_app_slug:
            app_id = f"app:{flow.attributed_app_slug}"
            if app_id not in nodes:
                display = flow.attributed_app_display_name or flow.attributed_app_slug.replace("_", " ").title()
                nodes[app_id] = NetworkMapNode(
                    id=app_id,
                    type="app",
                    label=display,
                    app_slug=flow.attributed_app_slug,
                )
            add_edge(app_id, flow_id, "flow_session")
            continue

        device_nodes = [n for n in nodes.values() if n.type == "device" and n.client_ip == flow.client_ip]
        if device_nodes:
            add_edge(device_nodes[0].id, flow_id, "flow_session")

    return NetworkMapResponse(
        generated_at=base.generated_at,
        minutes=base.minutes,
        nodes=list(nodes.values()),
        edges=list(edge_map.values()),
    )
