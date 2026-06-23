from datetime import datetime, timedelta, timezone

import pytest

from app.features.network_attribution.repositories.network_attribution_repository import (
    AppUsageRollupRepository,
    NetworkContextRepository,
)
from app.features.network_attribution.services.app_catalog import normalize_app
from app.features.network_attribution.services.network_attribution_service import (
    NetworkAttributionService,
    _as_utc,
)


def test_normalize_app_teams_bundle():
    app = normalize_app(bundle_id="com.microsoft.teams2", app_name="Microsoft Teams")
    assert app.app_slug == "microsoft_teams"
    assert app.app_display_name == "Microsoft Teams"


def test_normalize_app_zoom_name():
    app = normalize_app(app_name="zoom.us")
    assert app.app_slug == "zoom"
    assert app.app_display_name == "Zoom"


def test_normalize_app_unknown_name():
    app = normalize_app(app_name="My Custom Tool")
    assert app.app_slug == "my_custom_tool"
    assert app.app_display_name == "My Custom Tool"


def test_rollup_splits_hour_boundary(db_session, vpn_device):
    repo = AppUsageRollupRepository(db_session)
    started = datetime(2026, 6, 22, 14, 50, 0, tzinfo=timezone.utc)
    repo.add_active_seconds(
        vpn_device.id,
        app_slug="slack",
        app_display_name="Slack",
        started_at=started,
        duration_sec=900,
    )
    db_session.commit()

    from app.features.network_attribution.models.device_app_usage_rollup import DeviceAppUsageRollup

    rows = (
        db_session.query(DeviceAppUsageRollup)
        .filter(DeviceAppUsageRollup.device_id == vpn_device.id)
        .order_by(DeviceAppUsageRollup.window_start.asc())
        .all()
    )
    assert len(rows) == 2
    assert rows[0].active_seconds == 600
    assert rows[1].active_seconds == 300


def test_resolve_attribution_handles_naive_observed_at(db_session, vpn_device):
    repo = NetworkContextRepository(db_session)
    observed = datetime.now(timezone.utc)
    repo.upsert(
        vpn_device.id,
        app_slug="zoom",
        app_display_name="Zoom",
        bundle_id="us.zoom.xos",
        observed_at=observed,
    )
    db_session.commit()

    service = NetworkAttributionService(db_session)
    resolved = service.resolve_attribution(vpn_device.id, datetime.now(timezone.utc))
    assert resolved is not None
    assert resolved.app_slug == "zoom"


def test_as_utc_normalizes_naive_datetime():
    naive = datetime(2026, 6, 23, 12, 0, 0)
    aware = _as_utc(naive)
    assert aware.tzinfo == timezone.utc
