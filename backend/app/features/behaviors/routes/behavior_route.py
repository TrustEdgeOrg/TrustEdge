from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.features.behaviors.schemas.behavior import (
    BehaviorClearResponse,
    BehaviorObserveRequest,
    BehaviorObserveResponse,
    DeviceBehaviorListResponse,
)
from app.features.behaviors.services.behavior_service import BehaviorService
from app.shared.admin_auth import verify_admin_api_token
from app.shared.dependencies import get_db
from app.shared.service_auth import verify_ingest_service

router = APIRouter(tags=["Behaviors"])


def get_behavior_service(db: Session = Depends(get_db)) -> BehaviorService:
    return BehaviorService(db)


@router.post("/internal/behaviors/observe", response_model=BehaviorObserveResponse)
def observe_behavior(
    body: BehaviorObserveRequest,
    _: None = Depends(verify_ingest_service),
    service: BehaviorService = Depends(get_behavior_service),
):
    """Increment a learned behavior counter (detection-engine write-behind)."""
    return service.observe(body)


@router.get("/internal/behaviors", response_model=DeviceBehaviorListResponse)
def list_behaviors_internal(
    device_id: str = Query(..., min_length=1),
    limit: int = Query(default=5000, ge=1, le=10000),
    _: None = Depends(verify_ingest_service),
    service: BehaviorService = Depends(get_behavior_service),
):
    """Hydrate detection-engine RAM from durable Postgres counters."""
    return service.list_for_device(device_id, limit=limit)


@router.delete("/internal/behaviors/{device_id}", response_model=BehaviorClearResponse)
def clear_behaviors_internal(
    device_id: str,
    _: None = Depends(verify_ingest_service),
    service: BehaviorService = Depends(get_behavior_service),
):
    """Flush durable baseline rows for a device (mirrors detector RAM clear)."""
    cleared = service.clear_device(device_id)
    return BehaviorClearResponse(device_id=device_id.strip(), cleared=cleared)


@router.get("/behaviors", response_model=DeviceBehaviorListResponse)
def list_behaviors(
    device_id: str = Query(..., min_length=1),
    limit: int = Query(default=100, ge=1, le=500),
    _: None = Depends(verify_admin_api_token),
    service: BehaviorService = Depends(get_behavior_service),
):
    """List learned behaviors for a device (dashboard / debugging)."""
    return service.list_for_device(device_id, limit=limit)
