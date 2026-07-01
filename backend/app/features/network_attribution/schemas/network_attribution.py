from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class AppUsageInterval(BaseModel):
    started_at: datetime
    duration_sec: float = Field(gt=0, le=3600)
    bundle_id: str = ""
    app_name: str = ""


class NetworkAttributionReportRequest(BaseModel):
    device_id: str = Field(min_length=1, max_length=64)
    intervals: List[AppUsageInterval] = Field(min_length=1, max_length=500)


class NetworkAttributionReportResponse(BaseModel):
    stored: bool = True
    intervals_received: int = 0


class AppUsageHourlyRead(BaseModel):
    window_start: datetime
    hour_utc: int
    app_slug: str
    app_display_name: str
    active_seconds: int
    sample_count: int
    active_minutes: float
    usage_share_pct: float


class AppUsageHourlyListResponse(BaseModel):
    device_id: int
    hours: int
    items: List[AppUsageHourlyRead]


class AppUsageSummaryItem(BaseModel):
    app_slug: str
    app_display_name: str
    total_active_seconds: int
    total_active_hours: float
    hourly_bucket_count: int
    avg_active_minutes_per_hour: float


class AppUsageSummaryResponse(BaseModel):
    device_id: int
    hours: int
    items: List[AppUsageSummaryItem]


class NetworkMapNode(BaseModel):
    id: str
    type: Literal["device", "app", "domain", "flow"]
    label: str
    app_slug: Optional[str] = None
    client_ip: Optional[str] = None
    device_id: Optional[int] = None
    blocked: Optional[bool] = None
    fresh: Optional[bool] = None


class NetworkMapEdge(BaseModel):
    source: str
    target: str
    kind: Literal["foreground", "dns", "dns_direct", "flow_session", "dns_to_flow"]
    query_count: int = 1
    blocked_count: int = 0


class NetworkMapResponse(BaseModel):
    generated_at: datetime
    minutes: int
    nodes: List[NetworkMapNode]
    edges: List[NetworkMapEdge]
