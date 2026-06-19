import statistics
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from app.features.client_behavior.repositories.behavior_profile_repository import BehaviorProfileRepository
from app.features.client_behavior.repositories.behavior_rollup_repository import BehaviorRollupRepository
from app.shared.config import settings
from app.shared.utils.logging import get_logger

logger = get_logger(__name__)


class BehaviorBaselineService:
    """Recompute per-device baselines from hourly rollups."""

    def __init__(self, db: Session):
        self.db = db
        self.rollup_repo = BehaviorRollupRepository(db)
        self.profile_repo = BehaviorProfileRepository(db)

    def recompute_all(self) -> int:
        from app.features.devices.models.device import Device

        devices = self.db.query(Device.id).all()
        updated = 0
        for (device_id,) in devices:
            if self.recompute_device(device_id):
                updated += 1
        self.db.commit()
        return updated

    def recompute_device(self, device_id: int) -> bool:
        days = settings.BEHAVIOR_BASELINE_LOOKBACK_DAYS
        since = datetime.now(timezone.utc) - timedelta(days=days)
        rollups = self.rollup_repo.get_rollups_for_device(device_id, since)

        if not rollups:
            self.profile_repo.update_baseline(device_id, {}, profile_ready=False)
            return False

        total_queries = sum(r.query_count for r in rollups)
        min_queries = settings.BEHAVIOR_MIN_PROFILE_QUERIES
        min_days = settings.BEHAVIOR_MIN_PROFILE_DAYS
        min_hours = int(getattr(settings, "BEHAVIOR_MIN_PROFILE_HOURS", 0) or 0)
        required_hours = min_hours if min_hours > 0 else 24 * max(0, int(min_days))

        if len(rollups) < required_hours or total_queries < min_queries:
            self.profile_repo.update_baseline(device_id, {}, profile_ready=False)
            return False

        hourly_counts = [r.query_count for r in rollups]
        hourly_new = [r.new_roots for r in rollups]
        hour_hist: Dict[int, int] = defaultdict(int)
        for r in rollups:
            hour_hist[r.hour_utc] += r.query_count

        baseline: Dict[str, Any] = {
            "median_queries_per_hour": statistics.median(hourly_counts),
            "mad_queries_per_hour": self._mad(hourly_counts),
            "p95_queries_per_hour": self._percentile(hourly_counts, 95),
            "p95_new_roots_per_hour": self._percentile(hourly_new, 95) if hourly_new else 0,
            "avg_new_roots_per_hour": statistics.mean(hourly_new) if hourly_new else 0,
            "hour_histogram": dict(hour_hist),
            "total_queries": total_queries,
            "rollup_hours": len(rollups),
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }

        self.profile_repo.update_baseline(device_id, baseline, profile_ready=True)
        return True

    @staticmethod
    def _mad(values: List[float]) -> float:
        if not values:
            return 0.0
        med = statistics.median(values)
        deviations = [abs(v - med) for v in values]
        return statistics.median(deviations) or 1.0

    @staticmethod
    def _percentile(values: List[int], pct: int) -> float:
        if not values:
            return 0.0
        sorted_vals = sorted(values)
        idx = min(len(sorted_vals) - 1, int(len(sorted_vals) * pct / 100))
        return float(sorted_vals[idx])
