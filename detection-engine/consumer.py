#!/usr/bin/env python3
"""TrustEdge Agent event consumer — pipeline evaluate + scored alerts over HTTP."""

from __future__ import annotations

import json
import logging
import os
import signal
import sys
import threading
import time
from typing import Any

from kafka import KafkaConsumer
from kafka.errors import NoBrokersAvailable

from api_client import post_alerts
from baseline_view import bind as bind_baseline
from ai_activity.view import bind as bind_ai_activity
from http_api import serve_forever
from log_config import setup_logging, structured_extra
from pipeline.baseline_store import BaselineStore
from pipeline.behavior_persist import persister_from_env
from pipeline.agent_action_persist import persister_from_env as agent_action_persister_from_env
from pipeline.behavioral import BehavioralEngine
from pipeline.orchestrator import Pipeline
from recent_alerts import append as remember_alert
from rules.alerts import SecurityAlert
from rules.metrics import METRICS

SERVICE = os.getenv("LOG_SERVICE", "detection-engine")
LOG = setup_logging(service=SERVICE, logger_name=__name__)
logging.getLogger("kafka").setLevel(logging.WARNING)

_shutdown = False
_behavior_persister = persister_from_env()
_agent_action_persister = agent_action_persister_from_env()
_baseline = BaselineStore()
_pipeline = Pipeline(
    baseline=_baseline,
    behavioral=BehavioralEngine(_baseline, persister=_behavior_persister),
)
bind_baseline(_pipeline.baseline, _pipeline.behavioral)
bind_ai_activity(_pipeline.ai_activity.sessions)
# Fingerprints already posted this process lifetime, to avoid re-emitting the
# same alert while its source event stays inside the evaluation window.
_seen_fingerprints: dict[str, float] = {}
_SEEN_TTL_SECONDS = 30 * 60
_SEEN_MAX = 10000

# Log eval runtime stats periodically (gate hits / avg latency).
_METRICS_LOG_EVERY = 200
_events_since_metrics_log = 0


def _handle_signal(signum: int, _frame: Any) -> None:
    global _shutdown
    LOG.info("shutdown requested", extra=structured_extra("shutdown", signal=signum))
    _shutdown = True


def _env(name: str, default: str) -> str:
    return os.getenv(name, default).strip()


def _brokers() -> list[str]:
    raw = _env("KAFKA_BROKERS", "redpanda:9092")
    return [b.strip() for b in raw.split(",") if b.strip()]


def _create_consumer() -> KafkaConsumer:
    # Agent-API publishes with key=device_id so partitions keep a device on one
    # consumer (single-writer for that device's in-memory chain).
    topic = _env("KAFKA_TOPIC", "trustedge.agent.events")
    group_id = _env("KAFKA_GROUP_ID", "detection-engine")
    brokers = _brokers()
    LOG.info(
        "connecting to kafka",
        extra=structured_extra(
            "kafka_connect",
            brokers=brokers,
            topic=topic,
            group_id=group_id,
            partition_key="device_id",
        ),
    )
    return KafkaConsumer(
        topic,
        bootstrap_servers=brokers,
        group_id=group_id,
        auto_offset_reset="earliest",
        enable_auto_commit=True,
        consumer_timeout_ms=1000,
        value_deserializer=lambda v: v.decode("utf-8"),
    )


def _prune_seen(now: float) -> None:
    if len(_seen_fingerprints) < _SEEN_MAX:
        expired = [fp for fp, ts in _seen_fingerprints.items() if now - ts > _SEEN_TTL_SECONDS]
    else:
        expired = list(_seen_fingerprints.keys())
    for fp in expired:
        _seen_fingerprints.pop(fp, None)


def _mark_seen(fingerprint: str, now: float) -> bool:
    """Return True if this fingerprint is new (and record it); False if already seen."""
    if fingerprint in _seen_fingerprints:
        return False
    _seen_fingerprints[fingerprint] = now
    return True


def _post_alerts_to_backend() -> bool:
    return _env("TRUSTEDGE_POST_ALERTS_TO_BACKEND", "0").lower() in ("1", "true", "yes")


def _emit_alert(alert: SecurityAlert) -> None:
    now = time.time()
    _prune_seen(now)
    if not _mark_seen(alert.fingerprint(), now):
        return

    api = alert.to_api()
    remember_alert(api)
    LOG.warning(
        "security alert raised",
        extra=structured_extra(
            "alert_raised",
            alert_type=alert.alert_type,
            device_id=alert.device_id,
            severity=alert.severity,
            score=alert.score,
        ),
    )
    # Durable Postgres ingest for all severities (dashboard history).
    if _post_alerts_to_backend():
        post_alerts([api])


def _process_event(raw: str) -> None:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        LOG.warning("invalid event json", extra=structured_extra("agent_event_invalid", raw=raw[:500]))
        return

    LOG.info(
        "trustedge agent event received",
        extra=structured_extra(
            "agent_event",
            event_id=payload.get("event_id"),
            device_id=payload.get("device_id"),
            event_type=payload.get("type"),
            ts=payload.get("ts"),
        ),
    )

    finding = _pipeline.process_event(payload)
    _agent_action_persister.enqueue(payload)

    global _events_since_metrics_log
    _events_since_metrics_log += 1
    if _events_since_metrics_log >= _METRICS_LOG_EVERY:
        _events_since_metrics_log = 0
        snap = METRICS.snapshot()
        LOG.info(
            "detection eval metrics",
            extra=structured_extra(
                "eval_metrics",
                events=snap.events,
                rules_selected=snap.rules_selected,
                rules_gated=snap.rules_gated,
                rules_run=snap.rules_run,
                alerts=snap.alerts,
                avg_eval_ms=round(snap.avg_eval_ms, 4),
                hits_rule=snap.hits_rule,
                hits_behavioral=snap.hits_behavioral,
                hits_threat_intel=snap.hits_threat_intel,
                scored_events=snap.scored_events,
            ),
        )

    if finding is None:
        return
    _emit_alert(finding)


def run() -> int:
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    api_thread = threading.Thread(target=serve_forever, name="alert-api", daemon=True)
    api_thread.start()
    _behavior_persister.start()
    _agent_action_persister.start()

    retries = 0
    consumer: KafkaConsumer | None = None
    while not _shutdown:
        if consumer is None:
            try:
                consumer = _create_consumer()
                retries = 0
                LOG.info("consumer ready", extra=structured_extra("consumer_ready"))
            except NoBrokersAvailable:
                retries += 1
                LOG.warning(
                    "kafka brokers unavailable",
                    extra=structured_extra("kafka_unavailable", retry=retries),
                )
                time.sleep(min(5 * retries, 30))
                continue
            except Exception as exc:
                LOG.exception("consumer init failed: %s", exc)
                return 1

        try:
            for message in consumer:
                if _shutdown:
                    break
                _process_event(message.value)
        except Exception as exc:
            LOG.exception("consumer loop error: %s", exc)
            try:
                consumer.close()
            except Exception:
                pass
            consumer = None

    if consumer is not None:
        consumer.close()
    _behavior_persister.stop()
    LOG.info("consumer stopped", extra=structured_extra("consumer_stopped"))
    return 0


if __name__ == "__main__":
    sys.exit(run())
