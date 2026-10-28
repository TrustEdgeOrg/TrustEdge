"""Score AI sessions and decide which findings become EngineHits."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from ai_activity.catalog import (
    ENGINE_AI_ACTIVITY,
    FINDING_CLOUD_CLI,
    FINDING_CONTAINER_DEPLOY,
    FINDING_SECRETS_ACCESS,
    FINDING_SECRETS_GIT_PUSH,
    FINDING_SHELL_NETWORK_EXFIL,
)
from ai_activity.graph_builder import execution_path_summary
from ai_activity.models import AISession, SessionFinding
from rules.constants import SEVERITY_HIGH, SEVERITY_MEDIUM

if TYPE_CHECKING:
    from pipeline.types import EngineHit

# Findings that always fuse into the main alert stream
_ALWAYS_ALERT = frozenset(
    {
        FINDING_SHELL_NETWORK_EXFIL,
        FINDING_SECRETS_ACCESS,
        FINDING_SECRETS_GIT_PUSH,
        FINDING_CLOUD_CLI,
        FINDING_CONTAINER_DEPLOY,
    }
)


def update_session_risk(session: AISession) -> int:
    """Recompute session.risk_score from findings + activity weights."""
    score = 0
    for finding in session.findings:
        score = max(score, finding.score)
    if session.secrets_accessed:
        score = max(score, 75)
    if session.cloud_activity or session.k8s_activity:
        score = max(score, 75)
    if len({t.tool_class for t in session.tools if t.tool_class}) >= 4:
        score = max(score, 50)
    if session.external_domains:
        score = max(score, min(50, score + 10) if score else 25)
    session.risk_score = min(100, score)
    return session.risk_score


def findings_to_engine_hits(
    session: AISession,
    findings: list[SessionFinding],
    *,
    event_id: str | None,
    event_type: str | None,
    device_id: str,
) -> list[Any]:
    """Convert selected findings into EngineHits for pipeline fusion."""
    # Late import avoids circular dependency via pipeline/__init__.py
    from pipeline.types import EngineHit

    hits: list[EngineHit] = []
    for finding in findings:
        if not _should_emit_alert(finding):
            continue
        if finding.emitted_alert:
            continue
        detail = dict(finding.detail)
        detail.update(
            {
                "session_id": session.session_id,
                "app_name": session.app_name,
                "execution_path": detail.get("execution_path")
                or execution_path_summary(session),
                "risk_score": session.risk_score,
                "engine": ENGINE_AI_ACTIVITY,
            }
        )
        hits.append(
            EngineHit(
                engine=ENGINE_AI_ACTIVITY,
                alert_type=finding.finding_type,
                severity=finding.severity,
                score=finding.score,
                message=finding.message,
                device_id=device_id,
                timestamp=finding.timestamp,
                event_id=event_id,
                event_type=event_type,
                detail=json.dumps(detail, separators=(",", ":")),
            )
        )
        finding.emitted_alert = True
    return hits


def _should_emit_alert(finding: SessionFinding) -> bool:
    if finding.finding_type in _ALWAYS_ALERT:
        return True
    if finding.severity == SEVERITY_HIGH:
        return True
    if finding.severity == SEVERITY_MEDIUM:
        return True
    return False
