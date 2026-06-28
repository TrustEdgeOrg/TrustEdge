"""Domain matching helpers for twin simulation."""

from __future__ import annotations

from typing import Set

from app.features.policy.pack_common import normalize_domain
from app.shared.domain_utils import extract_root_domain


def root_matches_block_set(root_domain: str, block_domains: Set[str]) -> bool:
    """Return True if *root_domain* would be blocked by dnsmasq rules in *block_domains*."""
    root = extract_root_domain(root_domain)
    for block in block_domains:
        normalized = normalize_domain(block)
        if not normalized:
            continue
        if root == normalized or root == extract_root_domain(normalized):
            return True
        if root.endswith("." + normalized):
            return True
    return False
