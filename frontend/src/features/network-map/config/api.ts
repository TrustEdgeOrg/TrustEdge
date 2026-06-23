import { getAdminAuthHeaders } from '../../../shared/utils/authHeaders';
import { API_BASE_URL } from '../../../shared/config/apiBaseUrl';
import { NetworkMapResponse } from '../types/networkMap';

export async function fetchNetworkAttributionMap(minutes = 15): Promise<NetworkMapResponse> {
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
