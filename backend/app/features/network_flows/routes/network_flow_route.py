from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.features.network_flows.schemas.network_flow import (
    DnsResolutionBulkCreate,
    DnsResolutionIngestResponse,
    NetworkFlowBulkCreate,
    NetworkFlowIngestResponse,
    NetworkFlowLiveResponse,
)
from app.features.network_flows.services.flow_ingest_service import NetworkFlowIngestService
from app.shared.admin_auth import verify_admin_api_token
from app.shared.dependencies import get_db
from app.shared.service_auth import verify_dns_ingest_service

router = APIRouter(prefix="/network-flows", tags=["Network flows"])


def get_flow_service(db: Session = Depends(get_db)) -> NetworkFlowIngestService:
    return NetworkFlowIngestService(db)


@router.post("/bulk", response_model=NetworkFlowIngestResponse)
def ingest_network_flows(
    payload: NetworkFlowBulkCreate,
    _: None = Depends(verify_dns_ingest_service),
    service: NetworkFlowIngestService = Depends(get_flow_service),
):
    """Ingest L4 connection samples from the EC2 host conntrack watcher."""
    return service.ingest_flows(payload)


@router.post("/dns-resolutions/bulk", response_model=DnsResolutionIngestResponse)
def ingest_dns_resolutions(
    payload: DnsResolutionBulkCreate,
    _: None = Depends(verify_dns_ingest_service),
    service: NetworkFlowIngestService = Depends(get_flow_service),
):
    """Cache DNS answer IPs for correlating flows to domain names."""
    return service.ingest_resolutions(payload)


@router.get("/live", response_model=NetworkFlowLiveResponse)
def list_live_network_flows(
    max_age_sec: Optional[int] = Query(default=None, ge=10, le=3600),
    _: None = Depends(verify_admin_api_token),
    service: NetworkFlowIngestService = Depends(get_flow_service),
):
    """Recent L4 flows seen on the VPN gateway (Redis rolling window)."""
    return service.list_live(max_age_sec=max_age_sec)
