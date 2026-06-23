from sqlalchemy import Column, Integer, String, DateTime, Boolean
from datetime import datetime, timezone
from app.shared.database import Base


class DnsQuery(Base):
    __tablename__ = "dns_queries"
    
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime(timezone=True), nullable=False)
    client_ip = Column(String(45), nullable=False, index=True)  # IPv6 max length
    domain = Column(String(255), nullable=False, index=True)
    query_type = Column(String(10), nullable=True)  # A, AAAA, MX, etc.
    action = Column(String(20), nullable=True)  # forwarded, blocked, cached
    blocked = Column(Boolean, default=False, nullable=False, index=True)
    attributed_app_slug = Column(String(64), nullable=True, index=True)
    attributed_app_display_name = Column(String(128), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
