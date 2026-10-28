from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.features.agent_actions.repositories.agent_action_repository import AgentActionRepository
from app.features.agent_actions.schemas.agent_action import (
    AgentActionEventListResponse,
    AgentActionEventRead,
    AgentActionIngestItem,
    AgentActionIngestResponse,
)
from app.shared.utils.logging import get_logger

logger = get_logger(__name__)


def _str_or_none(value: Any, *, max_len: Optional[int] = None) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if max_len is not None:
        return text[:max_len]
    return text


def _bool_or_none(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    return None


class AgentActionService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = AgentActionRepository(db)

    def ingest(self, items: list[AgentActionIngestItem]) -> AgentActionIngestResponse:
        created = 0
        skipped = 0
        seen: set[str] = set()

        for item in items:
            event_type = (item.type or "").strip() or "ai_agent_action"
            if event_type != "ai_agent_action":
                skipped += 1
                continue
            event_id = item.event_id.strip()
            device_id = item.device_id.strip()
            if not event_id or not device_id:
                skipped += 1
                continue
            if event_id in seen or self.repo.exists_event_id(event_id):
                skipped += 1
                continue
            seen.add(event_id)

            payload = item.payload if isinstance(item.payload, dict) else {}
            ts = item.ts
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)

            try:
                self.repo.create(
                    event_id=event_id,
                    device_id=device_id,
                    ts=ts,
                    agent_type=_str_or_none(payload.get("agent_type"), max_len=64),
                    session_id=_str_or_none(payload.get("session_id"), max_len=128),
                    turn_id=_str_or_none(payload.get("turn_id"), max_len=128),
                    channel=_str_or_none(payload.get("channel"), max_len=32),
                    tool=_str_or_none(payload.get("tool"), max_len=128),
                    server=_str_or_none(payload.get("server"), max_len=128),
                    operation=_str_or_none(payload.get("operation"), max_len=64),
                    destination=_str_or_none(payload.get("destination")),
                    decision=_str_or_none(payload.get("decision"), max_len=32),
                    sensitivity=_str_or_none(payload.get("sensitivity"), max_len=32),
                    classification=_str_or_none(payload.get("classification"), max_len=64),
                    governed=_bool_or_none(payload.get("governed")),
                    correlation_id=_str_or_none(payload.get("correlation_id"), max_len=128),
                    payload=dict(payload),
                )
                self.db.commit()
                created += 1
            except IntegrityError:
                self.db.rollback()
                skipped += 1
            except Exception:
                self.db.rollback()
                logger.exception("ai agent action ingest failed event_id=%s", event_id)
                skipped += 1

        return AgentActionIngestResponse(created=created, skipped=skipped)

    def list_for_device(self, device_id: str, *, limit: int = 200) -> AgentActionEventListResponse:
        rows = self.repo.list_for_device(device_id.strip(), limit=limit)
        items: list[AgentActionEventRead] = []
        for row in rows:
            ts = row.ts
            if isinstance(ts, datetime) and ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            items.append(
                AgentActionEventRead(
                    event_id=row.event_id,
                    device_id=row.device_id,
                    type="ai_agent_action",
                    ts=ts.isoformat().replace("+00:00", "Z") if ts else None,
                    payload=row.payload if isinstance(row.payload, dict) else {},
                )
            )
        return AgentActionEventListResponse(
            items=items,
            total=len(items),
            device_id=device_id.strip(),
        )
