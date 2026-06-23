import { useCallback, useEffect, useMemo, useState } from 'react';
import { devicesApi } from '../../devices/config/api';
import { Device } from '../../devices/types/device';
import {
  isClientActiveNow,
  subscribeDnsClientActivity,
} from '../../dns-queries/dnsClientActivity';
import { ClientBandwidth, DeviceUsageLiveItem } from '../types/usageLive';
import { ServerNetworkThroughput } from '../types/networkThroughput';
import { useUsageRealtime } from './useUsageRealtime';

export interface LiveCountryItem {
  country_code: string;
  country_name: string | null;
  client_count: number;
}

export interface LiveClientRow {
  client_ip: string;
  hostname: string | null;
  mac_address: string | null;
  source: string | null;
  device_id: number | null;
  /** Country from public IP at last VPN enroll (GeoIP). */
  vpn_login_country_code: string | null;
  vpn_login_country_name: string | null;
  /** DNS activity in the last few minutes (WebSocket feed). */
  is_active_now: boolean;
  /** Latest VPN tunnel throughput from /devices/usage/live. */
  bandwidth: ClientBandwidth | null;
}

const POLL_MS = 12_000;

function sourceLabel(source: string | null): string {
  switch (source) {
    case 'vpn_enroll':
      return 'VPN enrolled';
    case 'dhcp_lease':
      return 'DHCP';
    case 'dns_observed':
      return 'DNS observed';
    case 'manual':
      return 'Manual';
    default:
      return source || 'Unknown';
  }
}

export function formatClientSource(source: string | null): string {
  return sourceLabel(source);
}

function buildRows(
  devices: Device[],
  loginGeoByDevice: Map<
    number,
    { country_code: string | null; country_name: string | null }
  >,
): LiveClientRow[] {
  return devices.map((device) => {
    const loginGeo = loginGeoByDevice.get(device.id);
    return {
      client_ip: device.client_ip,
      hostname: device.hostname,
      mac_address: device.mac_address,
      source: device.source,
      device_id: device.id,
      vpn_login_country_code: loginGeo?.country_code ?? null,
      vpn_login_country_name: loginGeo?.country_name ?? null,
      is_active_now: false,
      bandwidth: null,
    };
  });
}

function buildUsageMaps(items: DeviceUsageLiveItem[]): {
  byDeviceId: Map<number, ClientBandwidth>;
  byClientIp: Map<string, ClientBandwidth>;
} {
  const byDeviceId = new Map<number, ClientBandwidth>();
  const byClientIp = new Map<string, ClientBandwidth>();
  const toBw = (item: DeviceUsageLiveItem): ClientBandwidth => ({
    rx_mib_per_sec: item.rx_mib_per_sec,
    tx_mib_per_sec: item.tx_mib_per_sec,
    total_mib_per_sec: item.total_mib_per_sec,
    delta_rx_bytes: item.delta_rx_bytes,
    delta_tx_bytes: item.delta_tx_bytes,
    recorded_at: item.recorded_at,
  });
  for (const item of items) {
    const bw = toBw(item);
    if (item.device_id != null) {
      byDeviceId.set(item.device_id, bw);
    }
    if (item.client_ip) {
      byClientIp.set(item.client_ip, bw);
    }
  }
  return { byDeviceId, byClientIp };
}

function attachBandwidth(
  rows: LiveClientRow[],
  byDeviceId: Map<number, ClientBandwidth>,
  byClientIp: Map<string, ClientBandwidth>,
): LiveClientRow[] {
  return rows.map((row) => {
    const bw =
      (row.device_id != null ? byDeviceId.get(row.device_id) : undefined) ??
      byClientIp.get(row.client_ip);
    return bw ? { ...row, bandwidth: bw } : row;
  });
}

/** Registered devices with recent DNS activity or an active VPN usage sample. */
function filterLiveRegisteredClients(rows: LiveClientRow[]): LiveClientRow[] {
  return rows.filter(
    (row) =>
      row.device_id != null && (row.is_active_now || row.bandwidth != null),
  );
}

function sortClients(rows: LiveClientRow[]): LiveClientRow[] {
  return [...rows].sort((a, b) => {
    const nameA = (a.hostname || a.client_ip).toLowerCase();
    const nameB = (b.hostname || b.client_ip).toLowerCase();
    return nameA.localeCompare(nameB);
  });
}

function withLiveActivity(rows: LiveClientRow[]): LiveClientRow[] {
  return rows.map((row) => ({
    ...row,
    is_active_now: isClientActiveNow(row.client_ip),
  }));
}

function buildLiveCountries(clients: LiveClientRow[]): LiveCountryItem[] {
  const counts = new Map<string, { name: string | null; count: number }>();
  let unknown = 0;
  for (const c of clients) {
    const code = c.vpn_login_country_code?.trim().toUpperCase();
    if (!code) {
      unknown += 1;
      continue;
    }
    const prev = counts.get(code);
    if (prev) {
      prev.count += 1;
      if (!prev.name && c.vpn_login_country_name) {
        prev.name = c.vpn_login_country_name;
      }
    } else {
      counts.set(code, { name: c.vpn_login_country_name, count: 1 });
    }
  }
  const items: LiveCountryItem[] = [...counts.entries()].map(([country_code, v]) => ({
    country_code,
    country_name: v.name,
    client_count: v.count,
  }));
  items.sort(
    (a, b) => b.client_count - a.client_count || a.country_code.localeCompare(b.country_code),
  );
  if (unknown > 0) {
    items.push({
      country_code: 'UNKNOWN',
      country_name: 'Unknown login location',
      client_count: unknown,
    });
  }
  return items;
}

export interface UseLiveClientsResult {
  clients: LiveClientRow[];
  /** All enrolled clients with VPN login geo (for client map markers). */
  mapClients: LiveClientRow[];
  liveCountries: LiveCountryItem[];
  loading: boolean;
  error: string | null;
  usageError: string | null;
  enrolledCount: number;
  liveClientsBandwidth: {
    rx_mib_per_sec: number;
    tx_mib_per_sec: number;
    total_mib_per_sec: number;
  };
  serverThroughput: ServerNetworkThroughput;
  throughputHistory: ReturnType<typeof useUsageRealtime>['throughputHistory'];
  refetch: () => Promise<void>;
}

export function useLiveClients(): UseLiveClientsResult {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dnsActivityTick, setDnsActivityTick] = useState(0);
  const [loginGeoByDevice, setLoginGeoByDevice] = useState<
    Map<number, { country_code: string | null; country_name: string | null }>
  >(new Map());

  const {
    liveItems,
    serverThroughput,
    throughputHistory,
    usageError,
    refetchUsage,
  } = useUsageRealtime();

  const { byDeviceId, byClientIp } = useMemo(
    () => buildUsageMaps(liveItems),
    [liveItems],
  );

  const enrichedRows = useMemo(() => {
    const withActivity = withLiveActivity(buildRows(devices, loginGeoByDevice));
    return attachBandwidth(withActivity, byDeviceId, byClientIp);
  // dnsActivityTick forces refresh when DNS live feed marks clients active.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, loginGeoByDevice, byDeviceId, byClientIp, dnsActivityTick]);

  const clients = useMemo(
    () => sortClients(filterLiveRegisteredClients(enrichedRows)),
    [enrichedRows],
  );

  const mapClients = useMemo(
    () =>
      sortClients(
        enrichedRows.filter(
          (row) =>
            row.device_id != null &&
            Boolean(row.vpn_login_country_code?.trim()) &&
            row.vpn_login_country_code?.trim().toUpperCase() !== 'UNKNOWN' &&
            row.vpn_login_country_code?.trim().toUpperCase() !== 'GLOBAL',
        ),
      ),
    [enrichedRows],
  );

  useEffect(
    () => subscribeDnsClientActivity(() => setDnsActivityTick((t) => t + 1)),
    [],
  );

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const [deviceList, loginGeoRes] = await Promise.all([
        devicesApi.list(),
        devicesApi.listLoginLocationSummaries().catch(() => ({ items: [] })),
      ]);
      setDevices(deviceList);
      const geoMap = new Map<
        number,
        { country_code: string | null; country_name: string | null }
      >();
      for (const item of loginGeoRes.items) {
        if (item.country_code) {
          geoMap.set(item.device_id, {
            country_code: item.country_code,
            country_name: item.country_name,
          });
        }
      }
      setLoginGeoByDevice(geoMap);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load clients');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, POLL_MS);
    return () => clearInterval(id);
  }, [fetchAll]);

  const liveCountries = useMemo(() => buildLiveCountries(clients), [clients]);

  const enrolledCount = clients.filter((c) => c.source === 'vpn_enroll').length;

  const liveClientsBandwidth = clients.reduce(
    (acc, c) => {
      if (!c.bandwidth) {
        return acc;
      }
      return {
        rx_mib_per_sec: acc.rx_mib_per_sec + c.bandwidth.rx_mib_per_sec,
        tx_mib_per_sec: acc.tx_mib_per_sec + c.bandwidth.tx_mib_per_sec,
        total_mib_per_sec: acc.total_mib_per_sec + c.bandwidth.total_mib_per_sec,
      };
    },
    { rx_mib_per_sec: 0, tx_mib_per_sec: 0, total_mib_per_sec: 0 },
  );

  const refetch = useCallback(async () => {
    await Promise.all([fetchAll(), refetchUsage()]);
  }, [fetchAll, refetchUsage]);

  return {
    clients,
    mapClients,
    liveCountries,
    loading,
    error,
    usageError,
    enrolledCount,
    liveClientsBandwidth,
    serverThroughput,
    throughputHistory,
    refetch,
  };
}
