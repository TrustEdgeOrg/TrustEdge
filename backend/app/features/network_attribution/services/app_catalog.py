from __future__ import annotations

import re
from dataclasses import dataclass

_BUNDLE_MAP: dict[str, tuple[str, str]] = {
    "com.microsoft.teams": ("microsoft_teams", "Microsoft Teams"),
    "com.microsoft.teams2": ("microsoft_teams", "Microsoft Teams"),
    "com.microsoft.teams2.notificationcenter": ("microsoft_teams", "Microsoft Teams"),
    "us.zoom.xos": ("zoom", "Zoom"),
    "us.zoom.caphost": ("zoom", "Zoom"),
    "com.tinyspeck.slackmacgap": ("slack", "Slack"),
    "com.apple.Safari": ("safari", "Safari"),
    "com.google.Chrome": ("google_chrome", "Google Chrome"),
    "com.microsoft.VSCode": ("vscode", "Visual Studio Code"),
    "com.microsoft.edgemac": ("microsoft_edge", "Microsoft Edge"),
    "com.apple.mail": ("apple_mail", "Mail"),
    "com.apple.finder": ("finder", "Finder"),
}

_NAME_MAP: dict[str, tuple[str, str]] = {
    "microsoft teams": ("microsoft_teams", "Microsoft Teams"),
    "teams": ("microsoft_teams", "Microsoft Teams"),
    "zoom.us": ("zoom", "Zoom"),
    "zoom": ("zoom", "Zoom"),
    "slack": ("slack", "Slack"),
    "google chrome": ("google_chrome", "Google Chrome"),
    "chrome": ("google_chrome", "Google Chrome"),
    "safari": ("safari", "Safari"),
    "visual studio code": ("vscode", "Visual Studio Code"),
    "code": ("vscode", "Visual Studio Code"),
    "cursor": ("cursor", "Cursor"),
}


@dataclass(frozen=True)
class NormalizedApp:
    app_slug: str
    app_display_name: str


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.strip().lower())
    slug = slug.strip("_")
    return slug[:64] or "unknown"


def normalize_app(*, bundle_id: str = "", app_name: str = "") -> NormalizedApp:
    bundle = bundle_id.strip().lower()
    if bundle and bundle in _BUNDLE_MAP:
        slug, display = _BUNDLE_MAP[bundle]
        return NormalizedApp(app_slug=slug, app_display_name=display)

    name = app_name.strip()
    if name:
        key = name.lower()
        if key in _NAME_MAP:
            slug, display = _NAME_MAP[key]
            return NormalizedApp(app_slug=slug, app_display_name=display)
        slug = _slugify(name)
        return NormalizedApp(app_slug=slug, app_display_name=name[:128])

    if bundle:
        slug = _slugify(bundle.rsplit(".", 1)[-1])
        return NormalizedApp(app_slug=slug, app_display_name=bundle[:128])

    return NormalizedApp(app_slug="unknown", app_display_name="Unknown")
