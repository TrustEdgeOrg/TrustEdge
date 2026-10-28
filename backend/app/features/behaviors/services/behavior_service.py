from __future__ import annotations

import os
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.features.behaviors.repositories.behavior_repository import BehaviorRepository
from app.features.behaviors.schemas.behavior import (
    BehaviorObserveRequest,
    BehaviorObserveResponse,
    DeviceBehaviorListResponse,
    DeviceBehaviorRead,
)


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return default


class BehaviorService:
    def __init__(self, db: Session):
        self.repo = BehaviorRepository(db)
        self.suppress_count = _env_int("BEHAVIOR_SUPPRESS_COUNT", 20)
        self.suppress_age_hours = _env_int("BEHAVIOR_SUPPRESS_AGE_HOURS", 72)
        self.profile_min_keys = _env_int("BEHAVIOR_PROFILE_MIN_KEYS", 30)

    def observe(self, data: BehaviorObserveRequest) -> BehaviorObserveResponse:
        # First pass: increment without marking alert emission.
        provisional = BehaviorObserveRequest(
            device_id=data.device_id,
            behavior_kind=data.behavior_kind,
            behavior_key=data.behavior_key,
            alert_type=data.alert_type,
            meta=data.meta,
            emitted_alert=False,
        )
        row = self.repo.observe(provisional)
        established = self._is_established(row.first_seen_at, int(row.count))
        suppress = established
        action = "suppress" if suppress else "emit"

        # Only record alert emission for alert-path observes (alert_type set).
        if action == "emit" and data.alert_type:
            row.last_alert_at = datetime.now(timezone.utc)
            row.updated_at = datetime.now(timezone.utc)
            self.repo.db.commit()
            self.repo.db.refresh(row)

        profile_warm = self._profile_warm(data.device_id)

        return BehaviorObserveResponse(
            device_id=row.device_id,
            behavior_kind=row.behavior_kind,
            behavior_key=row.behavior_key,
            alert_type=row.alert_type,
            count=int(row.count),
            first_seen_at=row.first_seen_at,
            last_seen_at=row.last_seen_at,
            suppress=suppress,
            established=established,
            profile_warm=profile_warm,
            action=action,
            suppress_count=self.suppress_count,
            suppress_age_hours=self.suppress_age_hours,
            profile_min_keys=self.profile_min_keys,
        )

    def list_for_device(self, device_id: str, *, limit: int = 100) -> DeviceBehaviorListResponse:
        rows = self.repo.list_for_device(device_id.strip(), limit=limit)
        items = [DeviceBehaviorRead.model_validate(row) for row in rows]
        return DeviceBehaviorListResponse(items=items, total=len(items))

    def clear_device(self, device_id: str) -> int:
        """Remove durable baseline rows for a device (operator reset / detector flush)."""
        return self.repo.delete_for_device(device_id.strip())

    def _is_established(self, first_seen_at: datetime, count: int) -> bool:
        if count < self.suppress_count:
            return False
        first = first_seen_at
        if first.tzinfo is None:
            first = first.replace(tzinfo=timezone.utc)
        age_hours = (datetime.now(timezone.utc) - first.astimezone(timezone.utc)).total_seconds() / 3600.0
        return age_hours >= float(self.suppress_age_hours)

    def _should_suppress(self, first_seen_at: datetime, count: int) -> bool:
        return self._is_established(first_seen_at, count)

    def _profile_warm(self, device_id: str) -> bool:
        """Novelty gate: enough distinct process_comm keys or aged profile."""
        key_count, oldest = self.repo.process_comm_profile_stats(device_id)
        if key_count >= self.profile_min_keys:
            return True
        if oldest is None:
            return False
        first = oldest
        if first.tzinfo is None:
            first = first.replace(tzinfo=timezone.utc)
        age_hours = (datetime.now(timezone.utc) - first.astimezone(timezone.utc)).total_seconds() / 3600.0
        return age_hours >= float(self.suppress_age_hours)
