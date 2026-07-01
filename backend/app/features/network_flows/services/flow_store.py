from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

from app.features.network_flows.schemas.network_flow import (
    DnsResolutionCreate,
    NetworkFlowCreate,
    NetworkFlowLiveItem,
)
from app.shared.config import settings
from app.shared.redis_client import get_redis, redis_available

FLOW_SAMPLE_PREFIX = "ng:flows:sample:"
RESOLUTION_PREFIX = "ng:dns:ipmap:"

_memory_lock = threading.Lock()
_memory_flows: list[dict[str, Any]] = []
_memory_resolutions: dict[str, dict[str, Any]] = {}


@dataclass(frozen=True)
class StoredFlow:
    client_ip: str
    protocol: str
    dest_ip: str
    dest_port: Optional[int]
    src_port: Optional[int]
    state: str
    correlated_domain: Optional[str]
    attributed_app_slug: Optional[str]
    attributed_app_display_name: Optional[str]
    observed_at: datetime


def _ms_now() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _max_age_ms() -> int:
    sec = max(1, int(settings.NETWORK_FLOWS_MAX_AGE_SEC))
    return sec * 1000


def _resolution_key(client_ip: str, resolved_ip: str) -> str:
    return f"{RESOLUTION_PREFIX}{client_ip.strip()}:{resolved_ip.strip()}"


def flow_dedupe_key(flow: NetworkFlowCreate) -> str:
    port = flow.dest_port if flow.dest_port is not None else 0
    src = flow.src_port if flow.src_port is not None else 0
    return f"{flow.client_ip}|{flow.protocol}|{flow.dest_ip}|{port}|{src}"


def _flow_dedupe_key(flow: NetworkFlowCreate) -> str:
    return flow_dedupe_key(flow)


def record_resolutions(resolutions: list[DnsResolutionCreate]) -> int:
    if not resolutions:
        return 0

    ttl_sec = max(60, int(settings.NETWORK_FLOWS_DNS_RESOLUTION_TTL_SEC))
    stored = 0

    if redis_available():
        r = get_redis()
        pipe = r.pipeline()
        for item in resolutions:
            key = _resolution_key(item.client_ip, item.resolved_ip)
            doc = {
                "domain": item.domain.strip().lower(),
                "client_ip": item.client_ip.strip(),
                "resolved_ip": item.resolved_ip.strip(),
                "timestamp_ms": int(item.timestamp.timestamp() * 1000),
            }
            pipe.setex(key, ttl_sec, json.dumps(doc, separators=(",", ":")))
            stored += 1
        pipe.execute()
        return stored

    with _memory_lock:
        for item in resolutions:
            key = _resolution_key(item.client_ip, item.resolved_ip)
            _memory_resolutions[key] = {
                "domain": item.domain.strip().lower(),
                "client_ip": item.client_ip.strip(),
                "resolved_ip": item.resolved_ip.strip(),
                "timestamp_ms": int(item.timestamp.timestamp() * 1000),
            }
            stored += 1
    return stored


def lookup_domain(client_ip: str, dest_ip: str) -> Optional[str]:
    key = _resolution_key(client_ip, dest_ip)
    if redis_available():
        raw = get_redis().get(key)
        if not raw:
            return None
        try:
            doc = json.loads(raw)
            return doc.get("domain")
        except json.JSONDecodeError:
            return None

    with _memory_lock:
        doc = _memory_resolutions.get(key)
        return doc.get("domain") if doc else None


def record_flows(
    flows: list[NetworkFlowCreate],
    *,
    correlated_domains: dict[str, Optional[str]],
    attribution: dict[str, tuple[Optional[str], Optional[str]]],
) -> int:
    if not flows:
        return 0

    now_ms = _ms_now()
    cutoff = now_ms - _max_age_ms()
    stored = 0

    if redis_available():
        r = get_redis()
        pipe = r.pipeline()
        for flow in flows:
            dedupe = _flow_dedupe_key(flow)
            key = f"{FLOW_SAMPLE_PREFIX}{dedupe}"
            domain = correlated_domains.get(dedupe)
            slug, display = attribution.get(flow.client_ip, (None, None))
            doc = {
                "client_ip": flow.client_ip.strip(),
                "protocol": flow.protocol,
                "dest_ip": flow.dest_ip.strip(),
                "dest_port": flow.dest_port,
                "src_port": flow.src_port,
                "state": flow.state,
                "correlated_domain": domain,
                "attributed_app_slug": slug,
                "attributed_app_display_name": display,
                "observed_at_ms": int(flow.observed_at.timestamp() * 1000),
            }
            pipe.setex(key, max(1, int(settings.NETWORK_FLOWS_MAX_AGE_SEC)), json.dumps(doc, separators=(",", ":")))
            stored += 1
        pipe.execute()
        _prune_redis_flow_index(cutoff)
        return stored

    with _memory_lock:
        global _memory_flows
        for flow in flows:
            dedupe = _flow_dedupe_key(flow)
            domain = correlated_domains.get(dedupe)
            slug, display = attribution.get(flow.client_ip, (None, None))
            _memory_flows.append(
                {
                    "client_ip": flow.client_ip.strip(),
                    "protocol": flow.protocol,
                    "dest_ip": flow.dest_ip.strip(),
                    "dest_port": flow.dest_port,
                    "src_port": flow.src_port,
                    "state": flow.state,
                    "correlated_domain": domain,
                    "attributed_app_slug": slug,
                    "attributed_app_display_name": display,
                    "observed_at_ms": int(flow.observed_at.timestamp() * 1000),
                }
            )
            stored += 1
        _memory_flows = [f for f in _memory_flows if f.get("observed_at_ms", 0) >= cutoff]
    return stored


def _prune_redis_flow_index(cutoff_ms: int) -> None:
    """Best-effort prune: keys use TTL; no global index required."""
    _ = cutoff_ms


def list_recent_flows(max_age_sec: Optional[int] = None) -> list[StoredFlow]:
    age_ms = (max_age_sec or settings.NETWORK_FLOWS_MAX_AGE_SEC) * 1000
    cutoff = _ms_now() - max(1000, age_ms)
    items: list[StoredFlow] = []

    if redis_available():
        r = get_redis()
        for key in r.scan_iter(f"{FLOW_SAMPLE_PREFIX}*", count=200):
            raw = r.get(key)
            if not raw:
                continue
            try:
                doc = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if doc.get("observed_at_ms", 0) < cutoff:
                continue
            items.append(_doc_to_stored(doc))
        items.sort(key=lambda f: f.observed_at, reverse=True)
        return items[: max(1, int(settings.NETWORK_FLOWS_MAP_LIMIT))]

    with _memory_lock:
        for doc in _memory_flows:
            if doc.get("observed_at_ms", 0) < cutoff:
                continue
            items.append(_doc_to_stored(doc))
    items.sort(key=lambda f: f.observed_at, reverse=True)
    return items[: max(1, int(settings.NETWORK_FLOWS_MAP_LIMIT))]


def _doc_to_stored(doc: dict[str, Any]) -> StoredFlow:
    observed_ms = int(doc.get("observed_at_ms") or 0)
    return StoredFlow(
        client_ip=str(doc.get("client_ip") or ""),
        protocol=str(doc.get("protocol") or "tcp"),
        dest_ip=str(doc.get("dest_ip") or ""),
        dest_port=doc.get("dest_port"),
        src_port=doc.get("src_port"),
        state=str(doc.get("state") or "UNKNOWN"),
        correlated_domain=doc.get("correlated_domain"),
        attributed_app_slug=doc.get("attributed_app_slug"),
        attributed_app_display_name=doc.get("attributed_app_display_name"),
        observed_at=datetime.fromtimestamp(observed_ms / 1000.0, tz=timezone.utc),
    )


def to_live_items(flows: list[StoredFlow]) -> list[NetworkFlowLiveItem]:
    return [
        NetworkFlowLiveItem(
            client_ip=f.client_ip,
            protocol=f.protocol,
            dest_ip=f.dest_ip,
            dest_port=f.dest_port,
            src_port=f.src_port,
            state=f.state,
            correlated_domain=f.correlated_domain,
            attributed_app_slug=f.attributed_app_slug,
            attributed_app_display_name=f.attributed_app_display_name,
            observed_at=f.observed_at,
        )
        for f in flows
    ]


def clear_memory_store_for_tests() -> None:
    global _memory_flows, _memory_resolutions
    with _memory_lock:
        _memory_flows = []
        _memory_resolutions = {}
