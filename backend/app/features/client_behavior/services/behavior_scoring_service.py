from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from app.features.client_behavior.behavior_whitelist import is_whitelisted_root
from app.features.client_behavior.services.behavior_review_templates import explain_alert_message
from app.features.client_behavior.repositories.behavior_profile_repository import BehaviorProfileRepository
from app.features.client_behavior.repositories.behavior_rollup_repository import BehaviorRollupRepository
from app.features.client_behavior.repositories.client_blocked_domain_repository import ClientBlockedDomainRepository
from app.features.client_behavior.repositories.device_security_policy_repository import DeviceSecurityPolicyRepository
from app.features.client_behavior.services.behavior_baseline_service import BehaviorBaselineService
from app.features.devices.repositories.device_repository import DeviceRepository
from app.features.policy.repositories.policy_repository import PolicyRepository
from app.features.policy.sensitivity import alert_threshold_for_sensitivity
from app.features.dns_queries.dns_anomaly import get_suspicious_domain_reasons
from app.features.dns_queries.models.dns_alert import DnsAlert
from app.features.dns_queries.repositories.dns_alert_repository import DnsAlertRepository
from app.features.dns_queries.schemas.dns_query import DnsQueryCreate
from app.shared.config import settings
from app.shared.domain_utils import extract_root_domain, is_noise_domain
from app.shared.logging_context import structured_extra
from app.shared.utils.logging import get_logger

logger = get_logger(__name__)


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


class BehaviorScoringService:
    """Score recent activity vs baseline; alert and optionally auto-block per device."""

    def __init__(self, db: Session):
        self.db = db
        self.rollup_repo = BehaviorRollupRepository(db)
        self.profile_repo = BehaviorProfileRepository(db)
        self.security_policy_repo = DeviceSecurityPolicyRepository(db)
        self.block_repo = ClientBlockedDomainRepository(db)
        self.alert_repo = DnsAlertRepository(db)
        self.device_repo = DeviceRepository(db)
        self.baseline_service = BehaviorBaselineService(db)
        self.policy_repo = PolicyRepository(db)

    def process_queries(self, queries: List[DnsQueryCreate]) -> int:
        if not queries:
            return 0

        device_domains: dict[int, List[Tuple[str, str, str]]] = {}
        for q in queries:
            if is_noise_domain(q.domain):
                continue
            device = self.device_repo.get_by_client_ip(q.client_ip)
            if not device:
                continue
            root = extract_root_domain(q.domain)
            device_domains.setdefault(device.id, []).append((q.client_ip, q.domain, root))

        alerts = 0
        for device_id, entries in device_domains.items():
            alerts += self._score_device(device_id, entries)
        return alerts

    def _score_device(self, device_id: int, entries: List[Tuple[str, str, str]]) -> int:
        profile = self.profile_repo.get_by_device_id(device_id)
        if self._should_recompute_baseline(profile):
            self.baseline_service.recompute_device(device_id)
            profile = self.profile_repo.get_by_device_id(device_id)

        if not profile or not profile.profile_ready:
            return 0

        baseline = self.profile_repo.parse_baseline(profile)
        window_min = settings.BEHAVIOR_SCORE_WINDOW_MINUTES
        since = datetime.now(timezone.utc) - timedelta(minutes=window_min)
        query_count, _, new_roots = self.rollup_repo.sum_recent_window(device_id, since)

        score, reasons, top_domain = self._compute_score(
            baseline, query_count, new_roots, entries
        )
        self.profile_repo.update_score(device_id, score)

        policy_profile = self._get_device_policy_profile(device_id)
        alert_threshold = alert_threshold_for_sensitivity(
            policy_profile.behavior_sensitivity if policy_profile else "medium"
        )
        if score < alert_threshold:
            return 0

        cooldown_since = datetime.now(timezone.utc) - timedelta(
            minutes=settings.BEHAVIOR_SCORE_WINDOW_MINUTES
        )
        recent_alert = (
            self.db.query(DnsAlert)
            .filter(
                DnsAlert.device_id == device_id,
                DnsAlert.alert_type == "behavior_anomaly",
                DnsAlert.timestamp >= cooldown_since,
            )
            .first()
        )

        events = 0
        if not recent_alert:
            client_ip = entries[0][0]
            technical = f"Behavior score {score}: " + "; ".join(reasons)
            if top_domain:
                technical += f" (top domain: {top_domain})"
            mode = settings.BEHAVIOR_REVIEW_MODE.strip().lower()
            if mode == "template":
                message = explain_alert_message(technical, domain=top_domain)
            else:
                message = technical

            self.alert_repo.create(
                timestamp=datetime.now(timezone.utc),
                client_ip=client_ip,
                alert_type="behavior_anomaly",
                severity="high" if score >= 85 else "medium",
                domain=top_domain,
                root_domain=extract_root_domain(top_domain) if top_domain else None,
                message=message,
                device_id=device_id,
            )
            from app.features.client_behavior.services.behavior_review_cache import delete_cached_review

            delete_cached_review(device_id)
            events = 1

        blocks_added = self._apply_auto_blocks_if_needed(device_id, score, entries)
        if self._maybe_start_quarantine(device_id, score, policy_profile):
            if events == 0:
                events = 1
        elif blocks_added > 0 and events == 0:
            events = 1

        return events

    def _get_device_policy_profile(self, device_id: int):
        device = self.device_repo.get_by_id(device_id)
        if not device:
            return self.policy_repo.get_default_profile()
        if device.policy_profile_id:
            profile = self.policy_repo.get_profile_by_id(device.policy_profile_id)
            if profile:
                return profile
        return self.policy_repo.get_default_profile()

    def _maybe_start_quarantine(self, device_id: int, score: int, policy_profile) -> bool:
        if policy_profile is None or not policy_profile.quarantine_on_abnormal:
            return False
        sec = self.security_policy_repo.get_or_create(device_id)
        block_threshold = sec.auto_block_threshold or settings.BEHAVIOR_AUTO_BLOCK_THRESHOLD
        if not sec.auto_block_enabled or score < block_threshold:
            return False
        if self.policy_repo.get_active_quarantine(device_id):
            return False
        hours = max(1, int(policy_profile.quarantine_hours or 4))
        self.policy_repo.start_quarantine(device_id, score, hours)
        logger.warning(
            "Device quarantine started",
            extra=structured_extra(
                "device_quarantine_started",
                device_id=device_id,
                score=score,
                hours=hours,
            ),
        )
        return True

    def _should_recompute_baseline(self, profile) -> bool:
        """True when baseline is missing or older than BEHAVIOR_BASELINE_RECOMPUTE_HOURS."""
        if profile is None:
            return True

        baseline = self.profile_repo.parse_baseline(profile) if profile.baseline_json else {}
        computed_raw = baseline.get("computed_at")
        if isinstance(computed_raw, str) and computed_raw.strip():
            try:
                computed = datetime.fromisoformat(computed_raw.replace("Z", "+00:00"))
                if computed.tzinfo is None:
                    computed = computed.replace(tzinfo=timezone.utc)
                age = datetime.now(timezone.utc) - computed
                return age > timedelta(hours=settings.BEHAVIOR_BASELINE_RECOMPUTE_HOURS)
            except ValueError:
                pass

        if profile.updated_at is None:
            return True
        age = datetime.now(timezone.utc) - _as_utc(profile.updated_at)
        return age > timedelta(hours=settings.BEHAVIOR_BASELINE_RECOMPUTE_HOURS)

    def _compute_score(
        self,
        baseline: dict,
        query_count: int,
        new_roots: int,
        entries: List[Tuple[str, str, str]],
    ) -> Tuple[int, List[str], Optional[str]]:
        reasons: List[str] = []
        points = 0

        median = float(baseline.get("median_queries_per_hour", 1) or 1)
        mad = float(baseline.get("mad_queries_per_hour", 1) or 1)
        window_min = max(1, settings.BEHAVIOR_SCORE_WINDOW_MINUTES)
        expected = median * (window_min / 60.0)
        threshold = expected + 5 * mad
        if query_count > max(threshold, expected * 5):
            reasons.append(f"query volume {query_count} vs expected ~{expected:.0f}")
            points += 35

        p95_new = float(baseline.get("p95_new_roots_per_hour", 3) or 3)
        scaled_p95 = p95_new * (window_min / 60.0)
        if new_roots >= max(10, scaled_p95 * 3):
            reasons.append(f"new root burst {new_roots} in {window_min}m")
            points += 35

        now = datetime.now(timezone.utc)
        hour_hist = baseline.get("hour_histogram") or {}
        hist_count = int(hour_hist.get(now.hour, hour_hist.get(str(now.hour), 0)))
        if hist_count == 0 and query_count >= 20:
            reasons.append(f"unusual activity at hour {now.hour} UTC")
            points += 15

        top_domain: Optional[str] = None
        for _ip, domain, root in entries:
            if get_suspicious_domain_reasons(domain):
                reasons.append(f"suspicious domain {domain}")
                points += 25
                top_domain = domain
                break
            if not is_whitelisted_root(root) and top_domain is None:
                top_domain = domain

        if top_domain is None and entries:
            top_domain = entries[-1][1]

        return min(100, points), reasons, top_domain

    def _domains_for_auto_block(self, entries: List[Tuple[str, str, str]]) -> List[str]:
        """Prioritize suspicious domains, then other non-whitelisted roots in the batch."""
        suspicious: List[str] = []
        others: List[str] = []
        seen_roots: set[str] = set()
        max_domains = max(1, settings.BEHAVIOR_AUTO_BLOCK_DOMAINS_PER_EVENT)

        for _ip, domain, root in entries:
            root_key = root.lower()
            if root_key in seen_roots:
                continue
            seen_roots.add(root_key)
            if is_whitelisted_root(root):
                continue
            if get_suspicious_domain_reasons(domain):
                suspicious.append(domain.lower())
            else:
                others.append(domain.lower())

        combined = suspicious + others
        return combined[:max_domains]

    def _apply_auto_blocks_if_needed(
        self,
        device_id: int,
        score: int,
        entries: List[Tuple[str, str, str]],
    ) -> int:
        policy = self.security_policy_repo.get_or_create(device_id)
        block_threshold = policy.auto_block_threshold or settings.BEHAVIOR_AUTO_BLOCK_THRESHOLD
        if not policy.auto_block_enabled or score < block_threshold:
            return 0

        remaining = policy.max_blocks_per_day - self.block_repo.count_blocks_today(device_id)
        if remaining <= 0:
            logger.warning(
                "Auto-block skipped: daily limit",
                extra=structured_extra("auto_block_daily_limit", device_id=device_id),
            )
            return 0

        domains = self._domains_for_auto_block(entries)[:remaining]
        created = 0
        for domain in domains:
            if self._create_auto_block(device_id, domain, score):
                created += 1
        return created

    def _create_auto_block(self, device_id: int, domain: str, score: int) -> bool:
        root = extract_root_domain(domain)
        if is_whitelisted_root(root):
            return False

        ttl_hours = settings.BEHAVIOR_AUTO_BLOCK_TTL_HOURS
        expires = datetime.now(timezone.utc) + timedelta(hours=ttl_hours)
        self.block_repo.create_block(
            device_id=device_id,
            domain=domain.lower(),
            root_domain=root,
            source="behavior_auto",
            score=score,
            expires_at=expires,
        )
        logger.warning(
            "Behavior auto-block created",
            extra=structured_extra(
                "behavior_auto_block",
                device_id=device_id,
                domain=domain,
                score=score,
            ),
        )
        return True
