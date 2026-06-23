"""Build effective DNS block/allow lists per device for dnsmasq sync."""

from __future__ import annotations

from typing import List, Set

from sqlalchemy.orm import Session

from app.features.client_behavior.behavior_whitelist import BEHAVIOR_BLOCK_WHITELIST_ROOTS
from app.features.client_behavior.repositories.client_blocked_domain_repository import (
    ClientBlockedDomainRepository,
)
from app.features.policy.pack_common import normalize_domain
from app.features.policy.pack_loader import domains_for_packs
from app.features.policy.repositories.policy_repository import PolicyRepository
from app.features.policy.schedule import active_schedule_pack_slugs
from app.features.policy.schemas.policy import PolicyDeviceDnsEntry, PolicyDnsSyncResponse
from app.features.policy.services.forbidden_country_service import ForbiddenCountryService


class PolicyDnsService:
    def __init__(self, db: Session):
        self.db = db
        self.policy_repo = PolicyRepository(db)
        self.block_repo = ClientBlockedDomainRepository(db)
        self.forbidden_country = ForbiddenCountryService(db)

    def build_dns_sync(self) -> PolicyDnsSyncResponse:
        """Build dnsmasq rules: global_domains apply to all VPN/LAN DNS clients."""
        self.policy_repo.end_expired_quarantines()
        packs = self.policy_repo.list_packs()
        global_slugs = [p.slug for p in packs if p.enabled_globally]
        global_domains = sorted(domains_for_packs(global_slugs))

        entries: List[PolicyDeviceDnsEntry] = []
        for device in self.policy_repo.list_devices_for_dns_sync():
            client_ip = self._device_client_ip(device)
            if not client_ip and not device.mac_address:
                continue
            profile = None
            if device.policy_profile_id:
                profile = self.policy_repo.get_profile_by_id(device.policy_profile_id)
            if profile is None:
                profile = self.policy_repo.get_default_profile()
            if profile is None:
                continue

            quarantine = self.policy_repo.get_active_quarantine(device.id)
            if quarantine:
                # Admin quarantine (score=None): block all DNS. Behavior quarantine keeps allowlist.
                if quarantine.score is None:
                    allowlist_domains: list[str] = []
                else:
                    allowlist_domains = sorted(self._build_allowlist(profile))
                entries.append(
                    PolicyDeviceDnsEntry(
                        device_id=device.id,
                        client_ip=client_ip,
                        mac_address=device.mac_address or "",
                        tag=f"te_device_{device.id}",
                        block_domains=[],
                        allowlist_only=True,
                        allowlist_domains=allowlist_domains,
                    )
                )
                continue

            pack_slugs = list(profile.enabled_pack_slugs or [])
            pack_slugs.extend(global_slugs)
            for slug in active_schedule_pack_slugs(profile.schedule_rules or []):
                if slug not in pack_slugs:
                    pack_slugs.append(slug)

            domains: Set[str] = set(domains_for_packs(pack_slugs))
            for raw in profile.extra_block_domains or []:
                d = normalize_domain(str(raw))
                if d:
                    domains.add(d)

            for block in self.block_repo.list_active_for_device(device.id):
                domains.add(block.domain.lower())

            country_tlds = self.forbidden_country.dnsmasq_tld_patterns_for_device(device.id)

            entries.append(
                PolicyDeviceDnsEntry(
                    device_id=device.id,
                    client_ip=client_ip,
                    mac_address=device.mac_address or "",
                    tag=f"te_device_{device.id}",
                    block_domains=sorted(domains),
                    allowlist_only=False,
                    allowlist_domains=[],
                    block_country_tlds=country_tlds,
                )
            )

        return PolicyDnsSyncResponse(global_domains=global_domains, entries=entries)

    @staticmethod
    def _device_client_ip(device) -> str:
        lease = getattr(device, "ip_lease", None)
        if lease is None or not lease.ip:
            return ""
        return str(lease.ip).strip()

    def _build_allowlist(self, profile) -> Set[str]:
        allow: Set[str] = set()
        for raw in profile.allowlist_domains or []:
            d = normalize_domain(str(raw))
            if d:
                allow.add(d)
        allow.update(BEHAVIOR_BLOCK_WHITELIST_ROOTS)
        return allow
