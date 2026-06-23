from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.features.network_attribution.models.device_app_usage_rollup import DeviceAppUsageRollup
from app.features.network_attribution.models.device_network_context import DeviceNetworkContext


def _hour_bucket(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.replace(minute=0, second=0, microsecond=0)


class AppUsageRollupRepository:
    def __init__(self, db: Session):
        self.db = db

    def add_active_seconds(
        self,
        device_id: int,
        *,
        app_slug: str,
        app_display_name: str,
        started_at: datetime,
        duration_sec: float,
    ) -> None:
        if duration_sec <= 0:
            return

        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=timezone.utc)

        end_at = started_at + timedelta(seconds=duration_sec)
        cursor = started_at
        remaining = duration_sec

        while remaining > 0 and cursor < end_at:
            window = _hour_bucket(cursor)
            window_end = window + timedelta(hours=1)
            chunk_end = min(end_at, window_end)
            chunk_sec = (chunk_end - cursor).total_seconds()
            if chunk_sec <= 0:
                break

            self._upsert_bucket(
                device_id=device_id,
                window_start=window,
                app_slug=app_slug,
                app_display_name=app_display_name,
                active_seconds=int(chunk_sec),
                hour_utc=window.hour,
            )
            remaining -= chunk_sec
            cursor = chunk_end

    def _upsert_bucket(
        self,
        *,
        device_id: int,
        window_start: datetime,
        app_slug: str,
        app_display_name: str,
        active_seconds: int,
        hour_utc: int,
    ) -> None:
        now = datetime.now(timezone.utc)
        existing = (
            self.db.query(DeviceAppUsageRollup)
            .filter(
                DeviceAppUsageRollup.device_id == device_id,
                DeviceAppUsageRollup.window_start == window_start,
                DeviceAppUsageRollup.app_slug == app_slug,
            )
            .first()
        )
        if existing:
            existing.active_seconds += active_seconds
            existing.sample_count += 1
            existing.app_display_name = app_display_name
            existing.updated_at = now
            return

        self.db.add(
            DeviceAppUsageRollup(
                device_id=device_id,
                window_start=window_start,
                app_slug=app_slug,
                app_display_name=app_display_name,
                active_seconds=active_seconds,
                sample_count=1,
                hour_utc=hour_utc,
                created_at=now,
                updated_at=now,
            )
        )

    def list_rollups(
        self,
        device_id: int,
        *,
        since: datetime,
        app_slug: Optional[str] = None,
    ) -> List[DeviceAppUsageRollup]:
        q = (
            self.db.query(DeviceAppUsageRollup)
            .filter(
                DeviceAppUsageRollup.device_id == device_id,
                DeviceAppUsageRollup.window_start >= since,
            )
            .order_by(DeviceAppUsageRollup.window_start.desc(), DeviceAppUsageRollup.app_slug.asc())
        )
        if app_slug:
            q = q.filter(DeviceAppUsageRollup.app_slug == app_slug.strip().lower())
        return q.all()

    def summarize(
        self,
        device_id: int,
        *,
        since: datetime,
    ) -> List[Tuple[str, str, int, int, float]]:
        rows = (
            self.db.query(
                DeviceAppUsageRollup.app_slug,
                DeviceAppUsageRollup.app_display_name,
                func.sum(DeviceAppUsageRollup.active_seconds),
                func.count(DeviceAppUsageRollup.id),
            )
            .filter(
                DeviceAppUsageRollup.device_id == device_id,
                DeviceAppUsageRollup.window_start >= since,
            )
            .group_by(DeviceAppUsageRollup.app_slug, DeviceAppUsageRollup.app_display_name)
            .order_by(func.sum(DeviceAppUsageRollup.active_seconds).desc())
            .all()
        )
        out: List[Tuple[str, str, int, int, float]] = []
        for slug, display, total_sec, bucket_count in rows:
            total = int(total_sec or 0)
            buckets = int(bucket_count or 0)
            avg_min = (total / buckets / 60.0) if buckets > 0 else 0.0
            out.append((slug, display, total, buckets, avg_min))
        return out


class NetworkContextRepository:
    def __init__(self, db: Session):
        self.db = db

    def upsert(
        self,
        device_id: int,
        *,
        app_slug: str,
        app_display_name: str,
        bundle_id: str,
        observed_at: datetime,
    ) -> None:
        if observed_at.tzinfo is None:
            observed_at = observed_at.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        row = self.db.query(DeviceNetworkContext).filter(DeviceNetworkContext.device_id == device_id).first()
        if row:
            row.app_slug = app_slug
            row.app_display_name = app_display_name
            row.bundle_id = bundle_id or None
            row.observed_at = observed_at
            row.updated_at = now
            return
        self.db.add(
            DeviceNetworkContext(
                device_id=device_id,
                app_slug=app_slug,
                app_display_name=app_display_name,
                bundle_id=bundle_id or None,
                observed_at=observed_at,
                updated_at=now,
            )
        )

    def get(self, device_id: int) -> Optional[DeviceNetworkContext]:
        return self.db.query(DeviceNetworkContext).filter(DeviceNetworkContext.device_id == device_id).first()
