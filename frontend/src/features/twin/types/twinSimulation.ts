export interface PackInfo {
  slug: string;
  name: string;
  domain_count: number;
}

export interface PackState {
  enabled_globally: boolean;
}

export interface RecentHitSample {
  root_domain: string;
  device_id: number;
  hostname: string | null;
  last_seen_at: string;
  query_count_estimate: number;
}

export interface SimulationSummary {
  devices_affected: number;
  newly_blocked_domain_count: number;
  recent_hits_count: number;
  recent_hits_sample: RecentHitSample[];
}

export interface DeviceSimulationImpact {
  device_id: number;
  hostname: string | null;
  added_block_count: number;
  recent_hits: string[];
}

export interface PackToggleSimulationResponse {
  generated_at: string;
  lookback_hours: number;
  pack: PackInfo;
  current_state: PackState;
  proposed_state: PackState;
  summary: SimulationSummary;
  devices: DeviceSimulationImpact[];
}

export interface PackToggleSimulationRequest {
  pack_slug: string;
  enabled_globally: boolean;
}
