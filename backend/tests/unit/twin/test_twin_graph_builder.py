from datetime import datetime, timezone

import pytest

from app.features.dns_queries.models.dns_query import DnsQuery
from app.features.network_attribution.models.device_network_context import DeviceNetworkContext
from app.features.twin.graph.builder import TwinGraphBuilder
from app.features.twin.graph.ids import app_id, device_id, domain_id, infra_id
from app.features.twin.graph.model import TwinGraph
from app.features.twin.graph.schemas import TraverseRequest
from app.shared.config import settings
from tests.helpers.factories import create_vpn_device, seed_policy_catalog


@pytest.fixture(autouse=True)
def enable_attribution(monkeypatch):
    monkeypatch.setattr(settings, "NETWORK_ATTRIBUTION_ENABLED", True)


def test_builder_includes_observed_and_policy_layers(db_session):
    seed_policy_catalog(db_session)
    device, lease = create_vpn_device(db_session, device_id="graph-builder")
    now = datetime.now(timezone.utc)
    db_session.add(
        DeviceNetworkContext(
            device_id=device.id,
            app_slug="zoom",
            app_display_name="Zoom",
            bundle_id="us.zoom.xos",
            observed_at=now,
        )
    )
    db_session.commit()

    snapshot = TwinGraphBuilder(db_session).build(minutes=15, include_flows=False)
    graph = TwinGraph.from_snapshot(snapshot)

    assert device_id(device.id) in graph.nodes
    assert app_id("zoom") in graph.nodes
    assert infra_id("wireguard") in graph.nodes
    assert infra_id("dns_resolver") in graph.nodes

    layers = {node.layer for node in graph.nodes.values()}
    assert "observed" in layers
    assert "desired" in layers

    assigned = graph.neighbors(
        device_id(device.id),
        direction="out",
        relations=["assigned"],
        layers=["desired"],
    )
    assert assigned


def test_builder_materializes_block_rules_for_observed_domains(db_session):
    seed_policy_catalog(db_session)
    device, lease = create_vpn_device(db_session, device_id="graph-block")
    blocked_domain = "example.com"
    now = datetime.now(timezone.utc)

    db_session.add(
        DeviceNetworkContext(
            device_id=device.id,
            app_slug="zoom",
            app_display_name="Zoom",
            bundle_id="us.zoom.xos",
            observed_at=now,
        )
    )
    db_session.add(
        DnsQuery(
            client_ip=lease.ip,
            domain=blocked_domain,
            blocked=True,
            timestamp=now,
            attributed_app_slug="zoom",
            attributed_app_display_name="Zoom",
        )
    )
    db_session.commit()

    from app.features.policy.repositories.policy_repository import PolicyRepository

    profile = PolicyRepository(db_session).get_default_profile()
    assert profile is not None
    profile.extra_block_domains = [blocked_domain]
    db_session.commit()

    snapshot = TwinGraphBuilder(db_session).build(minutes=15, include_flows=False)
    graph = TwinGraph.from_snapshot(snapshot)

    d_nid = domain_id(blocked_domain)
    assert d_nid in graph.nodes

    rca = graph.traverse(
        TraverseRequest(
            seed_node_ids=[d_nid],
            direction="in",
            relations=["blocks", "defines", "includes", "assigned"],
            max_depth=8,
            layers=["desired"],
        )
    )
    rca_ids = {node.id for node in rca.nodes}
    assert device_id(device.id) in rca_ids
