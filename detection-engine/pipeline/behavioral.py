"""Behavioral engine: in-memory novelty + baseline suppress."""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime
from typing import Any, Optional, Protocol

from log_config import setup_logging, structured_extra
from rules.alerts import SecurityAlert
from rules.behavior_key import behavior_from_alert
from rules.constants import TYPE_PROCESS_START
from rules.engine import with_alert_context
from rules.process_profile import (
    KIND_PROCESS_COMM,
    novel_process_alert,
    profile_keys_from_event,
)
from rules.cursor_tool_profile import (
    KIND_CURSOR_TOOL,
    cursor_tool_keys_from_event,
    novel_cursor_tool_alert,
)
from rules.state import StateStore

from pipeline.baseline_store import BaselineStore
from pipeline.rule_engine import alert_to_hit
from pipeline.score import score_for
from pipeline.types import ENGINE_BEHAVIORAL, ENGINE_RULE, EngineHit

LOG = setup_logging(service=os.getenv("LOG_SERVICE", "detection-engine"), logger_name=__name__)

_PROFILE_DEBOUNCE_SECONDS = 5 * 60
_PROFILE_DEBOUNCE_MAX = 20000


def _env_bool(name: str, default: str = "1") -> bool:
    return os.getenv(name, default).strip().lower() not in ("0", "false", "no", "off")


def _epoch_from_api(value: Any, fallback: float) -> float:
    if value is None or value == "":
        return fallback
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return fallback
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text).timestamp()
    except ValueError:
        return fallback


class BehaviorSink(Protocol):
    enabled: bool

    def fetch(self, device_id: str) -> list[dict[str, Any]]: ...

    def persist(
        self,
        *,
        device_id: str,
        behavior_kind: str,
        behavior_key: str,
        alert_type: str | None = None,
        meta: dict[str, Any] | None = None,
    ) -> None: ...

    def clear(self, device_id: str) -> bool: ...


class BehavioralEngine:
    def __init__(
        self,
        baseline: BaselineStore | None = None,
        *,
        persister: Optional[BehaviorSink] = None,
    ) -> None:
        self.baseline = baseline or BaselineStore()
        self.persister = persister
        self._profile_observe_seen: dict[str, float] = {}
        self._hydrated: set[str] = set()
        self._hydrate_lock = threading.Lock()
        self.enabled = _env_bool("TRUSTEDGE_BEHAVIOR_BASELINE", "1")

    def clear_debounce(self) -> None:
        self._profile_observe_seen.clear()

    def clear_device(self, device_id: str) -> int:
        """Flush baseline + observe debounce for one device (RAM and durable)."""
        device = (device_id or "").strip()
        cleared = self.baseline.clear_device(device)
        if device:
            prefix = f"{device}|"
            for token in list(self._profile_observe_seen):
                if token.startswith(prefix):
                    self._profile_observe_seen.pop(token, None)
            self._hydrated.discard(device)
            if self.persister is not None and self.persister.enabled:
                self.persister.clear(device)
        return cleared

    def evaluate(
        self,
        event: dict[str, Any],
        rule_hits: list[EngineHit],
        store: StateStore,
    ) -> tuple[list[EngineHit], list[EngineHit]]:
        """Return (behavioral_hits, kept_rule_hits)."""
        if not self.enabled:
            return [], list(rule_hits)

        device_id = str(event.get("device_id") or "").strip()
        if not device_id and rule_hits:
            device_id = str(rule_hits[0].device_id or "").strip()
        if device_id:
            self._ensure_hydrated(device_id)

        behavioral_hits = self._collect_novel_hits(event, store)
        kept_rule = self._filter_suppressed(rule_hits)
        return behavioral_hits, kept_rule

    def _ensure_hydrated(self, device_id: str) -> None:
        if self.persister is None or not self.persister.enabled:
            return
        if device_id in self._hydrated:
            return
        with self._hydrate_lock:
            if device_id in self._hydrated:
                return
            rows = self.persister.fetch(device_id)
            now = time.time()
            seeded = 0
            for row in rows:
                kind = str(row.get("behavior_kind") or "").strip()
                key = str(row.get("behavior_key") or "").strip()
                if not kind or not key:
                    continue
                try:
                    count = int(row.get("count") or 1)
                except (TypeError, ValueError):
                    count = 1
                first = _epoch_from_api(row.get("first_seen_at"), now)
                last = _epoch_from_api(row.get("last_seen_at"), first)
                if self.baseline.seed(
                    device_id,
                    kind,
                    key,
                    count=count,
                    first_seen=first,
                    last_seen=last,
                ):
                    seeded += 1
            self._hydrated.add(device_id)
            LOG.info(
                "behavior baseline hydrated",
                extra=structured_extra(
                    "behavior_hydrated",
                    device_id=device_id,
                    rows=len(rows),
                    seeded=seeded,
                ),
            )

    def _persist(
        self,
        device_id: str,
        kind: str,
        key: str,
        *,
        alert_type: str | None = None,
        meta: dict[str, Any] | None = None,
    ) -> None:
        if self.persister is None or not self.persister.enabled:
            return
        self.persister.persist(
            device_id=device_id,
            behavior_kind=kind,
            behavior_key=key,
            alert_type=alert_type,
            meta=meta,
        )

    def _prune_debounce(self, now: float) -> None:
        if len(self._profile_observe_seen) < _PROFILE_DEBOUNCE_MAX:
            expired = [
                key
                for key, ts in self._profile_observe_seen.items()
                if now - ts > _PROFILE_DEBOUNCE_SECONDS
            ]
        else:
            expired = list(self._profile_observe_seen.keys())
        for key in expired:
            self._profile_observe_seen.pop(key, None)

    def _debounce_allow(self, device_id: str, kind: str, key: str, now: float) -> bool:
        token = f"{device_id}|{kind}|{key}"
        last = self._profile_observe_seen.get(token)
        if last is not None and now - last < _PROFILE_DEBOUNCE_SECONDS:
            return False
        self._profile_observe_seen[token] = now
        return True

    def _collect_novel_hits(
        self,
        event: dict[str, Any],
        store: StateStore,
    ) -> list[EngineHit]:
        return self._collect_novel_process_hits(event, store) + self._collect_novel_cursor_tool_hits(
            event
        )

    def _collect_novel_process_hits(
        self,
        event: dict[str, Any],
        store: StateStore,
    ) -> list[EngineHit]:
        if str(event.get("type") or "").strip() != TYPE_PROCESS_START:
            return []

        device_id = str(event.get("device_id") or "").strip()
        if not device_id:
            return []

        now = time.time()
        self._prune_debounce(now)
        novel: list[EngineHit] = []

        for kind, key, meta in profile_keys_from_event(event, store):
            if not self._debounce_allow(device_id, kind, key, now):
                continue
            decision = self.baseline.observe(device_id, kind, key, now=now)
            self._persist(device_id, kind, key, meta=meta)
            if kind != KIND_PROCESS_COMM:
                continue
            # First observation only (count is already incremented by observe).
            if decision.profile_warm and decision.count == 1:
                alert = novel_process_alert(event, behavior_key=key, meta=meta)
                if alert is None:
                    continue
                chain = store.get_chain(device_id)
                if chain is not None:
                    alert = with_alert_context(chain, alert, store=store, event=event)
                # Attribute onto ProcessState so later network_connection events
                # can correlate (process_network_activity / elevated risk).
                payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
                pid = 0
                try:
                    pid = int(payload.get("pid") or 0)
                except (TypeError, ValueError):
                    pid = 0
                if pid > 0:
                    proc = store.get_process_by_pid(device_id, pid)
                    if proc is not None:
                        proc.note_rule_match(
                            alert.alert_type,
                            score_delta=score_for(alert.severity),
                        )
                novel.append(alert_to_hit(alert, engine=ENGINE_BEHAVIORAL))
                LOG.info(
                    "novel process detected",
                    extra=structured_extra(
                        "novel_process",
                        device_id=device_id,
                        behavior_key=key,
                        count=decision.count,
                    ),
                )
        return novel

    def _collect_novel_cursor_tool_hits(self, event: dict[str, Any]) -> list[EngineHit]:
        device_id = str(event.get("device_id") or "").strip()
        if not device_id:
            return []

        now = time.time()
        self._prune_debounce(now)
        novel: list[EngineHit] = []

        for kind, key, meta in cursor_tool_keys_from_event(event):
            if not self._debounce_allow(device_id, kind, key, now):
                continue
            decision = self.baseline.observe(device_id, kind, key, now=now)
            self._persist(
                device_id,
                kind,
                key,
                alert_type="ai_novel_cursor_tool",
                meta=meta,
            )
            if kind != KIND_CURSOR_TOOL:
                continue
            if decision.count == 1 and self.baseline.cursor_profile_warm(device_id):
                alert = novel_cursor_tool_alert(event, behavior_key=key, meta=meta)
                if alert is None:
                    continue
                novel.append(alert_to_hit(alert, engine=ENGINE_BEHAVIORAL))
                LOG.info(
                    "novel cursor tool detected",
                    extra=structured_extra(
                        "ai_novel_cursor_tool",
                        device_id=device_id,
                        behavior_key=key,
                        count=decision.count,
                    ),
                )
        return novel

    def _filter_suppressed(self, rule_hits: list[EngineHit]) -> list[EngineHit]:
        kept: list[EngineHit] = []
        for hit in rule_hits:
            if hit.engine != ENGINE_RULE:
                kept.append(hit)
                continue
            # Reconstruct a minimal alert for behavior_from_alert.
            alert = SecurityAlert(
                timestamp=hit.timestamp,
                device_id=hit.device_id,
                alert_type=hit.alert_type,
                severity=hit.severity,
                message=hit.message,
                event_id=hit.event_id,
                event_type=hit.event_type,
                detail=hit.detail,
            )
            key_info = behavior_from_alert(alert)
            if key_info is None:
                kept.append(hit)
                continue
            kind, key, meta = key_info
            decision = self.baseline.observe(hit.device_id, kind, key)
            self._persist(
                hit.device_id,
                kind,
                key,
                alert_type=hit.alert_type,
                meta=meta,
            )
            if decision.action == "suppress":
                LOG.info(
                    "alert suppressed by behavior baseline",
                    extra=structured_extra(
                        "alert_suppressed_baseline",
                        alert_type=hit.alert_type,
                        device_id=hit.device_id,
                        behavior_key=key,
                        count=decision.count,
                    ),
                )
                continue
            kept.append(hit)
        return kept
