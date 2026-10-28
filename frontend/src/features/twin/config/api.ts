import { getAdminAuthHeaders } from '../../../shared/utils/authHeaders';
import { API_BASE_URL } from '../../../shared/config/apiBaseUrl';
import {
  SecurityAlert,
  SecurityAlertExplainResponse,
  SecurityAlertListParams,
  SecurityAlertListResponse,
} from '../types/securityAlert';
import {
  AgentTelemetryEventListResponse,
  ConnectedAgent,
  ConnectedAgentListResponse,
} from '../types/connectedAgent';
import { DeviceBaselineResponse } from '../types/deviceBaseline';
import {
  AiSessionChainResponse,
  AiSessionDetail,
  AiSessionGraphResponse,
  AiSessionListResponse,
  AiSessionTimelineResponse,
} from '../types/aiActivity';
import { AiSoftwareListResponse } from '../types/aiSoftware';

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

function listAlertsQuery(params: SecurityAlertListParams = {}): string {
  const search = new URLSearchParams();
  if (params.page != null) search.set('page', String(params.page));
  if (params.page_size != null) search.set('page_size', String(params.page_size));
  if (params.severity) search.set('severity', params.severity);
  if (params.alert_type) search.set('alert_type', params.alert_type);
  if (params.device_id) search.set('device_id', params.device_id);
  const qs = search.toString();
  return qs ? `/security/alerts?${qs}` : '/security/alerts';
}

export const twinApi = {
  listAlerts: (params?: SecurityAlertListParams) =>
    apiFetch<SecurityAlertListResponse>(listAlertsQuery(params)),
  explainAlert: (alert: SecurityAlert) =>
    apiFetch<SecurityAlertExplainResponse>('/security/alerts/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: alert.timestamp,
        device_id: alert.device_id,
        event_id: alert.event_id,
        event_type: alert.event_type,
        alert_type: alert.alert_type,
        severity: alert.severity,
        message: alert.message,
        detail: alert.detail,
        fingerprint: alert.fingerprint,
      }),
    }),
  listConnectedAgents: (connectedWithinSec = 300) =>
    apiFetch<ConnectedAgentListResponse>(
      `/security/agents?connected_within_sec=${encodeURIComponent(String(connectedWithinSec))}`
    ),
  getConnectedAgent: (deviceId: string, connectedWithinSec = 300) =>
    apiFetch<ConnectedAgent>(
      `/security/agents/${encodeURIComponent(deviceId)}?connected_within_sec=${encodeURIComponent(String(connectedWithinSec))}`
    ),
  listDeviceEvents: (deviceId: string, limit = 50) =>
    apiFetch<AgentTelemetryEventListResponse>(
      `/security/agents/${encodeURIComponent(deviceId)}/events?limit=${encodeURIComponent(String(limit))}`
    ),
  listAgentActions: (deviceId: string, limit = 200) =>
    apiFetch<AgentTelemetryEventListResponse>(
      `/security/agents/${encodeURIComponent(deviceId)}/agent-actions?limit=${encodeURIComponent(String(limit))}`
    ),
  listAiSoftware: (deviceId: string) =>
    apiFetch<AiSoftwareListResponse>(
      `/security/agents/${encodeURIComponent(deviceId)}/ai-software`
    ),
  getDeviceBaseline: (deviceId: string, limit = 100) =>
    apiFetch<DeviceBaselineResponse>(
      `/security/agents/${encodeURIComponent(deviceId)}/baseline?limit=${encodeURIComponent(String(limit))}`
    ),
  clearDeviceBaseline: (deviceId: string) =>
    apiFetch<{ device_id: string; cleared: number }>(
      `/security/agents/${encodeURIComponent(deviceId)}/baseline`,
      { method: 'DELETE' }
    ),
  listAiSessions: (deviceId: string, limit = 50, includeClosed = true) =>
    apiFetch<AiSessionListResponse>(
      `/security/agents/${encodeURIComponent(deviceId)}/ai-sessions?limit=${encodeURIComponent(String(limit))}&include_closed=${includeClosed ? '1' : '0'}`
    ),
  getAiSession: (sessionId: string) =>
    apiFetch<AiSessionDetail>(`/security/ai-sessions/${encodeURIComponent(sessionId)}`),
  getAiSessionGraph: (sessionId: string) =>
    apiFetch<AiSessionGraphResponse>(
      `/security/ai-sessions/${encodeURIComponent(sessionId)}/graph`
    ),
  getAiSessionTimeline: (sessionId: string, limit = 200) =>
    apiFetch<AiSessionTimelineResponse>(
      `/security/ai-sessions/${encodeURIComponent(sessionId)}/timeline?limit=${encodeURIComponent(String(limit))}`
    ),
  getAiSessionChain: (sessionId: string) =>
    apiFetch<AiSessionChainResponse>(
      `/security/ai-sessions/${encodeURIComponent(sessionId)}/chain`
    ),
};
