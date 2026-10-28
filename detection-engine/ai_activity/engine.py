"""AiActivityEngine — event-driven facade over session reconstruction."""

from __future__ import annotations

from typing import Any

import json

from ai_activity import correlation_engine
from ai_activity import filesystem_tracker
from ai_activity import governance
from ai_activity import network_tracker
from ai_activity import process_tracker
from ai_activity import risk_engine
from ai_activity import terminal_tracker
from ai_activity import tool_tracker
from ai_activity.catalog import ENGINE_AI_ACTIVITY
from ai_activity.detector import classify_process
from ai_activity.session_manager import SessionManager
from rules.chain import payload_int, payload_str, ts_iso, parse_ts
from rules.constants import (
    TYPE_FILE_OPEN,
    TYPE_FILE_WRITE,
    TYPE_NETWORK_CONNECTION,
    TYPE_PROCESS_EXIT,
    TYPE_PROCESS_START,
)
from rules.state import StateStore

# EngineHit imported lazily in return type consumers; annotate as Any for runtime.


class AiActivityEngine:
    """Consumes every pipeline event; reconstructs AI sessions; emits EngineHits."""

    def __init__(
        self,
        sessions: SessionManager | None = None,
        gov_store: governance.GovernanceStore | None = None,
    ) -> None:
        self.sessions = sessions or SessionManager()
        self.gov_store = gov_store or governance.GovernanceStore()

    def on_event(self, event: dict[str, Any], store: StateStore) -> list:
        device_id = str(event.get("device_id") or "").strip()
        if not device_id:
            return []

        event_type = str(event.get("type") or event.get("event_type") or "").strip()
        event_id = str(event.get("event_id") or "").strip() or None
        timestamp = ts_iso(parse_ts(event.get("ts")))
        payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}

        with self.sessions.lock():
            if event_type == governance.TYPE_AI_AGENT_ACTION:
                governance.handle_ai_agent_action(event, self.gov_store)
                return self._on_agent_action_runtime(
                    event, device_id, event_id, timestamp, payload
                )
            if event_type == TYPE_PROCESS_START:
                return self._on_process_start(
                    event, store, device_id, event_id, event_type, timestamp, payload
                )
            if event_type == TYPE_PROCESS_EXIT:
                return self._on_process_exit(
                    event, store, device_id, event_id, event_type, timestamp, payload
                )
            if event_type == TYPE_NETWORK_CONNECTION:
                return self._on_network(
                    event, store, device_id, event_id, event_type, timestamp, payload
                )
            if event_type in (TYPE_FILE_WRITE, TYPE_FILE_OPEN):
                return self._on_file_event(
                    event,
                    store,
                    device_id,
                    event_id,
                    event_type,
                    timestamp,
                    payload,
                    default_operation="write" if event_type == TYPE_FILE_WRITE else "open",
                )
            return []

    # ------------------------------------------------------------------
    # Handlers
    # ------------------------------------------------------------------

    def _on_process_start(
        self,
        event: dict[str, Any],
        store: StateStore,
        device_id: str,
        event_id: str | None,
        event_type: str,
        timestamp: str,
        payload: dict[str, Any],
    ) -> list[EngineHit]:
        proc = store.get_process_by_pid(device_id, payload_int(payload.get("pid")))
        # Prefer StateStore identity after mutation
        process_id = proc.process_id if proc else None
        pid = proc.pid if proc else payload_int(payload.get("pid"))
        ppid = proc.ppid if proc else payload_int(payload.get("ppid"))
        parent_process_id = proc.parent_process_id if proc else None
        name = (proc.process_name if proc else "") or payload_str(payload.get("comm"))
        cmdline = (proc.command_line if proc else "") or payload_str(
            payload.get("cmdline") or payload.get("command_line")
        )

        parent_session = self.sessions.resolve_by_ancestry(
            device_id,
            process_id=process_id,
            pid=pid,
            ppid=ppid,
            parent_process_id=parent_process_id,
            walk_parent_pids=_ancestor_pids(store, device_id, ppid),
        )
        parent_is_ai = parent_session is not None
        classification = classify_process(
            name=name,
            executable=payload_str(payload.get("executable") or payload.get("image")),
            cmdline=cmdline,
            parent_is_ai=parent_is_ai,
        )

        session = parent_session
        if classification.is_ai_root and process_id:
            app = classification.app_name or "ai_app"
            session = self.sessions.create_session(
                device_id=device_id,
                app_name=app,
                root_process_id=process_id,
                root_pid=pid,
                start_time=timestamp,
            )
        elif session is None:
            # Not an AI root and not under an AI tree — ignore
            return []

        if not process_id:
            return []

        hash_sha, sig = process_tracker.payload_hash_sig(payload)
        if process_id == session.root_process_id:
            parent_id: str | None = None
        elif parent_process_id and parent_process_id in session.processes:
            parent_id = parent_process_id
        elif session.root_process_id in session.processes:
            parent_id = session.root_process_id
        else:
            parent_id = parent_process_id

        node = process_tracker.upsert_process(
            session,
            process_id=process_id,
            pid=pid,
            ppid=ppid,
            name=name,
            cmdline=cmdline,
            role=classification.role,
            tool_class=classification.tool_class,
            parent_process_id=parent_id,
            start_time=timestamp,
            classification=classification,
            hash_sha256=hash_sha,
            signature_status=sig,
        )
        self.sessions.attach_process(session, process_id=process_id, pid=pid)
        process_tracker.timeline_process_start(session, node)
        terminal_tracker.note_terminal_role(session, node)

        if classification.tool_class:
            tool_tracker.record_tool(session, node, timestamp)

        from ai_activity.dns_enrichment import remember_hosts_from_text

        remember_hosts_from_text(cmdline)

        filesystem_tracker.record_inferred_from_cmdline(
            session,
            process_id=process_id,
            cmdline=cmdline,
            timestamp=timestamp,
            process_name=name,
        )

        return self._correlate_and_hits(
            session,
            trigger="process_start" if not classification.tool_class else "tool",
            timestamp=timestamp,
            event_id=event_id,
            event_type=event_type,
            device_id=device_id,
        )

    def _on_process_exit(
        self,
        event: dict[str, Any],
        store: StateStore,
        device_id: str,
        event_id: str | None,
        event_type: str,
        timestamp: str,
        payload: dict[str, Any],
    ) -> list[EngineHit]:
        pid = payload_int(payload.get("pid"))
        process_id = ""
        for key in ("process_id", "process_guid", "guid"):
            process_id = payload_str(payload.get(key))
            if process_id:
                break
        # Prefer live/terminated ProcessState still retained on the device
        if not process_id:
            device = store.get(device_id)
            for candidate in device.processes.values():
                if candidate.pid == pid:
                    process_id = candidate.process_id
                    break

        session = None
        if process_id:
            session = self.sessions.session_for_process(device_id, process_id)
        if session is None and pid:
            session = self.sessions.session_for_pid(device_id, pid)
        if session is None:
            return []

        if not process_id:
            process_id = session.pid_index.get(pid) or ""
        if not process_id:
            return []

        node = process_tracker.terminate_process(session, process_id, timestamp)
        if node:
            process_tracker.timeline_process_exit(session, node)

        if process_id == session.root_process_id:
            self.sessions.close_session(session, timestamp)

        return []

    def _on_network(
        self,
        event: dict[str, Any],
        store: StateStore,
        device_id: str,
        event_id: str | None,
        event_type: str,
        timestamp: str,
        payload: dict[str, Any],
    ) -> list[EngineHit]:
        pid = payload_int(payload.get("pid"))
        proc = store.get_process_by_pid(device_id, pid)
        process_id = proc.process_id if proc else payload_str(payload.get("process_id"))
        session = self.sessions.resolve_by_ancestry(
            device_id,
            process_id=process_id or None,
            pid=pid,
            ppid=proc.ppid if proc else payload_int(payload.get("ppid")),
            parent_process_id=proc.parent_process_id if proc else None,
            walk_parent_pids=_ancestor_pids(store, device_id, proc.ppid if proc else 0),
        )
        if session is None:
            return []
        if not process_id:
            process_id = session.pid_index.get(pid) or session.root_process_id
        if process_id and process_id not in session.processes:
            # Stub node so graph can show network source
            process_tracker.upsert_process(
                session,
                process_id=process_id,
                pid=pid or 0,
                ppid=0,
                name=proc.process_name if proc else "",
                cmdline=proc.command_line if proc else "",
                role="unknown",
                tool_class=None,
                parent_process_id=session.root_process_id,
                start_time=timestamp,
            )
            self.sessions.attach_process(session, process_id=process_id, pid=pid)

        network_tracker.record_network(
            session, process_id=process_id, payload=payload, timestamp=timestamp
        )
        hits = self._correlate_and_hits(
            session,
            trigger="network",
            timestamp=timestamp,
            event_id=event_id,
            event_type=event_type,
            device_id=device_id,
        )
        dest = (
            payload_str(payload.get("domain"))
            or payload_str(payload.get("remote_hostname"))
            or payload_str(payload.get("remote_ip"))
            or payload_str(payload.get("remote_addr"))
        )
        proc_name = (
            (proc.process_name if proc else "")
            or payload_str(payload.get("comm"))
            or ""
        )
        alert = governance.correlate_ungoverned_egress(
            device_id=device_id,
            agent_type=session.app_name or "unknown",
            destination=dest,
            process_name=proc_name,
            evidence=[f"session:{session.app_name}", f"ancestry_pid:{pid}"],
            confidence="HIGH",
            timestamp=timestamp,
            event_id=event_id,
            store=self.gov_store,
            governed=False,
        )
        if alert is not None:
            hits = list(hits) + [_alert_to_hit(alert)]
        return hits

    def _on_agent_action_runtime(
        self,
        event: dict[str, Any],
        device_id: str,
        event_id: str | None,
        timestamp: str,
        payload: dict[str, Any],
    ) -> list:
        channel = payload_str(payload.get("channel")).upper()
        if channel not in ("NETWORK", "PROCESS"):
            return []
        governed = payload.get("governed") is True
        dest = payload_str(payload.get("destination"))
        agent_type = payload_str(payload.get("agent_type")) or "unknown"
        process_name = payload_str(payload.get("process"))
        evidence = payload.get("evidence") if isinstance(payload.get("evidence"), list) else []
        evidence_s = [str(x) for x in evidence]
        confidence = payload_str(payload.get("confidence")) or "MEDIUM"
        alert = governance.correlate_ungoverned_egress(
            device_id=device_id,
            agent_type=agent_type,
            destination=dest,
            process_name=process_name,
            evidence=evidence_s,
            confidence=confidence,
            timestamp=timestamp,
            event_id=event_id,
            store=self.gov_store,
            governed=governed,
        )
        if alert is None:
            return []
        return [_alert_to_hit(alert)]

    def _on_file_event(
        self,
        event: dict[str, Any],
        store: StateStore,
        device_id: str,
        event_id: str | None,
        event_type: str,
        timestamp: str,
        payload: dict[str, Any],
        *,
        default_operation: str,
    ) -> list[EngineHit]:
        pid = payload_int(payload.get("pid"))
        proc = store.get_process_by_pid(device_id, pid)
        process_id = proc.process_id if proc else payload_str(payload.get("process_id"))
        ppid = proc.ppid if proc else payload_int(payload.get("ppid"))
        parent_process_id = proc.parent_process_id if proc else None
        name = (proc.process_name if proc else "") or payload_str(payload.get("comm"))
        executable = payload_str(payload.get("executable") or payload.get("image"))
        cmdline = (proc.command_line if proc else "") or payload_str(
            payload.get("cmdline") or payload.get("command_line")
        )

        session = self.sessions.resolve_by_ancestry(
            device_id,
            process_id=process_id or None,
            pid=pid,
            ppid=ppid,
            parent_process_id=parent_process_id,
            walk_parent_pids=_ancestor_pids(store, device_id, ppid),
        )
        if session is None:
            # Bootstrap a session when Cursor/AI itself opens a secret file
            # (e.g. agent already running before process_start was observed).
            classification = classify_process(
                name=name,
                executable=executable,
                cmdline=cmdline,
                parent_is_ai=False,
            )
            app = classification.app_name
            if not app and not classification.is_ai_root:
                return []
            if not process_id:
                # Synthesize a stable id from pid so we can still sessionize.
                process_id = f"{device_id}:pid:{pid}" if pid else ""
            if not process_id:
                return []
            app = app or classification.app_name or "ai_app"
            session = self.sessions.create_session(
                device_id=device_id,
                app_name=app,
                root_process_id=process_id,
                root_pid=pid,
                start_time=timestamp,
            )
            process_tracker.upsert_process(
                session,
                process_id=process_id,
                pid=pid or 0,
                ppid=ppid or 0,
                name=name,
                cmdline=cmdline,
                role=classification.role,
                tool_class=classification.tool_class,
                parent_process_id=None,
                start_time=timestamp,
                classification=classification,
            )
            self.sessions.attach_process(session, process_id=process_id, pid=pid)

        if not process_id:
            process_id = session.pid_index.get(pid) or session.root_process_id
        if process_id and process_id not in session.processes:
            process_tracker.upsert_process(
                session,
                process_id=process_id,
                pid=pid or 0,
                ppid=ppid or 0,
                name=name,
                cmdline=cmdline,
                role="unknown",
                tool_class=None,
                parent_process_id=session.root_process_id,
                start_time=timestamp,
            )
            self.sessions.attach_process(session, process_id=process_id, pid=pid)

        activity = filesystem_tracker.record_file_access(
            session,
            process_id=process_id,
            payload=payload,
            timestamp=timestamp,
            default_operation=default_operation,
        )
        if activity is None or not activity.is_secret:
            # Still record non-secret writes for timeline, but only alert on secrets.
            if activity is None:
                return []
            if default_operation == "write":
                return self._correlate_and_hits(
                    session,
                    trigger="file",
                    timestamp=timestamp,
                    event_id=event_id,
                    event_type=event_type,
                    device_id=device_id,
                )
            return []
        return self._correlate_and_hits(
            session,
            trigger="file",
            timestamp=timestamp,
            event_id=event_id,
            event_type=event_type,
            device_id=device_id,
        )

    def _correlate_and_hits(
        self,
        session,
        *,
        trigger: str,
        timestamp: str,
        event_id: str | None,
        event_type: str,
        device_id: str,
    ) -> list[EngineHit]:
        findings = correlation_engine.evaluate_session(
            session, trigger=trigger, timestamp=timestamp
        )
        risk_engine.update_session_risk(session)
        return risk_engine.findings_to_engine_hits(
            session,
            findings,
            event_id=event_id,
            event_type=event_type,
            device_id=device_id,
        )


def _alert_to_hit(alert) -> Any:
    from pipeline.types import EngineHit

    detail = alert.detail if isinstance(alert.detail, str) else json.dumps(
        alert.detail or {}, separators=(",", ":")
    )
    return EngineHit(
        engine=ENGINE_AI_ACTIVITY,
        alert_type=alert.alert_type,
        severity=alert.severity,
        score=alert.score,
        message=alert.message,
        device_id=alert.device_id,
        timestamp=alert.timestamp,
        event_id=alert.event_id or None,
        event_type=alert.event_type,
        detail=detail,
    )


def _ancestor_pids(store: StateStore, device_id: str, start_ppid: int, *, limit: int = 8) -> list[int]:
    out: list[int] = []
    pid = start_ppid
    seen: set[int] = set()
    for _ in range(limit):
        if pid <= 0 or pid in seen:
            break
        seen.add(pid)
        out.append(pid)
        parent = store.get_process_by_pid(device_id, pid)
        if parent is None:
            break
        pid = parent.ppid
    return out
