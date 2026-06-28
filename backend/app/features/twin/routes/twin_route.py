from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.features.twin.schemas.twin_simulation import (
    PackToggleSimulationRequest,
    PackToggleSimulationResponse,
)
from app.features.twin.services.pack_toggle_simulation_service import PackToggleSimulationService
from app.shared.admin_auth import verify_admin_api_token
from app.shared.dependencies import get_db

router = APIRouter(prefix="/twin", tags=["Digital Twin"])


@router.post("/simulate/pack-toggle", response_model=PackToggleSimulationResponse)
def simulate_pack_toggle(
    body: PackToggleSimulationRequest,
    db: Session = Depends(get_db),
    _: None = Depends(verify_admin_api_token),
):
    """Preview impact of toggling a global policy pack (read-only; no dns-sync)."""
    try:
        return PackToggleSimulationService(db).simulate(
            body.pack_slug,
            body.enabled_globally,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
