from sqlalchemy import Column, Integer, String, DateTime, UniqueConstraint
from datetime import datetime, timezone
from app.shared.database import Base


class DomainFirstSeen(Base):
    __tablename__ = "domain_first_seen"

    id = Column(Integer, primary_key=True, index=True)
    client_ip = Column(String(45), nullable=False, index=True)
    root_domain = Column(String(255), nullable=False, index=True)
    first_seen_at = Column(DateTime(timezone=True), nullable=False)
    last_seen_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        UniqueConstraint("client_ip", "root_domain", name="uq_domain_first_seen_client_root"),
    )
