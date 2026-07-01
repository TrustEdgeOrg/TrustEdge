from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class NetworkFlowCreate(BaseModel):
    observed_at: datetime
    client_ip: str
    protocol: Literal["tcp", "udp", "icmp"] = "tcp"
    src_port: Optional[int] = Field(default=None, ge=0, le=65535)
    dest_ip: str
    dest_port: Optional[int] = Field(default=None, ge=0, le=65535)
    state: str = "UNKNOWN"
    bytes_sent: int = Field(default=0, ge=0)
    bytes_recv: int = Field(default=0, ge=0)


class NetworkFlowBulkCreate(BaseModel):
    flows: List[NetworkFlowCreate] = Field(min_length=1, max_length=500)


class NetworkFlowIngestResponse(BaseModel):
    stored: bool = True
    flows_received: int = 0


class DnsResolutionCreate(BaseModel):
    timestamp: datetime
    client_ip: str
    domain: str
    resolved_ip: str
    query_type: str = "A"


class DnsResolutionBulkCreate(BaseModel):
    resolutions: List[DnsResolutionCreate] = Field(min_length=1, max_length=500)


class DnsResolutionIngestResponse(BaseModel):
    stored: bool = True
    resolutions_received: int = 0


class NetworkFlowLiveItem(BaseModel):
    client_ip: str
    protocol: str
    dest_ip: str
    dest_port: Optional[int] = None
    src_port: Optional[int] = None
    state: str
    correlated_domain: Optional[str] = None
    attributed_app_slug: Optional[str] = None
    attributed_app_display_name: Optional[str] = None
    observed_at: datetime


class NetworkFlowLiveResponse(BaseModel):
    items: List[NetworkFlowLiveItem]
    max_age_sec: int
