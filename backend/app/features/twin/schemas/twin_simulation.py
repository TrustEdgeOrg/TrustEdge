from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class PackToggleSimulationRequest(BaseModel):
    pack_slug: str
    enabled_globally: bool


class PackInfoRead(BaseModel):
    slug: str
    name: str
    domain_count: int


class PackStateRead(BaseModel):
    enabled_globally: bool


class RecentHitSample(BaseModel):
    root_domain: str
    device_id: int
    hostname: Optional[str] = None
    last_seen_at: datetime
    query_count_estimate: int = 1


class SimulationSummaryRead(BaseModel):
    devices_affected: int
    newly_blocked_domain_count: int
    recent_hits_count: int
    recent_hits_sample: List[RecentHitSample] = Field(default_factory=list)


class DeviceSimulationImpactRead(BaseModel):
    device_id: int
    hostname: Optional[str] = None
    added_block_count: int
    recent_hits: List[str] = Field(default_factory=list)


class PackToggleSimulationResponse(BaseModel):
    generated_at: datetime
    lookback_hours: int
    pack: PackInfoRead
    current_state: PackStateRead
    proposed_state: PackStateRead
    summary: SimulationSummaryRead
    devices: List[DeviceSimulationImpactRead] = Field(default_factory=list)
