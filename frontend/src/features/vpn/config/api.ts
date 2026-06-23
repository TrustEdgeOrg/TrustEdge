import { getAdminAuthHeaders } from '../../../shared/utils/authHeaders';
import { API_BASE_URL } from '../../../shared/config/apiBaseUrl';
import { VpnTopology } from '../types/topology';

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

export const vpnApi = {
  getTopology: () => apiFetch<VpnTopology>('/vpn/topology'),
};
