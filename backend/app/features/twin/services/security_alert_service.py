import hashlib
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.features.twin.repositories.security_alert_repository import SecurityAlertRepository
from app.features.twin.schemas.security_alert import (
    SecurityAlertCreate,
    SecurityAlertListResponse,
    SecurityAlertResponse,
)
from app.shared.logging_context import structured_extra
from app.shared.utils.logging import get_logger

logger = get_logger(__name__)

# Keep in sync with detection-engine/rules/alerts.py COOLDOWN_SECONDS.
COOLDOWN_SECONDS: dict[str, int] = {
    "rapid_public_ip_changes": 15 * 60,
    "double_ip_change_10m": 10 * 60,
    "network_type_flapping": 10 * 60,
    "network_flap_5m": 5 * 60,
    "repeated_network_summary": 10 * 60,
    "established_count_spike": 15 * 60,
    "listening_port_spike": 15 * 60,
    "foreground_connections_spike": 15 * 60,
    "high_listening_while_active": 5 * 60,
    "network_change_while_active": 5 * 60,
    "ip_change_while_idle": 5 * 60,
    "active_ip_churn": 30 * 60,
    "stale_client_details": 20 * 60,
    "missing_network_telemetry": 30 * 60,
    "idle_with_network_activity": 15 * 60,
}


def _fingerprint(item: SecurityAlertCreate) -> str:
    """Stable identity for an alert so re-evaluation / replay does not duplicate rows."""
    if item.fingerprint:
        return item.fingerprint
    cooldown = COOLDOWN_SECONDS.get(item.alert_type)
    if cooldown:
        ts = item.timestamp
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        bucket = int(ts.timestamp()) // cooldown
        anchor = f"bucket:{bucket}"
    else:
        anchor = item.event_id or item.timestamp.isoformat()
    raw = f"{item.device_id}|{item.alert_type}|{anchor}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


class SecurityAlertService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = SecurityAlertRepository(db)

    def ingest(self, alerts: list[SecurityAlertCreate]) -> int:
        """Persist alerts to Postgres (durable history, all severities).

        Detection-engine may still keep a hot in-memory window; ingest is
        write-through so restarts do not lose alert history.
        """
        created = 0
        skipped = 0
        seen_in_batch: set[str] = set()
        for item in alerts:
            fingerprint = _fingerprint(item)
            if fingerprint in seen_in_batch or self.repo.exists_fingerprint(fingerprint):
                skipped += 1
                continue
            try:
                self.repo.create(
                    timestamp=item.timestamp,
                    device_id=item.device_id,
                    event_id=item.event_id,
                    event_type=item.event_type,
                    alert_type=item.alert_type,
                    severity=item.severity,
                    message=item.message,
                    detail=item.detail,
                    fingerprint=fingerprint,
                )
                self.db.commit()
            except IntegrityError:
                # Concurrent ingest inserted the same fingerprint first.
                self.db.rollback()
                skipped += 1
                continue
            seen_in_batch.add(fingerprint)
            created += 1
        if created or skipped:
            logger.warning(
                "Security alerts ingested",
                extra=structured_extra(
                    "security_alerts_ingested", count=created, skipped=skipped
                ),
            )
        return created

    def list_alerts(
        self,
        *,
        page: int = 1,
        page_size: int = 50,
        alert_type: Optional[str] = None,
        device_id: Optional[str] = None,
        severity: Optional[str] = None,
    ) -> SecurityAlertListResponse:
        """List alerts from Postgres (durable source of truth)."""
        items, total = self.repo.get_recent(
            page=page,
            page_size=page_size,
            alert_type=alert_type,
            device_id=device_id,
            severity=severity,
        )
        return SecurityAlertListResponse(
            items=[SecurityAlertResponse.model_validate(item) for item in items],
            total=total,
            page=page,
            page_size=page_size,
            pages=(total + page_size - 1) // page_size if page_size else 0,
        )
