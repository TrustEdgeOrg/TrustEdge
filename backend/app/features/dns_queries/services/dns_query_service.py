from typing import List, Optional
from datetime import datetime
from sqlalchemy.orm import Session
from app.features.dns_queries.repositories.dns_query_repository import DnsQueryRepository
from app.features.dns_queries.repositories.dns_alert_repository import DnsAlertRepository
from app.features.dns_queries.schemas.dns_query import DnsQueryCreate, DnsQueryResponse
from app.features.dns_queries.schemas.dns_alert import DnsAlertResponse
from app.features.dns_queries.services.dns_query_service_interface import IDnsQueryService
from app.features.dns_queries.dns_persist import filter_queries_to_persist, should_persist_query
from app.features.dns_queries.dns_ingest_stats import ingest_stats
from app.features.dns_queries.services.dns_anomaly_service import DnsAnomalyService
from app.features.client_behavior.services.client_behavior_aggregator import ClientBehaviorAggregator
from app.features.policy.services.forbidden_country_service import ForbiddenCountryService
from app.features.client_behavior.services.behavior_scoring_service import BehaviorScoringService
from app.features.devices.repositories.device_repository import DeviceRepository
from app.features.network_attribution.services.network_attribution_service import NetworkAttributionService
from app.shared.config import settings
from app.shared.logging_context import structured_extra
from app.shared.utils.logging import get_logger

logger = get_logger(__name__)


def _use_live_aggregates(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
) -> bool:
    """Use in-memory counters when selective persistence is on and no date filter."""
    if settings.PERSIST_ALL_DNS:
        return False
    return start_date is None and end_date is None


class DnsQueryService:
    """Implementation of IDnsQueryService."""

    def create_query(self, dns_query_data: DnsQueryCreate, db: Session) -> DnsQueryResponse:
        NetworkAttributionService(db).enrich_dns_queries([dns_query_data])
        device_repository = DeviceRepository(db)
        device_repository.ensure_devices_for_client_ips([dns_query_data.client_ip])
        ingest_stats.record([dns_query_data])
        DnsAnomalyService(db).process_queries([dns_query_data])
        ClientBehaviorAggregator(db).process_queries([dns_query_data])
        forbidden_alerts = ForbiddenCountryService(db).process_queries([dns_query_data])
        behavior_alerts = BehaviorScoringService(db).process_queries([dns_query_data])
        if forbidden_alerts or behavior_alerts:
            db.commit()

        if not should_persist_query(dns_query_data):
            return DnsQueryResponse(
                id=0,
                timestamp=dns_query_data.timestamp,
                client_ip=dns_query_data.client_ip,
                domain=dns_query_data.domain,
                query_type=dns_query_data.query_type,
                action=dns_query_data.action,
                blocked=dns_query_data.blocked,
                attributed_app_slug=dns_query_data.attributed_app_slug,
                attributed_app_display_name=dns_query_data.attributed_app_display_name,
                created_at=None,
            )

        repository = DnsQueryRepository(db)
        dns_query = repository.create(dns_query_data)
        logger.info(
            "DNS query persisted",
            extra=structured_extra(
                "dns_query_persisted",
                domain=dns_query_data.domain,
                blocked=dns_query_data.blocked,
                client_ip=dns_query_data.client_ip,
                id=getattr(dns_query, "id", None),
            ),
        )
        return DnsQueryResponse.model_validate(dns_query)

    def bulk_create_queries(self, queries: List[DnsQueryCreate], db: Session) -> dict:
        NetworkAttributionService(db).enrich_dns_queries(queries)
        device_repository = DeviceRepository(db)
        device_repository.ensure_devices_for_client_ips([q.client_ip for q in queries])
        ingest_stats.record(queries)
        alerts_created = DnsAnomalyService(db).process_queries(queries)
        ClientBehaviorAggregator(db).process_queries(queries)
        alerts_created += ForbiddenCountryService(db).process_queries(queries)
        alerts_created += BehaviorScoringService(db).process_queries(queries)
        db.commit()

        to_persist = filter_queries_to_persist(queries)
        inserted = 0
        if to_persist:
            repository = DnsQueryRepository(db)
            inserted = repository.bulk_create(to_persist)

        logger.info(
            "DNS bulk ingest processed",
            extra=structured_extra(
                "dns_bulk_ingest",
                received=len(queries),
                inserted=inserted,
                skipped=len(queries) - inserted,
                alerts_created=alerts_created,
            ),
        )

        return {
            "received": len(queries),
            "inserted": inserted,
            "skipped": len(queries) - inserted,
            "alerts_created": alerts_created,
        }

    def get_queries(
        self,
        db: Session,
        page: int = 1,
        page_size: int = 50,
        domain_search: Optional[str] = None,
        client_ip: Optional[str] = None,
        blocked_only: bool = False,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> dict:
        repository = DnsQueryRepository(db)
        items, total = repository.get_all(
            page=page,
            page_size=page_size,
            domain_search=domain_search,
            client_ip=client_ip,
            blocked_only=blocked_only,
            start_date=start_date,
            end_date=end_date
        )
        client_ips = list({item.client_ip for item in items})
        identity_map = DeviceRepository(db).get_identity_map_by_client_ips(client_ips)
        return {
            "items": [
                DnsQueryResponse.model_validate(item).model_copy(
                    update=identity_map.get(
                        item.client_ip,
                        {"device_name": None, "device_vendor": None, "user_name": None}
                    )
                )
                for item in items
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": (total + page_size - 1) // page_size
        }

    def get_stats(
        self,
        db: Session,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> dict:
        if _use_live_aggregates(start_date, end_date):
            return ingest_stats.get_stats()

        repository = DnsQueryRepository(db)
        stats = repository.get_stats(start_date=start_date, end_date=end_date)
        stats["source"] = "database"
        return stats

    def get_unique_clients(self, db: Session) -> List[str]:
        if not settings.PERSIST_ALL_DNS:
            live_clients = set(ingest_stats.get_unique_clients())
            db_clients = set(DnsQueryRepository(db).get_unique_clients())
            return sorted(live_clients | db_clients)

        repository = DnsQueryRepository(db)
        return repository.get_unique_clients()

    def get_alerts(
        self,
        db: Session,
        page: int = 1,
        page_size: int = 50,
        alert_type: Optional[str] = None,
        client_ip: Optional[str] = None,
    ) -> dict:
        repository = DnsAlertRepository(db)
        items, total = repository.get_recent(
            page=page,
            page_size=page_size,
            alert_type=alert_type,
            client_ip=client_ip,
        )
        return {
            "items": [DnsAlertResponse.model_validate(item) for item in items],
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": (total + page_size - 1) // page_size if page_size else 0,
        }

    def cleanup_old_records(self, db: Session, days: int = 30) -> dict:
        repository = DnsQueryRepository(db)
        logger.info(
            "Cleaning up old DNS records",
            extra=structured_extra("dns_cleanup_started", days=days),
        )
        count = repository.delete_old_records(days=days)
        logger.info(
            "Old DNS records deleted",
            extra=structured_extra("dns_cleanup_completed", deleted=count),
        )
        return {"deleted": count}

    def get_grouped_by_site(
        self,
        db: Session,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        client_ip: Optional[str] = None,
        blocked_only: bool = False,
        filter_noise: bool = True,
        limit: int = 50
    ) -> dict:
        if _use_live_aggregates(start_date, end_date) and client_ip is None:
            return ingest_stats.get_grouped_sites(
                blocked_only=blocked_only,
                filter_noise=filter_noise,
                limit=limit,
            )

        repository = DnsQueryRepository(db)
        result = repository.get_grouped_by_site(
            start_date=start_date,
            end_date=end_date,
            client_ip=client_ip,
            blocked_only=blocked_only,
            filter_noise=filter_noise,
            limit=limit,
        )
        result["source"] = "database"
        return result
