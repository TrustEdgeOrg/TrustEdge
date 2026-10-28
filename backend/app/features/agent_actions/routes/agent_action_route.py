from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.features.agent_actions.schemas.agent_action import (
    AgentActionEventListResponse,
    AgentActionIngestItem,
    AgentActionIngestResponse,
)
from app.features.agent_actions.services.agent_action_service import AgentActionService
from app.shared.admin_auth import verify_admin_api_token
from app.shared.dependencies import get_db
from app.shared.service_auth import verify_ingest_service

router = APIRouter(tags=["Agent Actions"])


def get_agent_action_service(db: Session = Depends(get_db)) -> AgentActionService:
    return AgentActionService(db)


@router.post("/internal/agent-actions/ingest", response_model=AgentActionIngestResponse)
def ingest_agent_actions(
    body: list[AgentActionIngestItem],
    _: None = Depends(verify_ingest_service),
    service: AgentActionService = Depends(get_agent_action_service),
):
    """Persist ai_agent_action events (detection-engine write-behind)."""
    return service.ingest(body)


@router.get(
    "/security/agents/{device_id}/agent-actions",
    response_model=AgentActionEventListResponse,
)
def list_agent_actions(
    device_id: str,
    limit: int = Query(default=200, ge=1, le=1000),
    _: None = Depends(verify_admin_api_token),
    service: AgentActionService = Depends(get_agent_action_service),
):
    """Durable Asked / Happened history for the Agent Actions UI."""
    return service.list_for_device(device_id, limit=limit)
