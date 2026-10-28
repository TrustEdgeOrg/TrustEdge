from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, Field


class AgentActionIngestItem(BaseModel):
    event_id: str = Field(min_length=1, max_length=128)
    device_id: str = Field(min_length=1, max_length=128)
    type: str = Field(default="ai_agent_action", max_length=64)
    ts: datetime
    payload: dict[str, Any] = Field(default_factory=dict)


class AgentActionIngestResponse(BaseModel):
    created: int = 0
    skipped: int = 0


class AgentActionEventRead(BaseModel):
    """Twin-compatible envelope for the Agent Actions UI."""

    event_id: str = ""
    device_id: str = ""
    type: str = "ai_agent_action"
    ts: Optional[str] = None
    payload: dict[str, Any] = Field(default_factory=dict)


class AgentActionEventListResponse(BaseModel):
    items: List[AgentActionEventRead] = Field(default_factory=list)
    total: int = 0
    device_id: str
