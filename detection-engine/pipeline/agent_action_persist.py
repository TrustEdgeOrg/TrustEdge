"""Async write-behind for durable ai_agent_action rows."""

from __future__ import annotations

import os
import queue
import threading
from typing import Any, Optional

from api_client import post_agent_actions
from log_config import setup_logging, structured_extra

LOG = setup_logging(service=os.getenv("LOG_SERVICE", "detection-engine"), logger_name=__name__)

_QUEUE_MAX = 10_000
_BATCH_MAX = 50
_SENTINEL = object()


def _env_bool(name: str, default: str = "0") -> bool:
    return os.getenv(name, default).strip().lower() not in ("0", "false", "no", "off")


def persister_from_env() -> "AgentActionPersister":
    return AgentActionPersister(enabled=_env_bool("TRUSTEDGE_POST_AGENT_ACTIONS_TO_BACKEND", "0"))


class AgentActionPersister:
    def __init__(self, *, enabled: bool) -> None:
        self.enabled = enabled
        self._queue: queue.Queue[Any] = queue.Queue(maxsize=_QUEUE_MAX)
        self._thread: Optional[threading.Thread] = None
        self._started = False

    def start(self) -> None:
        if not self.enabled or self._started:
            return
        self._thread = threading.Thread(target=self._run, name="agent-action-persist", daemon=True)
        self._thread.start()
        self._started = True
        LOG.info("agent action persist enabled", extra=structured_extra("agent_action_persist_ready"))

    def stop(self) -> None:
        if not self._started:
            return
        try:
            self._queue.put_nowait(_SENTINEL)
        except queue.Full:
            pass
        self._started = False

    def enqueue(self, event: dict[str, Any]) -> None:
        if not self.enabled:
            return
        event_type = str(event.get("type") or event.get("event_type") or "").strip()
        if event_type != "ai_agent_action":
            return
        try:
            self._queue.put_nowait(dict(event))
        except queue.Full:
            LOG.warning(
                "agent action persist queue full; dropping",
                extra=structured_extra("agent_action_persist_drop"),
            )

    def _run(self) -> None:
        while True:
            job = self._queue.get()
            if job is _SENTINEL:
                return
            batch = [job]
            while len(batch) < _BATCH_MAX:
                try:
                    nxt = self._queue.get_nowait()
                except queue.Empty:
                    break
                if nxt is _SENTINEL:
                    try:
                        post_agent_actions(batch)
                    except Exception as exc:  # noqa: BLE001
                        LOG.warning("agent action persist worker error: %s", exc)
                    return
                batch.append(nxt)
            try:
                post_agent_actions(batch)
            except Exception as exc:  # noqa: BLE001
                LOG.warning("agent action persist worker error: %s", exc)
