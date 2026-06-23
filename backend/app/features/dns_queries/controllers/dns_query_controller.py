import asyncio

from fastapi import HTTPException
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime
from app.features.dns_queries.services.dns_query_service_interface import IDnsQueryService
from app.features.dns_queries.schemas.dns_query import DnsQueryCreate, DnsQueryBulkCreate
from app.features.dns_queries.services.whois_service import WhoisLookupError, lookup_domain_whois
from app.features.network_attribution.services.network_attribution_service import NetworkAttributionService
from app.shared.logging_context import structured_extra
from app.shared.utils.logging import get_logger
from app.shared.websocket_manager import ws_manager

logger = get_logger(__name__)


def create_dns_query_controller(dns_query_data: DnsQueryCreate, db: Session, service: IDnsQueryService):
    NetworkAttributionService(db).enrich_dns_queries([dns_query_data])
    _broadcast_queries([dns_query_data])
    return service.create_query(dns_query_data, db)


def bulk_create_dns_queries_controller(bulk_data: DnsQueryBulkCreate, db: Session, service: IDnsQueryService):
    NetworkAttributionService(db).enrich_dns_queries(bulk_data.queries)
    _broadcast_queries(bulk_data.queries)
    return service.bulk_create_queries(bulk_data.queries, db)


def _broadcast_queries(queries: List[DnsQueryCreate]):
    """Broadcast new DNS queries to all connected WebSocket clients."""
    if ws_manager.connection_count == 0:
        return  # No clients connected, skip

    data = {
        "type": "dns_queries",
        "queries": [
            {
                "timestamp": q.timestamp.isoformat(),
                "client_ip": q.client_ip,
                "domain": q.domain,
                "query_type": q.query_type,
                "action": q.action,
                "blocked": q.blocked,
                "attributed_app_slug": q.attributed_app_slug,
                "attributed_app_display_name": q.attributed_app_display_name,
            }
            for q in queries
        ]
    }

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(ws_manager.broadcast(data))
        else:
            loop.run_until_complete(ws_manager.broadcast(data))
    except RuntimeError:
        # If no event loop exists, create one
        asyncio.run(ws_manager.broadcast(data))
    except Exception as e:
        logger.warning(
            "Failed to broadcast DNS queries via WebSocket",
            extra=structured_extra("dns_ws_broadcast_failed", error=str(e)),
        )


def get_dns_queries_controller(
    db: Session,
    service: IDnsQueryService,
    page: int = 1,
    page_size: int = 50,
    domain_search: Optional[str] = None,
    client_ip: Optional[str] = None,
    blocked_only: bool = False,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None
):
    return service.get_queries(
        db=db,
        page=page,
        page_size=page_size,
        domain_search=domain_search,
        client_ip=client_ip,
        blocked_only=blocked_only,
        start_date=start_date,
        end_date=end_date
    )


def get_dns_stats_controller(
    db: Session,
    service: IDnsQueryService,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None
):
    return service.get_stats(db=db, start_date=start_date, end_date=end_date)


def get_unique_clients_controller(db: Session, service: IDnsQueryService):
    return service.get_unique_clients(db)


def cleanup_old_records_controller(db: Session, service: IDnsQueryService, days: int = 30):
    return service.cleanup_old_records(db, days=days)


def get_grouped_sites_controller(
    db: Session,
    service: IDnsQueryService,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    client_ip: Optional[str] = None,
    blocked_only: bool = False,
    filter_noise: bool = True,
    limit: int = 50
):
    return service.get_grouped_by_site(
        db=db,
        start_date=start_date,
        end_date=end_date,
        client_ip=client_ip,
        blocked_only=blocked_only,
        filter_noise=filter_noise,
        limit=limit
    )


def get_dns_alerts_controller(
    db: Session,
    service: IDnsQueryService,
    page: int = 1,
    page_size: int = 50,
    alert_type: Optional[str] = None,
    client_ip: Optional[str] = None,
):
    return service.get_alerts(
        db=db,
        page=page,
        page_size=page_size,
        alert_type=alert_type,
        client_ip=client_ip,
    )


def get_domain_whois_controller(domain: str):
    try:
        return lookup_domain_whois(domain)
    except WhoisLookupError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.exception(
            "WHOIS lookup failed",
            extra=structured_extra("whois_lookup_failed", domain=domain),
        )
        raise HTTPException(status_code=502, detail="WHOIS lookup failed") from e
