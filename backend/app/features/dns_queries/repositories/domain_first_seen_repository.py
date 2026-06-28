from datetime import datetime, timezone
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from app.features.dns_queries.models.domain_first_seen import DomainFirstSeen


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


class DomainFirstSeenRepository:
    def __init__(self, db: Session):
        self.db = db

    def get(self, client_ip: str, root_domain: str) -> Optional[DomainFirstSeen]:
        return (
            self.db.query(DomainFirstSeen)
            .filter(
                DomainFirstSeen.client_ip == client_ip,
                DomainFirstSeen.root_domain == root_domain,
            )
            .first()
        )

    def record_first_seen(
        self,
        client_ip: str,
        root_domain: str,
        first_seen_at: datetime,
    ) -> DomainFirstSeen:
        row = DomainFirstSeen(
            client_ip=client_ip,
            root_domain=root_domain,
            first_seen_at=_as_utc(first_seen_at),
            last_seen_at=_as_utc(first_seen_at),
        )
        self.db.add(row)
        self.db.flush()
        return row

    def touch(self, client_ip: str, root_domain: str, seen_at: datetime) -> bool:
        """Upsert recency for a client/root pair. Returns True if a row was created or updated."""
        existing = self.get(client_ip, root_domain)
        if existing is None:
            self.record_first_seen(client_ip, root_domain, seen_at)
            return True

        ts = _as_utc(seen_at)

        if existing.last_seen_at is None or ts >= _as_utc(existing.last_seen_at):
            existing.last_seen_at = ts
            return True
        return False

    def list_recent_since(self, since: datetime) -> List[Tuple[str, str, datetime]]:
        """Return (client_ip, root_domain, last_seen_at) for roots seen since *since*."""
        rows = (
            self.db.query(
                DomainFirstSeen.client_ip,
                DomainFirstSeen.root_domain,
                DomainFirstSeen.last_seen_at,
            )
            .filter(DomainFirstSeen.last_seen_at >= since)
            .order_by(DomainFirstSeen.last_seen_at.desc())
            .all()
        )
        return [(client_ip, root, last_seen) for client_ip, root, last_seen in rows]
