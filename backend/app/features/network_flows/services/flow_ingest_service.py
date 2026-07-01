from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.features.network_attribution.services.network_attribution_service import NetworkAttributionService
from app.features.network_flows.schemas.network_flow import (
    DnsResolutionBulkCreate,
    DnsResolutionIngestResponse,
    NetworkFlowBulkCreate,
    NetworkFlowCreate,
    NetworkFlowIngestResponse,
    NetworkFlowLiveResponse,
)
from app.features.network_flows.services import flow_store
from app.features.network_flows.services.flow_store import flow_dedupe_key
from app.shared.config import settings


class NetworkFlowIngestService:
    def __init__(self, db: Session):
        self.db = db
        self.attribution = NetworkAttributionService(db)

    def ingest_resolutions(self, payload: DnsResolutionBulkCreate) -> DnsResolutionIngestResponse:
        if not settings.NETWORK_FLOWS_ENABLED:
            return DnsResolutionIngestResponse(stored=False, resolutions_received=0)
        count = flow_store.record_resolutions(payload.resolutions)
        return DnsResolutionIngestResponse(stored=True, resolutions_received=count)

    def ingest_flows(self, payload: NetworkFlowBulkCreate) -> NetworkFlowIngestResponse:
        if not settings.NETWORK_FLOWS_ENABLED:
            return NetworkFlowIngestResponse(stored=False, flows_received=0)

        correlated: dict[str, Optional[str]] = {}
        attribution: dict[str, tuple[Optional[str], Optional[str]]] = {}

        for flow in payload.flows:
            dedupe = flow_dedupe_key(flow)
            correlated[dedupe] = flow_store.lookup_domain(flow.client_ip, flow.dest_ip)
            if flow.client_ip not in attribution:
                resolved = self.attribution.resolve_attribution_for_client_ip(
                    flow.client_ip,
                    flow.observed_at,
                )
                if resolved is None:
                    attribution[flow.client_ip] = (None, None)
                else:
                    attribution[flow.client_ip] = (resolved.app_slug, resolved.app_display_name)

        stored = flow_store.record_flows(
            payload.flows,
            correlated_domains=correlated,
            attribution=attribution,
        )
        return NetworkFlowIngestResponse(stored=True, flows_received=stored)

    def list_live(self, max_age_sec: Optional[int] = None) -> NetworkFlowLiveResponse:
        age = max_age_sec or settings.NETWORK_FLOWS_MAX_AGE_SEC
        flows = flow_store.list_recent_flows(max_age_sec=age)
        return NetworkFlowLiveResponse(
            items=flow_store.to_live_items(flows),
            max_age_sec=int(age),
        )
