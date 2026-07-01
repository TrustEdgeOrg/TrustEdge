from datetime import datetime, timezone

import pytest

from app.features.network_attribution.schemas.network_attribution import (
    NetworkMapEdge,
    NetworkMapNode,
    NetworkMapResponse,
)
from app.features.network_flows.schemas.network_flow import DnsResolutionCreate, NetworkFlowCreate
from app.features.network_flows.services import flow_store
from app.features.network_flows.services.flow_map_service import merge_flows_into_map
from app.shared.config import settings


@pytest.fixture(autouse=True)
def enable_flows(monkeypatch):
    monkeypatch.setattr(settings, "NETWORK_FLOWS_ENABLED", True)
    flow_store.clear_memory_store_for_tests()


def test_record_and_lookup_resolution():
    flow_store.record_resolutions(
        [
            DnsResolutionCreate(
                timestamp=datetime.now(timezone.utc),
                client_ip="10.8.0.5",
                domain="github.com",
                resolved_ip="140.82.114.4",
            )
        ]
    )
    assert flow_store.lookup_domain("10.8.0.5", "140.82.114.4") == "github.com"


def test_merge_flows_links_domain_and_flow():
    flow_store.record_resolutions(
        [
            DnsResolutionCreate(
                timestamp=datetime.now(timezone.utc),
                client_ip="10.8.0.5",
                domain="github.com",
                resolved_ip="140.82.114.4",
            )
        ]
    )
    flow_store.record_flows(
        [
            NetworkFlowCreate(
                observed_at=datetime.now(timezone.utc),
                client_ip="10.8.0.5",
                protocol="tcp",
                dest_ip="140.82.114.4",
                dest_port=443,
                state="ESTABLISHED",
            )
        ],
        correlated_domains={
            "10.8.0.5|tcp|140.82.114.4|443|0": "github.com",
        },
        attribution={"10.8.0.5": ("google_chrome", "Google Chrome")},
    )

    base = NetworkMapResponse(
        generated_at=datetime.now(timezone.utc),
        minutes=1,
        nodes=[
            NetworkMapNode(id="domain:github.com", type="domain", label="github.com"),
        ],
        edges=[],
    )
    merged = merge_flows_into_map(base, minutes=1)
    flow_nodes = [n for n in merged.nodes if n.type == "flow"]
    assert len(flow_nodes) == 1
    assert any(e.kind == "dns_to_flow" for e in merged.edges)
