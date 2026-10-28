from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.features.twin.schemas.connected_agent import (
    AgentEventListResponse,
    ConnectedAgentListResponse,
    ConnectedAgentRead,
)
from app.features.twin.schemas.security_alert import (
    SecurityAlertCreate,
    SecurityAlertExplainRequest,
    SecurityAlertExplainResponse,
    SecurityAlertListResponse,
)
from app.features.twin.schemas.device_baseline import (
    DeviceBaselineClearResponse,
    DeviceBaselineResponse,
)
from app.features.twin.schemas.ai_activity import (
    AiProcessLookupResponse,
    AiSessionChainResponse,
    AiSessionDetailResponse,
    AiSessionGraphResponse,
    AiSessionListResponse,
    AiSessionTimelineResponse,
)
from app.features.twin.schemas.ai_software import AiSoftwareListResponse
from app.features.twin.services.alert_explain_service import explain_security_alert
from app.features.twin.services.connected_agent_service import ConnectedAgentService
from app.features.twin.services.detection_engine_client import (
    clear_device_baseline,
    fetch_ai_process_lookup,
    fetch_ai_session,
    fetch_ai_session_chain,
    fetch_ai_session_graph,
    fetch_ai_session_timeline,
    fetch_ai_sessions,
    fetch_device_baseline,
)
from app.features.twin.services.security_alert_service import SecurityAlertService
from app.shared.admin_auth import verify_admin_api_token
from app.shared.config import settings
from app.shared.dependencies import get_db
from app.shared.service_auth import verify_ingest_service


router = APIRouter(prefix="/security", tags=["Security Observability"])


def get_security_alert_service(db: Session = Depends(get_db)) -> SecurityAlertService:
    return SecurityAlertService(db)


def get_connected_agent_service() -> ConnectedAgentService:
    return ConnectedAgentService()


def _is_http_404(exc: Exception) -> bool:
    import urllib.error

    return isinstance(exc, urllib.error.HTTPError) and exc.code == 404


@router.get("/alerts", response_model=SecurityAlertListResponse)
def list_security_alerts(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    alert_type: Optional[str] = Query(default=None),
    device_id: Optional[str] = Query(default=None),
    severity: Optional[str] = Query(default=None),
    _: None = Depends(verify_admin_api_token),
    service: SecurityAlertService = Depends(get_security_alert_service),
):
    """List TrustEdge Agent detection alerts."""
    return service.list_alerts(
        page=page,
        page_size=page_size,
        alert_type=alert_type,
        device_id=device_id,
        severity=severity,
    )


@router.post("/alerts/explain", response_model=SecurityAlertExplainResponse)
def explain_security_alert_route(
    body: SecurityAlertExplainRequest,
    _: None = Depends(verify_admin_api_token),
):
    """Ask the local Ollama model to explain a security alert for an operator."""
    try:
        return explain_security_alert(body)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/alerts/ingest")
def ingest_security_alerts(
    body: list[SecurityAlertCreate],
    _: None = Depends(verify_ingest_service),
    service: SecurityAlertService = Depends(get_security_alert_service),
):
    """Ingest alerts from detection-engine (service token)."""
    if not body:
        return {"created": 0}
    created = service.ingest(body)
    return {"created": created}


@router.get("/agents", response_model=ConnectedAgentListResponse)
def list_connected_agents(
    connected_within_sec: int = Query(default=300, ge=30, le=86400),
    _: None = Depends(verify_admin_api_token),
    service: ConnectedAgentService = Depends(get_connected_agent_service),
):
    """List connected TrustEdge agents from live Redis state."""
    return service.list_connected_agents(connected_within_sec=connected_within_sec)


@router.get("/agents/{device_id}", response_model=ConnectedAgentRead)
def get_connected_agent(
    device_id: str,
    connected_within_sec: int = Query(default=300, ge=30, le=86400),
    _: None = Depends(verify_admin_api_token),
    service: ConnectedAgentService = Depends(get_connected_agent_service),
):
    """Fetch live twin telemetry for a single agent device."""
    agent = service.get_connected_agent(device_id, connected_within_sec=connected_within_sec)
    if agent is None:
        raise HTTPException(status_code=404, detail="Live agent state not found")
    return agent


@router.get("/agents/{device_id}/events", response_model=AgentEventListResponse)
def list_connected_agent_events(
    device_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    _: None = Depends(verify_admin_api_token),
    service: ConnectedAgentService = Depends(get_connected_agent_service),
):
    """Recent telemetry event timeline for a device (newest first)."""
    return service.list_device_events(device_id, limit=limit)


@router.get("/agents/{device_id}/ai-software", response_model=AiSoftwareListResponse)
def list_agent_ai_software(
    device_id: str,
    _: None = Depends(verify_admin_api_token),
    service: ConnectedAgentService = Depends(get_connected_agent_service),
):
    """Installed AI apps and CLI agents for a device (from Redis twin)."""
    return service.list_ai_software(device_id)


@router.get("/agents/{device_id}/baseline", response_model=DeviceBaselineResponse)
def get_device_baseline(
    device_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    _: None = Depends(verify_admin_api_token),
):
    """In-memory behavioral baseline for a device (from detection-engine; hydrated from Postgres)."""
    if not settings.DETECTION_ENGINE_URL.strip():
        raise HTTPException(
            status_code=503,
            detail="DETECTION_ENGINE_URL is not configured",
        )
    try:
        return fetch_device_baseline(device_id=device_id, limit=limit)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"detection-engine baseline unavailable: {exc}") from exc


@router.delete("/agents/{device_id}/baseline", response_model=DeviceBaselineClearResponse)
def delete_device_baseline(
    device_id: str,
    _: None = Depends(verify_admin_api_token),
):
    """Flush RAM + durable Postgres baseline for a device (via detection-engine)."""
    if not settings.DETECTION_ENGINE_URL.strip():
        raise HTTPException(
            status_code=503,
            detail="DETECTION_ENGINE_URL is not configured",
        )
    try:
        return clear_device_baseline(device_id=device_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"detection-engine baseline clear failed: {exc}") from exc


@router.get("/agents/{device_id}/ai-sessions", response_model=AiSessionListResponse)
def list_ai_sessions(
    device_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    include_closed: bool = Query(default=True),
    _: None = Depends(verify_admin_api_token),
):
    """List reconstructed AI application sessions for a device."""
    if not settings.DETECTION_ENGINE_URL.strip():
        raise HTTPException(
            status_code=503,
            detail="DETECTION_ENGINE_URL is not configured",
        )
    try:
        return fetch_ai_sessions(
            device_id=device_id, limit=limit, include_closed=include_closed
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail=f"detection-engine AI sessions unavailable: {exc}"
        ) from exc


@router.get("/ai-sessions/{session_id}", response_model=AiSessionDetailResponse)
def get_ai_session(
    session_id: str,
    _: None = Depends(verify_admin_api_token),
):
    """Full AI session detail including spawn tree and findings."""
    if not settings.DETECTION_ENGINE_URL.strip():
        raise HTTPException(
            status_code=503,
            detail="DETECTION_ENGINE_URL is not configured",
        )
    try:
        return fetch_ai_session(session_id)
    except Exception as exc:
        if _is_http_404(exc):
            raise HTTPException(status_code=404, detail="AI session not found") from exc
        raise HTTPException(
            status_code=502, detail=f"detection-engine AI session unavailable: {exc}"
        ) from exc


@router.get("/ai-sessions/{session_id}/graph", response_model=AiSessionGraphResponse)
def get_ai_session_graph(
    session_id: str,
    _: None = Depends(verify_admin_api_token),
):
    """Execution graph for an AI session."""
    if not settings.DETECTION_ENGINE_URL.strip():
        raise HTTPException(
            status_code=503,
            detail="DETECTION_ENGINE_URL is not configured",
        )
    try:
        return fetch_ai_session_graph(session_id)
    except Exception as exc:
        if _is_http_404(exc):
            raise HTTPException(status_code=404, detail="AI session not found") from exc
        raise HTTPException(
            status_code=502, detail=f"detection-engine AI graph unavailable: {exc}"
        ) from exc


@router.get("/ai-sessions/{session_id}/timeline", response_model=AiSessionTimelineResponse)
def get_ai_session_timeline(
    session_id: str,
    limit: int = Query(default=200, ge=1, le=1000),
    _: None = Depends(verify_admin_api_token),
):
    """Timeline of actions within an AI session."""
    if not settings.DETECTION_ENGINE_URL.strip():
        raise HTTPException(
            status_code=503,
            detail="DETECTION_ENGINE_URL is not configured",
        )
    try:
        return fetch_ai_session_timeline(session_id, limit=limit)
    except Exception as exc:
        if _is_http_404(exc):
            raise HTTPException(status_code=404, detail="AI session not found") from exc
        raise HTTPException(
            status_code=502, detail=f"detection-engine AI timeline unavailable: {exc}"
        ) from exc


@router.get("/ai-sessions/{session_id}/chain", response_model=AiSessionChainResponse)
def get_ai_session_chain(
    session_id: str,
    _: None = Depends(verify_admin_api_token),
):
    """Human-readable activity chain for an AI session."""
    if not settings.DETECTION_ENGINE_URL.strip():
        raise HTTPException(
            status_code=503,
            detail="DETECTION_ENGINE_URL is not configured",
        )
    try:
        return fetch_ai_session_chain(session_id)
    except Exception as exc:
        if _is_http_404(exc):
            raise HTTPException(status_code=404, detail="AI session not found") from exc
        raise HTTPException(
            status_code=502, detail=f"detection-engine AI chain unavailable: {exc}"
        ) from exc


@router.get("/ai-processes/{process_id}", response_model=AiProcessLookupResponse)
def lookup_ai_process(
    process_id: str,
    _: None = Depends(verify_admin_api_token),
):
    """Look up which AI session a process belongs to."""
    if not settings.DETECTION_ENGINE_URL.strip():
        raise HTTPException(
            status_code=503,
            detail="DETECTION_ENGINE_URL is not configured",
        )
    try:
        return fetch_ai_process_lookup(process_id)
    except Exception as exc:
        if _is_http_404(exc):
            raise HTTPException(status_code=404, detail="process not in any AI session") from exc
        raise HTTPException(
            status_code=502, detail=f"detection-engine AI process lookup unavailable: {exc}"
        ) from exc
