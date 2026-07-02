from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.features.twin.graph.schemas import (
    TraverseDirection,
    TraverseRequest,
    TraverseResponse,
    TwinGraphSnapshot,
    TwinLayer,
    TwinRelation,
)
from app.features.twin.schemas.twin_simulation import (
    PackToggleSimulationRequest,
    PackToggleSimulationResponse,
)
from app.features.twin.services.pack_toggle_simulation_service import PackToggleSimulationService
from app.features.twin.services.twin_graph_service import TwinGraphService
from app.shared.admin_auth import verify_admin_api_token
from app.shared.dependencies import get_db

router = APIRouter(prefix="/twin", tags=["Digital Twin"])


def get_twin_graph_service(db: Session = Depends(get_db)) -> TwinGraphService:
    return TwinGraphService(db)


@router.get("/graph/snapshot", response_model=TwinGraphSnapshot)
def graph_snapshot(
    minutes: int = Query(default=1, ge=1, le=60),
    include_flows: bool = Query(default=True),
    include_policy: bool = Query(default=True),
    _: None = Depends(verify_admin_api_token),
    service: TwinGraphService = Depends(get_twin_graph_service),
):
    """Canonical entity/dependency graph for the digital twin."""
    return service.build_snapshot(
        minutes=minutes,
        include_flows=include_flows,
        include_policy=include_policy,
    )


@router.post("/graph/traverse", response_model=TraverseResponse)
def graph_traverse(
    body: TraverseRequest,
    minutes: int = Query(default=1, ge=1, le=60),
    include_flows: bool = Query(default=True),
    include_policy: bool = Query(default=True),
    _: None = Depends(verify_admin_api_token),
    service: TwinGraphService = Depends(get_twin_graph_service),
):
    """Walk dependencies from seed nodes (impact analysis, blast radius, RCA)."""
    return service.traverse(
        body,
        minutes=minutes,
        include_flows=include_flows,
        include_policy=include_policy,
    )


@router.get("/graph/neighbors", response_model=TraverseResponse)
def graph_neighbors(
    node_id: str = Query(min_length=1),
    direction: TraverseDirection = Query(default="both"),
    relations: Optional[List[TwinRelation]] = Query(default=None),
    layers: Optional[List[TwinLayer]] = Query(default=None),
    minutes: int = Query(default=1, ge=1, le=60),
    include_flows: bool = Query(default=True),
    include_policy: bool = Query(default=True),
    _: None = Depends(verify_admin_api_token),
    service: TwinGraphService = Depends(get_twin_graph_service),
):
    """One-hop neighbors of a node in either direction."""
    return service.neighbors(
        node_id,
        direction=direction,
        relations=relations,
        layers=layers,
        minutes=minutes,
        include_flows=include_flows,
        include_policy=include_policy,
    )


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
