from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from app.shared.database import Base


class DeviceAppUsageRollup(Base):
    """Hourly foreground application usage per device (network attribution rollups)."""

    __tablename__ = "device_app_usage_rollups"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    window_start = Column(DateTime(timezone=True), nullable=False, index=True)
    app_slug = Column(String(64), nullable=False, index=True)
    app_display_name = Column(String(128), nullable=False)
    active_seconds = Column(Integer, nullable=False, default=0)
    sample_count = Column(Integer, nullable=False, default=0)
    hour_utc = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        UniqueConstraint("device_id", "window_start", "app_slug", name="uq_app_usage_rollup_device_window_app"),
    )
