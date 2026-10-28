from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from log_config import setup_logging, structured_extra

LOG = setup_logging(service=os.getenv("LOG_SERVICE", "detection-engine"), logger_name=__name__)


def _env(name: str, default: str) -> str:
    return os.getenv(name, default).strip()


def post_alerts(alerts: list[dict[str, Any]]) -> bool:
    if not alerts:
        return True
    base = _env("API_BASE_URL", "http://backend:8000").rstrip("/")
    token = _env("TRUSTEDGE_INGEST_TOKEN", "")
    url = f"{base}/security/alerts/ingest"
    body = json.dumps(alerts).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            LOG.info(
                "alerts ingested",
                extra=structured_extra("alerts_posted", created=payload.get("created", 0)),
            )
            return True
    except urllib.error.HTTPError as exc:
        LOG.error(
            "alert ingest failed",
            extra=structured_extra("alerts_post_failed", status=exc.code, body=exc.read()[:500]),
        )
        return False
    except Exception as exc:
        LOG.exception("alert ingest error: %s", exc)
        return False


def post_agent_actions(events: list[dict[str, Any]]) -> bool:
    """Persist ai_agent_action events to backend Postgres (fail-open)."""
    if not events:
        return True
    base = _env("API_BASE_URL", "http://backend:8000").rstrip("/")
    token = _env("TRUSTEDGE_INGEST_TOKEN", "")
    url = f"{base}/internal/agent-actions/ingest"
    body = json.dumps(events).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            LOG.info(
                "agent actions ingested",
                extra=structured_extra(
                    "agent_actions_posted",
                    created=payload.get("created", 0),
                    skipped=payload.get("skipped", 0),
                ),
            )
            return True
    except urllib.error.HTTPError as exc:
        LOG.warning(
            "agent action ingest failed",
            extra=structured_extra(
                "agent_actions_post_failed",
                status=exc.code,
                body=exc.read()[:500],
            ),
        )
        return False
    except Exception as exc:
        LOG.warning("agent action ingest error: %s", exc)
        return False


def observe_behavior(
    *,
    device_id: str,
    behavior_kind: str,
    behavior_key: str,
    alert_type: str | None = None,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Record a behavior observation; returns suppress decision or None on failure/disabled."""
    if _env("TRUSTEDGE_BEHAVIOR_BASELINE", "1").lower() in ("0", "false", "no", "off"):
        return None
    base = _env("API_BASE_URL", "http://backend:8000").rstrip("/")
    token = _env("TRUSTEDGE_INGEST_TOKEN", "")
    url = f"{base}/internal/behaviors/observe"
    payload = {
        "device_id": device_id,
        "behavior_kind": behavior_kind,
        "behavior_key": behavior_key,
        "alert_type": alert_type,
        "meta": meta or {},
    }
    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            LOG.debug(
                "behavior observed",
                extra=structured_extra(
                    "behavior_observed",
                    device_id=device_id,
                    behavior_kind=behavior_kind,
                    behavior_key=behavior_key,
                    count=result.get("count"),
                    action=result.get("action"),
                ),
            )
            return result
    except urllib.error.HTTPError as exc:
        LOG.error(
            "behavior observe failed",
            extra=structured_extra(
                "behavior_observe_failed",
                status=exc.code,
                body=exc.read()[:500],
            ),
        )
        return None
    except Exception as exc:
        LOG.exception("behavior observe error: %s", exc)
        return None


def fetch_device_behaviors(device_id: str, *, limit: int = 5000) -> list[dict[str, Any]] | None:
    """Load durable baseline rows for hydrate. None = request failed; [] = empty."""
    device = (device_id or "").strip()
    if not device:
        return []
    base = _env("API_BASE_URL", "http://backend:8000").rstrip("/")
    token = _env("TRUSTEDGE_INGEST_TOKEN", "")
    qs = urllib.parse.urlencode({"device_id": device, "limit": max(1, int(limit))})
    url = f"{base}/internal/behaviors?{qs}"
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            items = payload.get("items") if isinstance(payload, dict) else None
            if not isinstance(items, list):
                return []
            return [row for row in items if isinstance(row, dict)]
    except urllib.error.HTTPError as exc:
        LOG.warning(
            "behavior hydrate failed",
            extra=structured_extra(
                "behavior_hydrate_failed",
                device_id=device,
                status=exc.code,
                body=exc.read()[:500],
            ),
        )
        return None
    except Exception as exc:
        LOG.warning("behavior hydrate error: %s", exc)
        return None


def delete_device_behaviors(device_id: str) -> bool:
    """Flush durable baseline for a device. False on failure (fail-open)."""
    device = (device_id or "").strip()
    if not device:
        return True
    base = _env("API_BASE_URL", "http://backend:8000").rstrip("/")
    token = _env("TRUSTEDGE_INGEST_TOKEN", "")
    url = f"{base}/internal/behaviors/{urllib.parse.quote(device, safe='')}"
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers, method="DELETE")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            resp.read()
            return True
    except urllib.error.HTTPError as exc:
        LOG.warning(
            "behavior clear failed",
            extra=structured_extra(
                "behavior_clear_failed",
                device_id=device,
                status=exc.code,
                body=exc.read()[:500],
            ),
        )
        return False
    except Exception as exc:
        LOG.warning("behavior clear error: %s", exc)
        return False

