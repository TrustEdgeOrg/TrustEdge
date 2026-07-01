#!/usr/bin/env python3
"""
TrustEdge Flow Watcher — sample conntrack for VPN client L4 flows.

Runs on the EC2 host (same trust boundary as dns_log_watcher).
Posts samples to POST /network-flows/bulk using DNS_INGEST_TOKEN.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

from conntrack_parser import flows_to_api_payload, list_conntrack_flows
from log_config import setup_logging, structured_extra

logger = setup_logging(service="flow-watcher", logger_name=__name__)

API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")
DNS_INGEST_TOKEN = os.getenv("DNS_INGEST_TOKEN", "").strip()
VPN_POOL_CIDR = os.getenv("VPN_POOL_CIDR", "10.0.0.0/24")
POLL_INTERVAL = float(os.getenv("FLOW_POLL_INTERVAL", "5"))
BATCH_SIZE = int(os.getenv("FLOW_BATCH_SIZE", "100"))


def send_to_api(flows: list[dict], api_url: str) -> bool:
    if not flows:
        return True

    url = f"{api_url.rstrip('/')}/network-flows/bulk"
    payload = json.dumps({"flows": flows[:BATCH_SIZE]}).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if DNS_INGEST_TOKEN:
        headers["Authorization"] = f"Bearer {DNS_INGEST_TOKEN}"

    try:
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=10) as response:
            if response.status in (200, 201):
                logger.info(
                    "Flow ingest batch sent",
                    extra=structured_extra("flow_ingest_batch_ok", batch_size=len(flows)),
                )
                return True
            logger.error(
                "Flow ingest API error",
                extra=structured_extra("flow_ingest_failed", status_code=response.status),
            )
            return False
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        logger.error(
            "Flow ingest HTTP error",
            extra=structured_extra("flow_ingest_failed", status_code=e.code, body=body[:500]),
        )
        return False
    except urllib.error.URLError as e:
        logger.error(
            "Flow ingest connection error",
            extra=structured_extra("flow_ingest_failed", error=str(e.reason)),
        )
        return False
    except Exception as e:
        logger.error(
            "Flow ingest failed",
            extra=structured_extra("flow_ingest_failed", error=str(e)),
        )
        return False


def wait_for_api(api_url: str, max_retries: int = 30, retry_interval: int = 10) -> None:
    health_url = f"{api_url.rstrip('/')}/health"
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(health_url, timeout=5) as response:
                if response.status == 200:
                    logger.info(
                        "Flow watcher connected to backend",
                        extra=structured_extra("flow_watcher_started", api_url=api_url),
                    )
                    return
        except Exception:
            if attempt == 0 or (attempt + 1) % 6 == 0:
                logger.warning(
                    "Waiting for backend API",
                    extra=structured_extra("flow_watcher_waiting_api", attempt=attempt + 1),
                )
        time.sleep(retry_interval)
    raise RuntimeError("Backend API not available")


def main() -> int:
    wait_for_api(API_BASE_URL)
    while True:
        try:
            parsed = list_conntrack_flows(VPN_POOL_CIDR)
            payload = flows_to_api_payload(parsed, observed_at=datetime.now(timezone.utc))
            send_to_api(payload, API_BASE_URL)
            time.sleep(POLL_INTERVAL)
        except KeyboardInterrupt:
            logger.info("Flow watcher shutting down", extra=structured_extra("flow_watcher_shutdown"))
            return 0
        except Exception as e:
            logger.error(
                "Flow watcher error",
                extra=structured_extra("flow_watcher_error", error=str(e)),
                exc_info=True,
            )
            time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    sys.exit(main())
