from datetime import datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy.orm import Session

from app.features.client_behavior.repositories.behavior_profile_repository import BehaviorProfileRepository
from app.features.client_behavior.repositories.client_blocked_domain_repository import ClientBlockedDomainRepository
from app.features.client_behavior.repositories.device_security_policy_repository import DeviceSecurityPolicyRepository
from app.features.client_behavior.schemas.behavior import (
    BehaviorProfileRead,
    BehaviorReviewRead,
    BlockedClientSummary,
    BlockedClientsListResponse,
    ClientBlockSyncEntry,
    ClientBlockSyncResponse,
    ClientBlockedDomainCreate,
    ClientBlockedDomainRead,
    DeviceSecurityPolicyRead,
    DeviceSecurityPolicyUpdate,
)
from app.features.client_behavior.services.behavior_baseline_service import BehaviorBaselineService
from app.features.client_behavior.services.behavior_review_service import BehaviorReviewService
from fastapi import HTTPException
from app.features.devices.repositories.device_repository import DeviceRepository
from app.features.dns_queries.models.dns_alert import DnsAlert
from app.features.dns_queries.schemas.dns_alert import DnsAlertResponse
from app.features.policy.repositories.policy_repository import PolicyRepository
from app.features.policy.repositories.policy_sync_repository import PolicySyncRepository
from app.shared.config import settings
from app.shared.domain_utils import extract_root_domain


class ClientBehaviorApiService:
    def __init__(self, db: Session):
        self.db = db
        self.device_repo = DeviceRepository(db)
        self.profile_repo = BehaviorProfileRepository(db)
        self.policy_repo = DeviceSecurityPolicyRepository(db)
        self.block_repo = ClientBlockedDomainRepository(db)
        self.policy_repo_main = PolicyRepository(db)
        self.sync_repo = PolicySyncRepository(db)

    def _require_device(self, device_id: int):
        device = self.device_repo.get_by_id(device_id)
        if not device:
            raise HTTPException(status_code=404, detail=f"Device {device_id} not found")
        return device

    def get_behavior_review(self, device_id: int, *, refresh: bool = False) -> BehaviorReviewRead:
        return BehaviorReviewService(self.db).get_device_review(device_id, refresh=refresh)

    @staticmethod
    def _alert_response(alert, review_service: BehaviorReviewService) -> DnsAlertResponse:
        data = DnsAlertResponse.model_validate(alert)
        return data.model_copy(
            update={
                "parent_summary": review_service.explain_alert_for_parent(
                    message=alert.message,
                    domain=alert.domain,
                )
            }
        )

    def get_behavior_profile(self, device_id: int) -> BehaviorProfileRead:
        self._require_device(device_id)
        profile = self.profile_repo.get_or_create(device_id)
        return BehaviorProfileRead(
            device_id=device_id,
            profile_ready=profile.profile_ready,
            last_score=profile.last_score,
            last_scored_at=profile.last_scored_at,
            baseline=self.profile_repo.parse_baseline(profile),
            updated_at=profile.updated_at,
        )

    def get_behavior_events(
        self,
        device_id: int,
        *,
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        self._require_device(device_id)
        query = self.db.query(DnsAlert).filter(
            DnsAlert.device_id == device_id,
            DnsAlert.alert_type == "behavior_anomaly",
        )
        total = query.count()
        offset = (page - 1) * page_size
        items = (
            query.order_by(DnsAlert.timestamp.desc())
            .offset(offset)
            .limit(page_size)
            .all()
        )
        review_service = BehaviorReviewService(self.db)
        return {
            "items": [
                self._alert_response(a, review_service) for a in items
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": max(1, (total + page_size - 1) // page_size),
        }

    def get_security_policy(self, device_id: int) -> DeviceSecurityPolicyRead:
        self._require_device(device_id)
        policy = self.policy_repo.get_or_create(device_id)
        return DeviceSecurityPolicyRead.model_validate(policy)

    def update_security_policy(
        self, device_id: int, data: DeviceSecurityPolicyUpdate
    ) -> DeviceSecurityPolicyRead:
        self._require_device(device_id)
        policy = self.policy_repo.update(
            device_id,
            auto_block_enabled=data.auto_block_enabled,
            auto_block_threshold=data.auto_block_threshold,
            max_blocks_per_day=data.max_blocks_per_day,
        )
        self.db.commit()
        return DeviceSecurityPolicyRead.model_validate(policy)

    def list_client_blocks(self, device_id: int) -> List[ClientBlockedDomainRead]:
        self._require_device(device_id)
        blocks = self.block_repo.list_active_for_device(device_id)
        return [ClientBlockedDomainRead.model_validate(b) for b in blocks]

    def create_client_block(
        self, device_id: int, data: ClientBlockedDomainCreate
    ) -> ClientBlockedDomainRead:
        device = self._require_device(device_id)
        if not device.mac_address:
            raise HTTPException(
                status_code=400,
                detail="Device has no MAC address; per-device blocks require DHCP MAC tagging",
            )
        domain = self._normalize_block_domain(data.domain)
        if not domain:
            raise HTTPException(status_code=400, detail="Invalid domain")

        ttl_hours = data.expires_in_hours or settings.BEHAVIOR_AUTO_BLOCK_TTL_HOURS
        expires_at = datetime.now(timezone.utc) + timedelta(hours=ttl_hours)
        block = self.block_repo.create_block(
            device_id=device_id,
            domain=domain,
            root_domain=extract_root_domain(domain),
            source="admin_manual",
            score=None,
            expires_at=expires_at,
        )
        self.db.commit()
        self.sync_repo.notify_policy_changed(source="admin_block")
        return ClientBlockedDomainRead.model_validate(block)

    def revoke_client_block(self, device_id: int, block_id: int) -> dict:
        self._require_device(device_id)
        revoked = self.block_repo.revoke(block_id, device_id=device_id)
        if not revoked:
            return {"revoked": False, "message": "Block not found"}
        self.db.commit()
        self.sync_repo.notify_policy_changed(source="admin_block_revoke")
        return {"revoked": True, "block_id": block_id}

    @staticmethod
    def _normalize_block_domain(raw: str) -> str:
        domain = raw.strip().lower()
        for prefix in ("https://", "http://"):
            if domain.startswith(prefix):
                domain = domain[len(prefix) :]
        domain = domain.split("/")[0].split(":")[0].rstrip(".")
        if domain.startswith("www."):
            domain = domain[4:]
        return domain

    def recompute_baselines(self) -> int:
        return BehaviorBaselineService(self.db).recompute_all()

    def list_blocked_clients(self) -> BlockedClientsListResponse:
        """Devices with active quarantine or per-device DNS blocks."""
        by_device: dict[int, BlockedClientSummary] = {}

        for quarantine in self.policy_repo_main.list_active_quarantines():
            device = self.device_repo.get_by_id(quarantine.device_id)
            if not device:
                continue
            lease = getattr(device, "ip_lease", None)
            profile = self.profile_repo.get_by_device_id(device.id)
            by_device[device.id] = BlockedClientSummary(
                device_id=device.id,
                client_ip=lease.ip if lease is not None else None,
                hostname=device.hostname,
                mac_address=device.mac_address,
                last_score=profile.last_score if profile else None,
                last_scored_at=profile.last_scored_at if profile else None,
                in_quarantine=True,
                quarantine_expires_at=quarantine.expires_at,
                active_block_count=0,
            )

        for block in self.block_repo.list_active_blocks_for_admin():
            device = block.device
            if not device:
                continue
            lease = getattr(device, "ip_lease", None)
            client_ip = lease.ip if lease is not None else None
            summary = by_device.get(device.id)
            if summary is None:
                profile = self.profile_repo.get_by_device_id(device.id)
                summary = BlockedClientSummary(
                    device_id=device.id,
                    client_ip=client_ip,
                    hostname=device.hostname,
                    mac_address=device.mac_address,
                    last_score=profile.last_score if profile else None,
                    last_scored_at=profile.last_scored_at if profile else None,
                    active_block_count=0,
                    latest_blocked_domain=block.domain,
                    latest_block_at=block.created_at,
                    latest_block_source=block.source,
                )
                by_device[device.id] = summary
            summary.active_block_count += 1
            if block.created_at and (
                summary.latest_block_at is None or block.created_at > summary.latest_block_at
            ):
                summary.latest_blocked_domain = block.domain
                summary.latest_block_at = block.created_at
                summary.latest_block_source = block.source

        items = sorted(
            by_device.values(),
            key=lambda x: (
                x.quarantine_expires_at or x.latest_block_at or datetime.min.replace(tzinfo=timezone.utc)
            ),
            reverse=True,
        )
        return BlockedClientsListResponse(items=items, total=len(items))

    def get_client_blocks_for_sync(self) -> ClientBlockSyncResponse:
        blocks = self.block_repo.list_active_for_sync()
        by_device: dict[int, ClientBlockSyncEntry] = {}
        for block in blocks:
            device = block.device
            if not device or not device.mac_address:
                continue
            tag = f"te_device_{device.id}"
            entry = by_device.get(device.id)
            if not entry:
                entry = ClientBlockSyncEntry(
                    device_id=device.id,
                    mac_address=device.mac_address,
                    tag=tag,
                    domains=[],
                )
                by_device[device.id] = entry
            if block.domain not in entry.domains:
                entry.domains.append(block.domain)
        return ClientBlockSyncResponse(entries=list(by_device.values()))
