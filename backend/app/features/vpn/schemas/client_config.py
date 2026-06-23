from typing import List

from pydantic import BaseModel, Field


class ClientConfigRead(BaseModel):
    """Public client bootstrap settings for TrustEdgeClient."""

    enroll_bootstrap_token: str = Field(
        default="",
        description="Bearer token for POST /v1/enroll when enroll auth is enabled",
    )
    enroll_path: str = "/v1/enroll"
    usage_path: str = "/v1/usage"
    attribution_path: str = "/v1/network-attribution"
    policy_ca_path: str = "/policy/block-page-ca"
    stats_interval_sec: float = 5.0
    attribution_poll_sec: float = 30.0
    attribution_report_sec: float = 60.0
    install_policy_ca_default: bool = False
    service_name: str = "TrustEdge"
    policy_profile_slugs: List[str] = Field(default_factory=list)
