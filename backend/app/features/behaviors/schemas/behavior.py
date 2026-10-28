from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, Field


class BehaviorObserveRequest(BaseModel):
    device_id: str = Field(min_length=1, max_length=128)
    behavior_kind: str = Field(min_length=1, max_length=64)
    behavior_key: str = Field(min_length=1, max_length=255)
    alert_type: Optional[str] = Field(default=None, max_length=64)
    meta: Optional[dict[str, Any]] = None
    emitted_alert: bool = False


class BehaviorObserveResponse(BaseModel):
    device_id: str
    behavior_kind: str
    behavior_key: str
    alert_type: Optional[str] = None
    count: int
    first_seen_at: datetime
    last_seen_at: datetime
    suppress: bool
    established: bool
    profile_warm: bool
    action: str  # emit | suppress
    suppress_count: int
    suppress_age_hours: int
    profile_min_keys: int = 30


class DeviceBehaviorRead(BaseModel):
    id: int
    device_id: str
    behavior_kind: str
    behavior_key: str
    alert_type: Optional[str] = None
    count: int
    first_seen_at: datetime
    last_seen_at: datetime
    last_alert_at: Optional[datetime] = None
    meta: Optional[dict[str, Any]] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class DeviceBehaviorListResponse(BaseModel):
    items: List[DeviceBehaviorRead] = Field(default_factory=list)
    total: int = 0


class BehaviorClearResponse(BaseModel):
    device_id: str
    cleared: int = 0
