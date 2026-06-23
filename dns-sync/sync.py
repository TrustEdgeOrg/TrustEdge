#!/usr/bin/env python3
"""
DNS Sync Script for dnsmasq
Fetches policy DNS rules from TrustEdge API and updates dnsmasq configuration.
"""

import os
import sys
import subprocess
import time
import json
from pathlib import Path
from typing import List, Optional, Dict, Any

from log_config import setup_logging, structured_extra

logger = setup_logging(service="dns-sync", logger_name=__name__)

API_BASE_URL = os.getenv('API_BASE_URL', 'http://localhost:8000')
POLICY_DNS_SYNC_ENDPOINT = os.getenv('POLICY_DNS_SYNC_ENDPOINT', '/policy/dns-sync')
POLICY_SYNC_REPORT_ENDPOINT = os.getenv('POLICY_SYNC_REPORT_ENDPOINT', '/policy/sync-report')
BLOCK_IP = os.getenv('BLOCK_IP', '0.0.0.0')
BLOCK_IPV6_IP = os.getenv('BLOCK_IPV6_IP', '::')
DNS_CONFIG_PATH = os.getenv('DNS_CONFIG_PATH', '/etc/dnsmasq.d/blocked-domains.conf')
SYNC_INTERVAL = int(os.getenv('SYNC_INTERVAL', '3600'))
DNSMASQ_RESTART_CMD = os.getenv('DNSMASQ_RESTART_CMD', 'killall -HUP dnsmasq')
DEVICE_SYNC_ENDPOINT = os.getenv('DEVICE_SYNC_ENDPOINT', '/devices/sync-dhcp')
DHCP_LEASES_PATH = os.getenv('DHCP_LEASES_PATH', '/var/lib/misc/dnsmasq.leases')
DEVICE_SYNC_ENABLED = os.getenv('DEVICE_SYNC_ENABLED', '1').lower() not in ('0', 'false', 'no')
DNS_INGEST_TOKEN = os.getenv('DNS_INGEST_TOKEN', '').strip()
ADMIN_API_TOKEN = os.getenv('ADMIN_API_TOKEN', '').strip()
CLIENT_BLOCKS_CONFIG_DIR = os.getenv('CLIENT_BLOCKS_CONFIG_DIR', '/etc/dnsmasq.d/trustedge-devices')


def _api_headers(admin: bool = False, ingest: bool = False) -> Dict[str, str]:
    headers = {'Accept': 'application/json'}
    if admin and ADMIN_API_TOKEN:
        headers['Authorization'] = f'Bearer {ADMIN_API_TOKEN}'
    elif ingest and DNS_INGEST_TOKEN:
        headers['Authorization'] = f'Bearer {DNS_INGEST_TOKEN}'
    return headers


def fetch_policy_dns_sync(api_url: str, endpoint: str) -> Optional[Dict[str, Any]]:
    if not api_url:
        logger.error(
            "API_BASE_URL not set",
            extra=structured_extra("policy_sync_config_error"),
        )
        return None
    try:
        import urllib.request

        url = f"{api_url.rstrip('/')}{endpoint}"
        req = urllib.request.Request(url, headers=_api_headers(ingest=True))
        with urllib.request.urlopen(req, timeout=60) as response:
            if response.status != 200:
                logger.error(
                    "Policy DNS sync API error",
                    extra=structured_extra("policy_sync_fetch_failed", status_code=response.status),
                )
                return None
            return json.loads(response.read().decode('utf-8'))
    except Exception:
        logger.error(
            "Policy DNS sync fetch failed",
            extra=structured_extra("policy_sync_fetch_failed"),
            exc_info=True,
        )
        return None


def _normalize_blocked_domain(site: str) -> str:
    domain = str(site).strip().lower()
    domain = domain.replace('http://', '').replace('https://', '').replace('www.', '')
    return domain.split('/')[0].split('?')[0]


def block_domain_dnsmasq_lines(
    domain: str,
    block_ip: str,
    block_ipv6_ip: str,
) -> List[str]:
    """IPv4 + IPv6 sinkhole lines (AAAA bypass fix for dual-stack clients)."""
    lines = [f"address=/{domain}/{block_ip}"]
    if block_ipv6_ip:
        lines.append(f"address=/{domain}/{block_ipv6_ip}")
    return lines


def domains_to_dnsmasq_lines(
    domains: List[str],
    block_ip: str,
    block_ipv6_ip: Optional[str] = None,
) -> List[str]:
    if block_ipv6_ip is None:
        block_ipv6_ip = BLOCK_IPV6_IP
    entries = []
    seen = set()
    for site in domains:
        domain = _normalize_blocked_domain(site)
        if not domain or domain in seen:
            continue
        seen.add(domain)
        entries.extend(block_domain_dnsmasq_lines(domain, block_ip, block_ipv6_ip))
    return entries


def _dhcp_host_tag_line(entry: Dict[str, Any], tag: str) -> Optional[str]:
    """Tag DNS queries by VPN client IP (WireGuard) and/or LAN MAC."""
    mac = (entry.get('mac_address') or '').strip().lower()
    client_ip = (entry.get('client_ip') or '').strip()
    if not mac and not client_ip:
        return None
    parts: List[str] = []
    if mac:
        parts.append(mac)
    if client_ip:
        parts.append(client_ip)
    parts.append(f"set:{tag}")
    return f"dhcp-host={','.join(parts)}"


def convert_device_entry_to_dnsmasq(
    entry: Dict[str, Any],
    block_ip: str,
    block_ipv6_ip: Optional[str] = None,
) -> List[str]:
    if block_ipv6_ip is None:
        block_ipv6_ip = BLOCK_IPV6_IP
    tag = entry.get('tag') or f"te_device_{entry.get('device_id')}"
    host_line = _dhcp_host_tag_line(entry, tag)
    if not host_line:
        return []

    lines = [f"# Device {entry.get('device_id')}", host_line]

    if entry.get('allowlist_only'):
        lines.append(f"tag:{tag}")
        lines.append(f"address=/#/{block_ip}")
        if block_ipv6_ip:
            lines.append(f"tag:{tag}")
            lines.append(f"address=/#/{block_ipv6_ip}")
        for domain in entry.get('allowlist_domains') or []:
            d = str(domain).strip().lower()
            if not d:
                continue
            lines.append(f"tag:{tag}")
            lines.append(f"address=/{d}/#")
    else:
        for pattern in entry.get('block_country_tlds') or []:
            p = str(pattern).strip().lower()
            if not p:
                continue
            if not p.startswith('.'):
                p = f'.{p}'
            for addr_line in block_domain_dnsmasq_lines(p, block_ip, block_ipv6_ip):
                lines.append(f"tag:{tag}")
                lines.append(addr_line)
        for domain in entry.get('block_domains') or []:
            d = str(domain).strip().lower()
            if not d:
                continue
            for addr_line in block_domain_dnsmasq_lines(d, block_ip, block_ipv6_ip):
                lines.append(f"tag:{tag}")
                lines.append(addr_line)
    return lines


def write_dns_config(entries: List[str], config_path: str) -> bool:
    try:
        config_file = Path(config_path)
        config_file.parent.mkdir(parents=True, exist_ok=True)
        header = [
            "# TrustEdge global policy blocks (auto-generated)",
            f"# Generated at: {time.strftime('%Y-%m-%d %H:%M:%S')}",
            "",
        ]
        content = '\n'.join(header + entries) + '\n'
        config_file.write_text(content)
        return True
    except Exception:
        logger.error(
            "Failed to write DNS config",
            extra=structured_extra("policy_dns_write_failed", path=config_path),
            exc_info=True,
        )
        return False


def write_client_block_configs(files: Dict[str, List[str]], config_dir: str) -> bool:
    try:
        config_path = Path(config_dir)
        config_path.mkdir(parents=True, exist_ok=True)

        active_names = set(files.keys())
        removed = 0
        for pattern in ('te-device-*.conf', 'ng-device-*.conf'):
            for existing in config_path.glob(pattern):
                if existing.name not in active_names:
                    existing.unlink()
                    removed += 1

        for filename, lines in files.items():
            content = '\n'.join(lines) + '\n'
            (config_path / filename).write_text(content)

        logger.info(
            "Per-device DNS configs written",
            extra=structured_extra(
                "policy_device_configs_written",
                device_count=len(files),
                removed_stale=removed,
            ),
        )
        return True
    except Exception:
        logger.error(
            "Failed to write per-device DNS configs",
            extra=structured_extra("policy_device_configs_failed", path=config_dir),
            exc_info=True,
        )
        return False


def reload_dnsmasq(cmd: str) -> bool:
    if not cmd:
        return True
    try:
        subprocess.run(cmd, shell=True, check=True, capture_output=True, text=True)
        return True
    except subprocess.CalledProcessError as e:
        logger.error(
            "dnsmasq reload failed",
            extra=structured_extra("dnsmasq_reload_failed", stderr=(e.stderr or "")[:500]),
        )
        return False


def sync_policy_dns():
    data = fetch_policy_dns_sync(API_BASE_URL, POLICY_DNS_SYNC_ENDPOINT)
    if data is None:
        return False

    global_lines = domains_to_dnsmasq_lines(data.get('global_domains') or [], BLOCK_IP)
    if not write_dns_config(global_lines, DNS_CONFIG_PATH):
        return False

    files: Dict[str, List[str]] = {}
    for entry in data.get('entries') or []:
        device_id = entry.get('device_id')
        lines = convert_device_entry_to_dnsmasq(entry, BLOCK_IP)
        if device_id and lines:
            files[f"te-device-{device_id}.conf"] = lines

    if not write_client_block_configs(files, CLIENT_BLOCKS_CONFIG_DIR):
        return False

    logger.info(
        "Policy DNS config updated",
        extra=structured_extra(
            "policy_dns_sync_ok",
            global_entries=len(global_lines),
            device_configs=len(files),
        ),
    )

    if DNSMASQ_RESTART_CMD:
        if not reload_dnsmasq(DNSMASQ_RESTART_CMD):
            logger.warning(
                "dnsmasq reload failed after config update",
                extra=structured_extra("dnsmasq_reload_failed_after_sync"),
            )
            return False
    return True


def parse_dhcp_leases(leases_path: str) -> List[Dict[str, Any]]:
    lease_file = Path(leases_path)
    if not lease_file.exists():
        logger.warning(
            "DHCP lease file not found",
            extra=structured_extra("dhcp_leases_missing", path=leases_path),
        )
        return []

    leases: List[Dict[str, Any]] = []
    try:
        for line in lease_file.read_text(encoding='utf-8', errors='ignore').splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split()
            if len(parts) < 4:
                continue
            mac = parts[1].strip().lower()
            client_ip = parts[2].strip()
            hostname = parts[3].strip()
            if hostname == '*':
                hostname = None
            leases.append({
                'client_ip': client_ip,
                'hostname': hostname,
                'mac_address': mac,
            })
    except Exception:
        logger.error(
            "Failed to parse DHCP leases",
            extra=structured_extra("dhcp_leases_parse_failed", path=leases_path),
            exc_info=True,
        )
        return []

    return leases


def sync_devices_from_dhcp(api_url: str, endpoint: str, leases_path: str) -> bool:
    leases = parse_dhcp_leases(leases_path)
    if not leases:
        return True
    try:
        import urllib.request

        url = f"{api_url.rstrip('/')}{endpoint}"
        data = json.dumps({'leases': leases}).encode('utf-8')
        req = urllib.request.Request(url, data=data, method='POST')
        for key, value in _api_headers(ingest=True).items():
            req.add_header(key, value)
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=30) as response:
            body = response.read().decode('utf-8')
            if response.status not in (200, 201):
                logger.error(
                    "DHCP device sync API error",
                    extra=structured_extra(
                        "dhcp_sync_failed",
                        status_code=response.status,
                        body=body[:500],
                    ),
                )
                return False
            logger.info(
                "DHCP device sync completed",
                extra=structured_extra("dhcp_sync_ok", lease_count=len(leases)),
            )
            return True
    except Exception:
        logger.error(
            "DHCP device sync failed",
            extra=structured_extra("dhcp_sync_failed", lease_count=len(leases)),
            exc_info=True,
        )
        return False


def report_policy_sync(success: bool, message: str = "") -> None:
    if not API_BASE_URL:
        return
    try:
        import urllib.request

        url = f"{API_BASE_URL.rstrip('/')}{POLICY_SYNC_REPORT_ENDPOINT}"
        body = json.dumps({"success": success, "message": message or None}).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={**_api_headers(ingest=True), "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=15):
            pass
    except Exception as e:
        logger.warning(
            "Failed to report policy sync status",
            extra=structured_extra("policy_sync_report_failed", error=str(e)),
        )


def sync_cycle() -> bool:
    policy_ok = sync_policy_dns()
    devices_ok = True
    if DEVICE_SYNC_ENABLED:
        devices_ok = sync_devices_from_dhcp(API_BASE_URL, DEVICE_SYNC_ENDPOINT, DHCP_LEASES_PATH)
    overall = policy_ok and devices_ok
    report_policy_sync(
        overall,
        "Policy DNS sync completed" if overall else "Policy DNS sync completed with issues",
    )
    if overall:
        logger.info(
            "DNS sync cycle completed",
            extra=structured_extra("dns_sync_cycle_ok"),
        )
        return True
    logger.warning(
        "DNS sync cycle completed with issues",
        extra=structured_extra(
            "dns_sync_cycle_partial",
            policy_ok=policy_ok,
            devices_ok=devices_ok,
        ),
    )
    return False


def main():
    logger.info(
        "DNS sync service started",
        extra=structured_extra(
            "dns_sync_started",
            api_base_url=API_BASE_URL,
            sync_interval_sec=SYNC_INTERVAL,
        ),
    )
    first_ok = sync_cycle()
    if SYNC_INTERVAL > 0:
        while True:
            time.sleep(SYNC_INTERVAL)
            sync_cycle()
    else:
        sys.exit(0 if first_ok else 1)


if __name__ == '__main__':
    main()
