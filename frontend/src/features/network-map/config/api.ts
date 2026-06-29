import { getAdminAuthHeaders } from '../../../shared/utils/authHeaders';
import { API_BASE_URL } from '../../../shared/config/apiBaseUrl';
import { NetworkMapResponse } from '../types/networkMap';

export const DEFAULT_NETWORK_MAP_MINUTES = 1;
export const DEFAULT_NETWORK_MAP_POLL_SEC = 10;

export async function fetchNetworkAttributionMap(
  minutes = DEFAULT_NETWORK_MAP_MINUTES,
): Promise<NetworkMapResponse> {
  const res = await fetch(`${API_BASE_URL}/network-attribution/map?minutes=${minutes}`, {
    headers: {
      Accept: 'application/json',
      ...getAdminAuthHeaders(),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<NetworkMapResponse>;
}
