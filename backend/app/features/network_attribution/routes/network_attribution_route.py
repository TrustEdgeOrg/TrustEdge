from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.features.devices.repositories.device_repository import DeviceRepository
from app.features.network_attribution.schemas.network_attribution import (
    AppUsageHourlyListResponse,
    AppUsageSummaryResponse,
    NetworkAttributionReportRequest,
    NetworkAttributionReportResponse,
    NetworkMapResponse,
)
from app.features.network_attribution.services.network_attribution_service import NetworkAttributionService
from app.shared.admin_auth import verify_admin_api_token
from app.shared.dependencies import get_db
from app.shared.device_auth import AuthenticatedDevice, get_authenticated_device
from app.shared.logging_context import structured_extra
from app.shared.utils.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["Network attribution"])


def get_network_attribution_service(db: Session = Depends(get_db)) -> NetworkAttributionService:
    return NetworkAttributionService(db)


@router.post("/v1/network-attribution", response_model=NetworkAttributionReportResponse)
def report_network_attribution(
    payload: NetworkAttributionReportRequest,
    db: Session = Depends(get_db),
    device: AuthenticatedDevice = Depends(get_authenticated_device),
):
    if payload.device_id.strip() != device.device_id:
        raise HTTPException(status_code=403, detail="device_id does not match authenticated device")

    row = NetworkAttributionService.get_device_by_vpn_device_id(db, device.device_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Device not registered")

    service = NetworkAttributionService(db)
    try:
        return service.ingest(row, payload)
    except Exception as exc:
        logger.exception(
            "Network attribution ingest failed",
            extra=structured_extra("network_attribution_ingest_failed", device_id=device.device_id),
        )
        raise HTTPException(status_code=500, detail="Network attribution ingest failed") from exc


@router.get("/devices/{device_id}/network-attribution", response_model=AppUsageHourlyListResponse)
def list_device_network_attribution(
    device_id: int,
    hours: int = Query(default=168, ge=1, le=720),
    app_slug: Optional[str] = Query(default=None, max_length=64),
    db: Session = Depends(get_db),
    _: None = Depends(verify_admin_api_token),
    service: NetworkAttributionService = Depends(get_network_attribution_service),
):
    device = DeviceRepository(db).get_by_id(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return service.list_hourly(device_id, hours=hours, app_slug=app_slug)


@router.get("/devices/{device_id}/network-attribution/summary", response_model=AppUsageSummaryResponse)
def summarize_device_network_attribution(
    device_id: int,
    hours: int = Query(default=168, ge=1, le=720),
    db: Session = Depends(get_db),
    _: None = Depends(verify_admin_api_token),
    service: NetworkAttributionService = Depends(get_network_attribution_service),
):
    device = DeviceRepository(db).get_by_id(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return service.summarize(device_id, hours=hours)


@router.get("/network-attribution/map", response_model=NetworkMapResponse)
def network_attribution_map(
    minutes: int = Query(default=15, ge=1, le=60),
    _: None = Depends(verify_admin_api_token),
    service: NetworkAttributionService = Depends(get_network_attribution_service),
):
    return service.build_map(minutes=minutes)
