from datetime import datetime
from typing import Any, List, Optional

from sqlalchemy.orm import Session

from app.features.agent_actions.models.ai_agent_action import AiAgentAction


class AgentActionRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def exists_event_id(self, event_id: str) -> bool:
        return (
            self.db.query(AiAgentAction.id)
            .filter(AiAgentAction.event_id == event_id)
            .first()
            is not None
        )

    def create(
        self,
        *,
        event_id: str,
        device_id: str,
        ts: datetime,
        agent_type: Optional[str],
        session_id: Optional[str],
        turn_id: Optional[str],
        channel: Optional[str],
        tool: Optional[str],
        server: Optional[str],
        operation: Optional[str],
        destination: Optional[str],
        decision: Optional[str],
        sensitivity: Optional[str],
        classification: Optional[str],
        governed: Optional[bool],
        correlation_id: Optional[str],
        payload: dict[str, Any],
    ) -> AiAgentAction:
        row = AiAgentAction(
            event_id=event_id,
            device_id=device_id,
            ts=ts,
            agent_type=agent_type,
            session_id=session_id,
            turn_id=turn_id,
            channel=channel,
            tool=tool,
            server=server,
            operation=operation,
            destination=destination,
            decision=decision,
            sensitivity=sensitivity,
            classification=classification,
            governed=governed,
            correlation_id=correlation_id,
            payload=payload,
        )
        self.db.add(row)
        return row

    def list_for_device(self, device_id: str, *, limit: int = 200) -> List[AiAgentAction]:
        return (
            self.db.query(AiAgentAction)
            .filter(AiAgentAction.device_id == device_id)
            .order_by(AiAgentAction.ts.desc())
            .limit(limit)
            .all()
        )
