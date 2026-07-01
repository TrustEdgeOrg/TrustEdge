#!/usr/bin/env python3
"""
TrustEdge DNS Log Watcher — Real-time log tail and API push.

Continuously watches /var/log/dnsmasq.log for new DNS queries
and sends them to the TrustEdge backend API in near real-time.
Designed to run as a systemd service on the host machine.
"""

import os
import sys
import re
import json
import time
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Set

from log_config import setup_logging, structured_extra
from noise_filter import is_noise_domain

logger = setup_logging(service="log-watcher", logger_name=__name__)

# Configuration from environment variables
DNSMASQ_LOG_PATH = os.getenv('DNSMASQ_LOG_PATH', '/var/log/dnsmasq.log')
STATE_FILE_PATH = os.getenv('STATE_FILE_PATH', '/var/lib/trustedge/log_parser_state')
BLOCKED_DOMAINS_PATH = os.getenv('BLOCKED_DOMAINS_PATH', '/etc/dnsmasq.d/blocked-domains.conf')
API_BASE_URL = os.getenv('API_BASE_URL', 'http://localhost:8000')
DNS_INGEST_TOKEN = os.getenv('DNS_INGEST_TOKEN', '').strip()
BATCH_SIZE = int(os.getenv('BATCH_SIZE', '50'))
POLL_INTERVAL = float(os.getenv('POLL_INTERVAL', '2'))  # seconds between checks
FLUSH_INTERVAL = float(os.getenv('FLUSH_INTERVAL', '3'))  # max seconds before sending a batch
BLOCKED_DOMAINS_RELOAD_INTERVAL = int(os.getenv('BLOCKED_DOMAINS_RELOAD_INTERVAL', '300'))  # reload every 5 min

# Regex to parse dnsmasq "query" log lines
QUERY_PATTERN = re.compile(
    r'^(\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2})\s+'   # timestamp
    r'dnsmasq\[\d+\]:\s+'                      # dnsmasq process info
    r'query\[(\w+)\]\s+'                       # query type (A, AAAA, etc.)
    r'(\S+)\s+'                                # domain name
    r'from\s+(\S+)'                            # client IP
)

REPLY_PATTERN = re.compile(
    r'^(\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2})\s+'
    r'dnsmasq\[\d+\]:\s+'
    r'reply(?:\[\w+\])?\s+'
    r'(\S+)\s+'
    r'is\s+'
    r'(\S+)'
)

FLOW_RESOLUTIONS_ENABLED = os.getenv('FLOW_RESOLUTIONS_ENABLED', 'true').lower() in ('1', 'true', 'yes')


def load_blocked_domains(config_path: str) -> Set[str]:
    blocked = set()
    try:
        if not os.path.exists(config_path):
            logger.warning(
                "Blocked domains file not found",
                extra=structured_extra("blocked_domains_missing", path=config_path),
            )
            return blocked

        with open(config_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line.startswith('address=/'):
                    parts = line.split('/')
                    if len(parts) >= 3:
                        domain = parts[1]
                        if domain:
                            blocked.add(domain.lower())
    except Exception as e:
        logger.error(
            "Failed to load blocked domains",
            extra=structured_extra("blocked_domains_load_failed", error=str(e)),
        )

    return blocked


def get_last_position(state_file: str) -> int:
    try:
        if os.path.exists(state_file):
            with open(state_file, 'r') as f:
                content = f.read().strip()
                if content:
                    return int(content)
    except (ValueError, IOError) as e:
        logger.warning(
            "Failed to read log watcher state file",
            extra=structured_extra("log_watcher_state_read_failed", error=str(e)),
        )
    return 0


def save_position(state_file: str, position: int):
    try:
        state_dir = os.path.dirname(state_file)
        if state_dir:
            os.makedirs(state_dir, exist_ok=True)
        with open(state_file, 'w') as f:
            f.write(str(position))
    except IOError as e:
        logger.error(
            "Failed to save log watcher state file",
            extra=structured_extra("log_watcher_state_write_failed", error=str(e)),
        )


def parse_timestamp(timestamp_str: str) -> Optional[datetime]:
    try:
        current_year = datetime.now(timezone.utc).year
        dt = datetime.strptime(f"{current_year} {timestamp_str}", "%Y %b %d %H:%M:%S")
        return dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def parse_log_lines(
    lines: List[str],
    blocked_domains: Set[str],
    pending_clients: Optional[Dict[str, tuple[str, datetime]]] = None,
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    queries: List[Dict[str, Any]] = []
    resolutions: List[Dict[str, Any]] = []
    seen = set()
    pending = pending_clients if pending_clients is not None else {}

    for line in lines:
        match = QUERY_PATTERN.search(line)
        if match:
            timestamp_str, query_type, domain, client_ip = match.groups()
            timestamp = parse_timestamp(timestamp_str)
            if not timestamp:
                continue

            if domain.endswith('.in-addr.arpa') or domain.endswith('.ip6.arpa'):
                continue
            if is_noise_domain(domain):
                continue

            dedup_key = (timestamp.isoformat(), domain.lower(), client_ip)
            if dedup_key in seen:
                continue
            seen.add(dedup_key)

            pending[domain.lower()] = (client_ip, timestamp)

            is_blocked = domain.lower() in blocked_domains
            action = "blocked" if is_blocked else "forwarded"

            queries.append({
                "timestamp": timestamp.isoformat(),
                "client_ip": client_ip,
                "domain": domain,
                "query_type": query_type,
                "action": action,
                "blocked": is_blocked
            })
            continue

        reply = REPLY_PATTERN.search(line)
        if not reply:
            continue

        timestamp_str, domain, resolved_ip = reply.groups()
        timestamp = parse_timestamp(timestamp_str)
        if not timestamp:
            continue

        ctx = pending.get(domain.lower())
        if not ctx:
            continue

        client_ip, _query_ts = ctx
        if resolved_ip.endswith('.in-addr.arpa') or resolved_ip.endswith('.ip6.arpa'):
            continue

        resolutions.append({
            "timestamp": timestamp.isoformat(),
            "client_ip": client_ip,
            "domain": domain,
            "resolved_ip": resolved_ip,
            "query_type": "A",
        })

    return queries, resolutions


def send_to_api(queries: List[Dict[str, Any]], api_url: str) -> bool:
    """Send parsed queries to the TrustEdge API via POST /dns-queries/bulk."""
    import urllib.request
    import urllib.error

    if not queries:
        return True

    url = f"{api_url.rstrip('/')}/dns-queries/bulk"
    payload = json.dumps({"queries": queries}).encode('utf-8')

    try:
        headers = {'Content-Type': 'application/json'}
        if DNS_INGEST_TOKEN:
            headers['Authorization'] = f"Bearer {DNS_INGEST_TOKEN}"

        req = urllib.request.Request(
            url,
            data=payload,
            headers=headers,
            method='POST'
        )

        with urllib.request.urlopen(req, timeout=10) as response:
            if response.status in (200, 201):
                blocked_count = sum(1 for q in queries if q.get("blocked"))
                logger.info(
                    "DNS ingest batch sent",
                    extra=structured_extra(
                        "dns_ingest_batch_ok",
                        batch_size=len(queries),
                        blocked_count=blocked_count,
                    ),
                )
                return True
            logger.error(
                "DNS ingest API error",
                extra=structured_extra("dns_ingest_failed", status_code=response.status),
            )
            return False

    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        logger.error(
            "DNS ingest HTTP error",
            extra=structured_extra(
                "dns_ingest_failed",
                status_code=e.code,
                body=body[:500],
            ),
        )
        return False
    except urllib.error.URLError as e:
        logger.error(
            "DNS ingest connection error",
            extra=structured_extra("dns_ingest_failed", error=str(e.reason)),
        )
        return False
    except Exception as e:
        logger.error(
            "DNS ingest failed",
            extra=structured_extra("dns_ingest_failed", error=str(e)),
        )
        return False


def send_resolutions_to_api(resolutions: List[Dict[str, Any]], api_url: str) -> bool:
    import urllib.request
    import urllib.error

    if not resolutions or not FLOW_RESOLUTIONS_ENABLED:
        return True

    url = f"{api_url.rstrip('/')}/network-flows/dns-resolutions/bulk"
    payload = json.dumps({"resolutions": resolutions}).encode('utf-8')

    try:
        headers = {'Content-Type': 'application/json'}
        if DNS_INGEST_TOKEN:
            headers['Authorization'] = f"Bearer {DNS_INGEST_TOKEN}"

        req = urllib.request.Request(
            url,
            data=payload,
            headers=headers,
            method='POST'
        )

        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status in (200, 201)
    except Exception as e:
        logger.warning(
            "DNS resolution ingest failed",
            extra=structured_extra("dns_resolution_ingest_failed", error=str(e)),
        )
        return False


def wait_for_api(api_url: str, max_retries: int = 30, retry_interval: int = 10):
    import urllib.request
    import urllib.error

    health_url = f"{api_url.rstrip('/')}/health"
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(health_url, timeout=5) as response:
                if response.status == 200:
                    logger.info(
                        "Log watcher connected to backend",
                        extra=structured_extra("log_watcher_started", api_url=api_url),
                    )
                    return
        except Exception:
            if attempt == 0 or (attempt + 1) % 6 == 0:
                logger.warning(
                    "Waiting for backend API",
                    extra=structured_extra("log_watcher_waiting_api", attempt=attempt + 1),
                )
        time.sleep(retry_interval)
    logger.error(
        "Backend API unavailable",
        extra=structured_extra("log_watcher_api_unavailable", api_url=api_url),
    )
    raise RuntimeError("Backend API not available")


def main():
    wait_for_api(API_BASE_URL)
    position = get_last_position(STATE_FILE_PATH)
    blocked_domains = load_blocked_domains(BLOCKED_DOMAINS_PATH)
    last_reload = time.time()

    last_flush = time.time()
    pending: List[Dict[str, Any]] = []
    pending_resolutions: List[Dict[str, Any]] = []
    reply_context: Dict[str, tuple[str, datetime]] = {}

    while True:
        try:
            now = time.time()
            if now - last_reload >= BLOCKED_DOMAINS_RELOAD_INTERVAL:
                blocked_domains = load_blocked_domains(BLOCKED_DOMAINS_PATH)
                last_reload = now

            if not os.path.exists(DNSMASQ_LOG_PATH):
                logger.warning(
                    "dnsmasq log not found",
                    extra=structured_extra("dnsmasq_log_missing", path=DNSMASQ_LOG_PATH),
                )
                time.sleep(POLL_INTERVAL)
                continue

            with open(DNSMASQ_LOG_PATH, 'r') as f:
                f.seek(position)
                new_data = f.read()
                position = f.tell()

            if new_data:
                lines = [l for l in new_data.splitlines() if l.strip()]
                parsed_queries, parsed_resolutions = parse_log_lines(lines, blocked_domains, reply_context)
                if parsed_queries:
                    pending.extend(parsed_queries)
                if parsed_resolutions:
                    pending_resolutions.extend(parsed_resolutions)

            should_flush = len(pending) >= BATCH_SIZE or (pending and (now - last_flush) >= FLUSH_INTERVAL)
            if should_flush:
                batch = pending[:BATCH_SIZE]
                ok = send_to_api(batch, API_BASE_URL)
                if ok:
                    pending = pending[len(batch):]
                    save_position(STATE_FILE_PATH, position)
                last_flush = now

            if pending_resolutions and (now - last_flush) >= FLUSH_INTERVAL:
                resolution_batch = pending_resolutions[:BATCH_SIZE]
                if send_resolutions_to_api(resolution_batch, API_BASE_URL):
                    pending_resolutions = pending_resolutions[len(resolution_batch):]

            time.sleep(POLL_INTERVAL)
        except KeyboardInterrupt:
            logger.info(
                "Log watcher shutting down",
                extra=structured_extra("log_watcher_shutdown"),
            )
            return 0
        except Exception as e:
            logger.error(
                "Log watcher error",
                extra=structured_extra("log_watcher_error", error=str(e)),
                exc_info=True,
            )
            time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    sys.exit(main())

