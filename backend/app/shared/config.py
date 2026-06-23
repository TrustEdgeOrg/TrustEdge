from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Dict, List

class Settings(BaseSettings):
    DB_URL: str
    CORS_ORIGINS: str = (
        "https://d2qp7beltc09b8.cloudfront.net,https://daemixzdg8jfd.cloudfront.net"
    )

    # WireGuard enroll defaults (single shared pool)
    VPN_POOL_NAME: str = "default"
    VPN_POOL_CIDR: str = "10.0.0.0/24"
    VPN_GATEWAY_IP: str = "10.0.0.1"
    VPN_DNS_IP: str = "10.0.0.1"
    VPN_MTU: int = 1420
    VPN_ALLOWED_IPS: str = "0.0.0.0/0,::/0"

    VPN_ENDPOINT: str = ""
    VPN_SERVER_PUBLIC_KEY: str = ""
    VPN_PERSISTENT_KEEPALIVE: int = 25

    # Host WireGuard agent (runs on EC2 host, reachable from docker bridge)
    WG_AGENT_URL: str = "http://172.17.0.1:9109"
    WG_AGENT_TOKEN: str = ""

    # DNS ingest: when false, only blocked queries are stored in RDS (live feed uses WebSocket)
    PERSIST_ALL_DNS: bool = False

    # Anomaly detection
    NEW_DOMAIN_ALERTS: bool = True
    BANDWIDTH_ALERT_MIB_PER_SEC: float = 50.0
    USAGE_LIVE_MAX_AGE_SEC: int = 45
    REDIS_URL: str = "redis://redis:6379/0"
    USAGE_REDIS_ENABLED: bool = True
    USAGE_HISTORY_MINUTES: int = 60
    USAGE_PERSIST_SAMPLES: bool = False

    # Device identity (issued at VPN enroll, used for /v1/usage and future device APIs)
    DEVICE_TOKEN_SECRET: str = ""
    DEVICE_TOKEN_TTL_DAYS: int = 365
    # Optional: require Bearer token on POST /v1/enroll (TrustEdgeClient --api-token)
    ENROLL_BOOTSTRAP_TOKEN: str = ""

    # Service identity: dns_log_watcher / automation posting DNS queries
    DNS_INGEST_TOKEN: str = ""

    # Admin identity: dashboard and policy APIs
    ADMIN_API_TOKEN: str = ""

    # Client behavior profiles
    BEHAVIOR_BASELINE_LOOKBACK_DAYS: int = 7
    # Minimum number of hourly rollup buckets required to mark profile_ready.
    # If set > 0, this overrides BEHAVIOR_MIN_PROFILE_DAYS.
    BEHAVIOR_MIN_PROFILE_HOURS: int = 0
    BEHAVIOR_MIN_PROFILE_DAYS: int = 3
    BEHAVIOR_MIN_PROFILE_QUERIES: int = 500
    BEHAVIOR_BASELINE_RECOMPUTE_HOURS: int = 1
    BEHAVIOR_SCORE_WINDOW_MINUTES: int = 15
    BEHAVIOR_ALERT_THRESHOLD: int = 70
    BEHAVIOR_AUTO_BLOCK_THRESHOLD: int = 85
    BEHAVIOR_AUTO_BLOCK_DEFAULT: bool = True
    BEHAVIOR_AUTO_BLOCK_TTL_HOURS: int = 24
    BEHAVIOR_AUTO_BLOCK_DOMAINS_PER_EVENT: int = 5
    BEHAVIOR_MAX_BLOCKS_PER_DAY: int = 10
    # Parent-facing behavior text (template | openai | ollama)
    BEHAVIOR_REVIEW_MODE: str = "template"
    BEHAVIOR_REVIEW_CACHE_TTL_SEC: int = 300
    # Alert when a device uses DNS associated with a new country/region (ccTLD heuristic)
    DEVICE_COUNTRY_ALERT_ENABLED: bool = True
    DEVICE_COUNTRY_ALERT_COOLDOWN_HOURS: int = 24

    # Physical location at VPN enroll (public IP GeoIP — not DNS domain country)
    DEVICE_LOGIN_GEO_ENABLED: bool = True
    DEVICE_LOGIN_GEO_ALERT_ENABLED: bool = True
    DEVICE_LOGIN_GEO_ALERT_COOLDOWN_HOURS: int = 24
    GEOIP_ENABLED: bool = True
    GEOIP_PROVIDER: str = "ip_api"
    GEOIP_TIMEOUT_SEC: float = 3.0

    # When VPN login country matches user_country, block destination ccTLDs (dnsmasq + alerts).
    # JSON list, e.g. [{"user_country":"IL","blocked_countries":["IR","SY","KP"]}]
    FORBIDDEN_COUNTRY_ENABLED: bool = True
    FORBIDDEN_COUNTRY_RULES: str = '[{"user_country":"IL","blocked_countries":["IR"]}]'

    # Reject VPN enroll when login GeoIP is in these countries (comma or JSON list), e.g. IR
    VPN_LOGIN_GEO_BLOCK_ENABLED: bool = True
    BLOCKED_VPN_LOGIN_COUNTRIES: str = "IR"

    # Policy packs: fetch upstream hosts lists into on-disk snapshots (all built-in packs).
    # Writable dir in Docker production (see docker-compose policy-pack-snapshots volume).
    POLICY_PACK_SNAPSHOT_DIR: str = ""
    POLICY_PACK_FETCH_ENABLED: bool = True
    POLICY_PACK_FETCH_TIMEOUT_SECONDS: float = 30.0
    POLICY_PACK_SNAPSHOT_MAX_AGE_SECONDS: int = 86400
    # Comma-separated slug=url overrides, e.g. social=https://example.com/hosts
    POLICY_PACK_REMOTE_URLS: str = ""
    POLICY_PACK_REFRESH_ON_STARTUP: bool = True

    # Dashboard network / AI review (template | openai | ollama)
    NETWORK_REVIEW_MODE: str = "template"
    NETWORK_REVIEW_CACHE_TTL_SEC: int = 90
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o-mini"
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    OLLAMA_BASE_URL: str = "http://ollama:11434"
    OLLAMA_MODEL: str = "llama3.2:3b"
    LLM_TIMEOUT_SEC: float = 180.0

    @property
    def policy_pack_remote_urls(self) -> Dict[str, str]:
        out: Dict[str, str] = {}
        raw = self.POLICY_PACK_REMOTE_URLS.strip()
        if not raw:
            return out
        for part in raw.split(","):
            part = part.strip()
            if not part or "=" not in part:
                continue
            slug, url = part.split("=", 1)
            slug = slug.strip().lower()
            url = url.strip()
            if slug and url:
                out[slug] = url
        return out

    @property
    def device_token_secret(self) -> str:
        return self.DEVICE_TOKEN_SECRET.strip()

    @property
    def DEVICE_TOKEN_TTL_SECONDS(self) -> int:
        days = max(1, int(self.DEVICE_TOKEN_TTL_DAYS))
        return days * 24 * 60 * 60
    @property
    def cors_origins_list(self) -> List[str]:
        """Parse CORS_ORIGINS string into a list."""
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]
    
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()

