"""Async Postgres write-behind for the in-memory behavior baseline.

Hot-path observe() stays in RAM. This module hydrates RAM from Postgres on first
sight of a device, then enqueues increments so a detector restart can reload
counts. Backend down → skip persist/hydrate (fail-open).
"""

from __future__ import annotations

import os
import queue
import threading
from typing import Any, Optional

from api_client import delete_device_behaviors, fetch_device_behaviors, observe_behavior
from log_config import setup_logging, structured_extra

LOG = setup_logging(service=os.getenv("LOG_SERVICE", "detection-engine"), logger_name=__name__)

_QUEUE_MAX = 10_000
_SENTINEL = object()


def _env_bool(name: str, default: str = "0") -> bool:
    return os.getenv(name, default).strip().lower() not in ("0", "false", "no", "off")


def persister_from_env() -> "BehaviorPersister":
    baseline_on = os.getenv("TRUSTEDGE_BEHAVIOR_BASELINE", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )
    post = _env_bool("TRUSTEDGE_POST_BEHAVIORS_TO_BACKEND", "0")
    return BehaviorPersister(enabled=baseline_on and post)


class BehaviorPersister:
    """Optional durable sink. Disabled instance is a no-op."""

    def __init__(self, *, enabled: bool) -> None:
        self.enabled = enabled
        self._queue: queue.Queue[Any] = queue.Queue(maxsize=_QUEUE_MAX)
        self._thread: Optional[threading.Thread] = None
        self._started = False

    def start(self) -> None:
        if not self.enabled or self._started:
            return
        self._thread = threading.Thread(target=self._run, name="behavior-persist", daemon=True)
        self._thread.start()
        self._started = True
        LOG.info("behavior persist enabled", extra=structured_extra("behavior_persist_ready"))

    def stop(self) -> None:
        if not self._started:
            return
        try:
            self._queue.put_nowait(_SENTINEL)
        except queue.Full:
            pass
        self._started = False

    def fetch(self, device_id: str) -> list[dict[str, Any]]:
        if not self.enabled:
            return []
        rows = fetch_device_behaviors(device_id)
        if rows is None:
            return []
        return rows

    def persist(
        self,
        *,
        device_id: str,
        behavior_kind: str,
        behavior_key: str,
        alert_type: str | None = None,
        meta: dict[str, Any] | None = None,
    ) -> None:
        if not self.enabled:
            return
        job = {
            "device_id": device_id,
            "behavior_kind": behavior_kind,
            "behavior_key": behavior_key,
            "alert_type": alert_type,
            "meta": meta or {},
        }
        try:
            self._queue.put_nowait(job)
        except queue.Full:
            LOG.warning(
                "behavior persist queue full; dropping",
                extra=structured_extra("behavior_persist_dropped", device_id=device_id),
            )

    def clear(self, device_id: str) -> bool:
        if not self.enabled:
            return True
        return delete_device_behaviors(device_id)

    def _run(self) -> None:
        while True:
            job = self._queue.get()
            if job is _SENTINEL:
                return
            try:
                observe_behavior(
                    device_id=str(job.get("device_id") or ""),
                    behavior_kind=str(job.get("behavior_kind") or ""),
                    behavior_key=str(job.get("behavior_key") or ""),
                    alert_type=job.get("alert_type"),
                    meta=job.get("meta") if isinstance(job.get("meta"), dict) else None,
                )
            except Exception as exc:  # noqa: BLE001 — never kill the worker
                LOG.warning("behavior persist worker error: %s", exc)
