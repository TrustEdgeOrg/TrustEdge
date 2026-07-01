from contextlib import asynccontextmanager
import threading

from fastapi import FastAPI, Depends, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import RedirectResponse
import os

from app.shared.request_logging_middleware import RequestLoggingMiddleware
from app.shared.utils.logging import setup_logging
from app.shared.dependencies import get_db
from app.features.dns_queries.routes.dns_query_route import router as dns_query_router
from app.features.policy.routes.policy_route import router as policy_router
from app.features.devices.routes.device_route import router as device_router
from app.features.vpn.routes.client_config_route import router as client_config_router
from app.features.vpn.routes.enroll_route import router as vpn_router
from app.features.vpn.routes.usage_route import router as usage_router
from app.features.vpn.routes.topology_route import router as vpn_topology_router
from app.features.dashboard.routes.dashboard_route import router as dashboard_router
from app.features.network_attribution.routes.network_attribution_route import (
    router as network_attribution_router,
)
from app.features.network_flows.routes.network_flow_route import router as network_flow_router
from app.features.twin.routes.twin_route import router as twin_router
from app.features.policy.startup import warmup_policy_packs
from app.shared.redis_client import close_redis
from app.shared.config import settings

# Initialize logging early
setup_logging()


def _build_allowed_origins() -> list[str]:
    """Merge env, settings.CORS_ORIGINS, and known production frontends."""
    origins: set[str] = {
        "http://trustedge-frontend.s3-website-us-east-1.amazonaws.com",
    }
    env = os.getenv("ALLOWED_ORIGINS", "").strip()
    if env:
        origins.update(o.strip() for o in env.split(",") if o.strip())
    origins.update(settings.cors_origins_list)
    return sorted(origins)


ALLOWED_ORIGINS = _build_allowed_origins()


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.POLICY_PACK_FETCH_ENABLED and settings.POLICY_PACK_REFRESH_ON_STARTUP:
        threading.Thread(target=warmup_policy_packs, name="policy-pack-warmup", daemon=True).start()
    yield
    close_redis()

# Middleware to ensure redirects use HTTPS when behind CloudFront
class HTTPSRedirectMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        # If it's a redirect response, ensure it uses HTTPS
        if isinstance(response, RedirectResponse):
            url = str(response.headers.get("location", ""))
            # Check X-Forwarded-Proto header from CloudFront
            forwarded_proto = request.headers.get("X-Forwarded-Proto", "http")
            # If CloudFront sent HTTPS, ensure redirect uses HTTPS
            if forwarded_proto == "https" and url.startswith("http://"):
                url = url.replace("http://", "https://", 1)
                response.headers["location"] = url
            # Also check if it's a CloudFront domain and force HTTPS
            elif "cloudfront.net" in url and url.startswith("http://"):
                url = url.replace("http://", "https://", 1)
                response.headers["location"] = url
        return response


class StableCORSHeadersMiddleware(BaseHTTPMiddleware):
    """
    Add stable CORS headers even behind proxies/CDNs.
    This protects against cases where Origin is not forwarded by CloudFront.
    """
    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS":
            response = Response(status_code=204)
        else:
            response = await call_next(request)

        origin = request.headers.get("Origin")
        allow_origin = None
        if origin in ALLOWED_ORIGINS:
            allow_origin = origin

        if allow_origin:
            response.headers["Access-Control-Allow-Origin"] = allow_origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,PATCH,DELETE,OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "*"
            response.headers["Vary"] = "Origin"

        return response

app = FastAPI(
    title="TrustEdge API",
    redirect_slashes=False,  # allow redirects for trailing slash handling
    lifespan=lifespan,
)

# Add HTTPS redirect middleware first (before other middleware)
app.add_middleware(HTTPSRedirectMiddleware)

# Trust proxy headers (CloudFront / ALB)
app.add_middleware(
    ProxyHeadersMiddleware,
    trusted_hosts="*",
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add a stable CORS header layer to handle CDN forwarding edge-cases.
app.add_middleware(StableCORSHeadersMiddleware)

# Request ID + access logging (added last so it runs first on incoming requests).
app.add_middleware(RequestLoggingMiddleware)

@app.get("/health")
def health(db: Session = Depends(get_db)):
    return {"status": "ok"}

# Include routers
app.include_router(policy_router)
app.include_router(dns_query_router)
app.include_router(device_router)
app.include_router(client_config_router)
app.include_router(vpn_router)
app.include_router(usage_router)
app.include_router(network_attribution_router)
app.include_router(twin_router)
app.include_router(network_flow_router)
app.include_router(vpn_topology_router)
app.include_router(dashboard_router)
