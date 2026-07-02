import { getAdminAuthHeaders } from '../../../shared/utils/authHeaders';
import { API_BASE_URL } from '../../../shared/config/apiBaseUrl';
import {
  TraverseRequest,
  TraverseResponse,
  TwinGraphSnapshot,
} from '../types/twinGraph';

export const DEFAULT_TWIN_GRAPH_MINUTES = 1;
export const DEFAULT_TWIN_GRAPH_POLL_SEC = 10;

export async function fetchTwinGraphSnapshot(
  minutes = DEFAULT_TWIN_GRAPH_MINUTES,
  includeFlows = false,
  includePolicy = true,
): Promise<TwinGraphSnapshot> {
  const params = new URLSearchParams({
    minutes: String(minutes),
    include_policy: String(includePolicy),
  });
  if (includeFlows) {
    params.set('include_flows', 'true');
  }
  const res = await fetch(`${API_BASE_URL}/twin/graph/snapshot?${params}`, {
    headers: {
      Accept: 'application/json',
      ...getAdminAuthHeaders(),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<TwinGraphSnapshot>;
}

export async function traverseTwinGraph(
  body: TraverseRequest,
  minutes = DEFAULT_TWIN_GRAPH_MINUTES,
  includeFlows = false,
  includePolicy = true,
): Promise<TraverseResponse> {
  const params = new URLSearchParams({
    minutes: String(minutes),
    include_policy: String(includePolicy),
  });
  if (includeFlows) {
    params.set('include_flows', 'true');
  }
  const res = await fetch(`${API_BASE_URL}/twin/graph/traverse?${params}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...getAdminAuthHeaders(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<TraverseResponse>;
}
