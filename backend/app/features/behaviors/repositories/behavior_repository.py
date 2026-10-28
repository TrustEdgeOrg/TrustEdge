from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.features.behaviors.models.device_behavior import DeviceBehavior
from app.features.behaviors.schemas.behavior import BehaviorObserveRequest

KIND_PROCESS_COMM = "process_comm"


class BehaviorRepository:
    def __init__(self, db: Session):
        self.db = db

    def get(
        self,
        *,
        device_id: str,
        behavior_kind: str,
        behavior_key: str,
    ) -> Optional[DeviceBehavior]:
        return (
            self.db.query(DeviceBehavior)
            .filter(
                DeviceBehavior.device_id == device_id,
                DeviceBehavior.behavior_kind == behavior_kind,
                DeviceBehavior.behavior_key == behavior_key,
            )
            .first()
        )

    def list_for_device(self, device_id: str, *, limit: int = 100) -> List[DeviceBehavior]:
        return (
            self.db.query(DeviceBehavior)
            .filter(DeviceBehavior.device_id == device_id)
            .order_by(DeviceBehavior.count.desc(), DeviceBehavior.last_seen_at.desc())
            .limit(limit)
            .all()
        )

    def delete_for_device(self, device_id: str) -> int:
        """Drop all learned rows for a device. Returns how many were deleted."""
        device_id = device_id.strip()
        if not device_id:
            return 0
        deleted = (
            self.db.query(DeviceBehavior)
            .filter(DeviceBehavior.device_id == device_id)
            .delete(synchronize_session=False)
        )
        self.db.commit()
        return int(deleted or 0)

    def process_comm_profile_stats(self, device_id: str) -> Tuple[int, Optional[datetime]]:
        """Return (distinct process_comm key count, oldest first_seen_at) for a device."""
        device_id = device_id.strip()
        count = (
            self.db.query(func.count())
            .select_from(DeviceBehavior)
            .filter(
                DeviceBehavior.device_id == device_id,
                DeviceBehavior.behavior_kind == KIND_PROCESS_COMM,
            )
            .scalar()
        )
        oldest = (
            self.db.query(func.min(DeviceBehavior.first_seen_at))
            .filter(
                DeviceBehavior.device_id == device_id,
                DeviceBehavior.behavior_kind == KIND_PROCESS_COMM,
            )
            .scalar()
        )
        return int(count or 0), oldest

    def observe(self, data: BehaviorObserveRequest) -> DeviceBehavior:
        now = datetime.now(timezone.utc)
        device_id = data.device_id.strip()
        kind = data.behavior_kind.strip()
        key = data.behavior_key.strip()
        row = self.get(device_id=device_id, behavior_kind=kind, behavior_key=key)
        if row is None:
            row = DeviceBehavior(
                device_id=device_id,
                behavior_kind=kind,
                behavior_key=key,
                alert_type=(data.alert_type or None),
                count=1,
                first_seen_at=now,
                last_seen_at=now,
                last_alert_at=now if data.emitted_alert else None,
                meta=data.meta if isinstance(data.meta, dict) else None,
                created_at=now,
                updated_at=now,
            )
            self.db.add(row)
        else:
            row.count = int(row.count or 0) + 1
            row.last_seen_at = now
            row.updated_at = now
            if data.alert_type:
                row.alert_type = data.alert_type
            if data.emitted_alert:
                row.last_alert_at = now
            if isinstance(data.meta, dict) and data.meta:
                existing: dict[str, Any] = row.meta if isinstance(row.meta, dict) else {}
                merged = dict(existing)
                merged.update(data.meta)
                row.meta = merged

        self.db.commit()
        self.db.refresh(row)
        return row
