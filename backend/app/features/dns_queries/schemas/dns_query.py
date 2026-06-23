from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List


class DnsQueryCreate(BaseModel):
    timestamp: datetime
    client_ip: str
    domain: str
    query_type: Optional[str] = None
    action: Optional[str] = None
    blocked: bool = False
    attributed_app_slug: Optional[str] = None
    attributed_app_display_name: Optional[str] = None


class DnsQueryBulkCreate(BaseModel):
    queries: List[DnsQueryCreate]


class DnsQueryResponse(BaseModel):
    id: int
    timestamp: datetime
    client_ip: str
    device_name: Optional[str] = None
    device_vendor: Optional[str] = None
    user_name: Optional[str] = None
    domain: str
    query_type: Optional[str] = None
    action: Optional[str] = None
    blocked: bool
    attributed_app_slug: Optional[str] = None
    attributed_app_display_name: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
