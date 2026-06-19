from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.features.policy.repositories.policy_repository import PolicyRepository
from app.features.vpn.schemas.client_config import ClientConfigRead
from app.shared.config import settings
from app.shared.dependencies import get_db

router = APIRouter(prefix="/v1", tags=["Client"])


@router.get("/client-config", response_model=ClientConfigRead)
def get_client_config(db: Session = Depends(get_db)):
    profiles = PolicyRepository(db).list_profiles()
    return ClientConfigRead(
        enroll_bootstrap_token=settings.ENROLL_BOOTSTRAP_TOKEN.strip(),
        stats_interval_sec=float(settings.CLIENT_STATS_INTERVAL_SEC),
        install_policy_ca_default=bool(settings.CLIENT_INSTALL_POLICY_CA_DEFAULT),
        service_name=settings.CLIENT_SERVICE_NAME.strip() or "TrustEdge",
        policy_profile_slugs=[p.slug for p in profiles if p.slug],
    )
