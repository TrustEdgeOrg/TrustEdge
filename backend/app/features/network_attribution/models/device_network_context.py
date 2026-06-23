from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from app.shared.database import Base


class DeviceNetworkContext(Base):
    """Latest foreground application context for DNS network attribution."""

    __tablename__ = "device_network_context"

    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), primary_key=True)
    app_slug = Column(String(64), nullable=False)
    app_display_name = Column(String(128), nullable=False)
    bundle_id = Column(String(255), nullable=True)
    observed_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
