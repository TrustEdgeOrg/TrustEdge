"""Unit tests for dnsmasq block line generation."""

from sync import block_domain_dnsmasq_lines, convert_device_entry_to_dnsmasq, domains_to_dnsmasq_lines


def test_block_domain_emits_ipv4_and_ipv6():
    lines = block_domain_dnsmasq_lines("facebook.com", "0.0.0.0", "::")
    assert lines == [
        "address=/facebook.com/0.0.0.0",
        "address=/facebook.com/::",
    ]


def test_domains_dedupes_and_dual_stack():
    lines = domains_to_dnsmasq_lines(
        ["facebook.com", "Facebook.COM", "https://www.foo.com/"],
        "0.0.0.0",
        "::",
    )
    assert "address=/facebook.com/0.0.0.0" in lines
    assert "address=/facebook.com/::" in lines
    assert "address=/foo.com/0.0.0.0" in lines
    assert "address=/foo.com/::" in lines
    assert len(lines) == 4


def test_device_quarantine_tags_vpn_client_ip():
    lines = convert_device_entry_to_dnsmasq(
        {
            "device_id": 5,
            "client_ip": "10.0.0.10",
            "mac_address": "aa:bb:cc:dd:ee:ff",
            "tag": "te_device_5",
            "allowlist_only": True,
            "allowlist_domains": [],
        },
        "10.0.0.1",
        "::",
    )
    assert "dhcp-host=aa:bb:cc:dd:ee:ff,10.0.0.10,set:te_device_5" in lines
    assert "tag:te_device_5" in lines
    assert "address=/#/10.0.0.1" in lines
    assert "address=/#/::" in lines


def test_device_entry_requires_ip_or_mac():
    assert convert_device_entry_to_dnsmasq({"device_id": 1}, "0.0.0.0") == []
