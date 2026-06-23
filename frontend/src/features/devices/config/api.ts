import { getAdminAuthHeaders } from '../../../shared/utils/authHeaders';
import { DnsAlertListResponse } from '../../dns-queries/types/dnsQuery';
import {
  Device,
  BehaviorProfile,
  BehaviorReview,
  DeviceCountryBreakdown,
  DeviceCountrySummaryList,
  DeviceLoginGeo,
  DeviceLoginGeoSummaryList,
  DeviceSecurityPolicy,
  ClientBlockedDomain,
  BlockedClientsListResponse,
  QuarantineActionResult,
  AppUsageSummaryResponse,
  AppUsageHourlyListResponse,
} from '../types/device';
import { DevicePolicyAssignment } from '../../policy/types/policy';
import { UsageHistoryResponse } from '../../dashboard/types/usageHistory';
import { DeviceUsageLiveResponse } from '../../dashboard/types/usageLive';

import { API_BASE_URL } from '../../../shared/config/apiBaseUrl';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...getAdminAuthHeaders(),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const devicesApi = {
  list: () => apiFetch<Device[]>('/devices'),
  listUsageLive: (maxAgeSec?: number) => {
    const q = maxAgeSec != null ? `?max_age_sec=${maxAgeSec}` : '';
    return apiFetch<DeviceUsageLiveResponse>(`/devices/usage/live${q}`);
  },
  listUsageHistory: (minutes = 60) =>
    apiFetch<UsageHistoryResponse>(`/devices/usage/history?minutes=${minutes}`),
  listBlockedClients: () => apiFetch<BlockedClientsListResponse>('/devices/blocked-clients'),
  getPolicyAssignment: (deviceId: number) =>
    apiFetch<DevicePolicyAssignment>(`/devices/${deviceId}/policy-assignment`),
  assignPolicyProfile: (deviceId: number, policy_profile_slug: string) =>
    apiFetch<DevicePolicyAssignment>(`/devices/${deviceId}/policy-assignment`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ policy_profile_slug }),
    }),
  getBehaviorProfile: (deviceId: number) =>
    apiFetch<BehaviorProfile>(`/devices/${deviceId}/behavior-profile`),
  getDnsCountries: (deviceId: number, periodHours = 168) =>
    apiFetch<DeviceCountryBreakdown>(
      `/devices/${deviceId}/dns-countries?period_hours=${periodHours}`,
    ),
  listCountrySummaries: (periodHours = 168) =>
    apiFetch<DeviceCountrySummaryList>(`/devices/countries/summary?period_hours=${periodHours}`),
  getLoginLocation: (deviceId: number) =>
    apiFetch<DeviceLoginGeo>(`/devices/${deviceId}/login-location`),
  listLoginLocationSummaries: () =>
    apiFetch<DeviceLoginGeoSummaryList>('/devices/login-locations/summary'),
  getBehaviorReview: (deviceId: number, refresh = false) => {
    const q = refresh ? '?refresh=true' : '';
    return apiFetch<BehaviorReview>(`/devices/${deviceId}/behavior-review${q}`);
  },
  getSecurityPolicy: (deviceId: number) =>
    apiFetch<DeviceSecurityPolicy>(`/devices/${deviceId}/security-policy`),
  updateSecurityPolicy: (deviceId: number, body: Partial<DeviceSecurityPolicy>) =>
    apiFetch<DeviceSecurityPolicy>(`/devices/${deviceId}/security-policy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  listClientBlocks: (deviceId: number) =>
    apiFetch<ClientBlockedDomain[]>(`/devices/${deviceId}/client-blocks`),
  revokeClientBlock: (deviceId: number, blockId: number) =>
    apiFetch<{ revoked: boolean }>(`/devices/${deviceId}/client-blocks/${blockId}`, {
      method: 'DELETE',
    }),
  startQuarantine: (deviceId: number, hours = 4) =>
    apiFetch<QuarantineActionResult>(`/devices/${deviceId}/quarantine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hours }),
    }),
  endQuarantine: (deviceId: number) =>
    apiFetch<QuarantineActionResult>(`/devices/${deviceId}/quarantine`, {
      method: 'DELETE',
    }),
  getBehaviorEvents: (deviceId: number, page = 1, pageSize = 20) =>
    apiFetch<DnsAlertListResponse>(
      `/devices/${deviceId}/behavior-events?page=${page}&page_size=${pageSize}`,
    ),
  getNetworkAttributionSummary: (deviceId: number, hours = 168) =>
    apiFetch<AppUsageSummaryResponse>(
      `/devices/${deviceId}/network-attribution/summary?hours=${hours}`,
    ),
  getNetworkAttributionHourly: (deviceId: number, hours = 168, appSlug?: string) => {
    const params = new URLSearchParams({ hours: String(hours) });
    if (appSlug) {
      params.set('app_slug', appSlug);
    }
    return apiFetch<AppUsageHourlyListResponse>(
      `/devices/${deviceId}/network-attribution?${params.toString()}`,
    );
  },
};
