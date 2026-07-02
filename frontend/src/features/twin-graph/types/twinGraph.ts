export type TwinLayer = 'observed' | 'desired' | 'simulated';

export type TwinEntityType =
  | 'device'
  | 'vpn_peer'
  | 'ip_lease'
  | 'app'
  | 'domain'
  | 'ip_address'
  | 'l4_service'
  | 'flow_session'
  | 'dns_query'
  | 'policy_profile'
  | 'policy_pack'
  | 'policy_rule'
  | 'infra_component'
  | 'geo_country'
  | 'behavior_signal'
  | 'quarantine';

export type TwinRelation =
  | 'enrolled_as'
  | 'leased_ip'
  | 'runs'
  | 'queries'
  | 'queries_direct'
  | 'resolves_to'
  | 'opens'
  | 'opens_direct'
  | 'uses_service'
  | 'destinates'
  | 'correlates'
  | 'routed_via'
  | 'terminates_at'
  | 'assigned'
  | 'includes'
  | 'defines'
  | 'blocks'
  | 'allows'
  | 'enforces'
  | 'quarantined'
  | 'observed_in'
  | 'scored_by'
  | 'simulated_block';

export type TraverseDirection = 'out' | 'in' | 'both';

export interface TwinNode {
  id: string;
  entity_type: TwinEntityType;
  layer: TwinLayer;
  label: string;
  properties: Record<string, unknown>;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  stale?: boolean;
}

export interface TwinEdge {
  id: string;
  source_id: string;
  target_id: string;
  relation: TwinRelation;
  layer: TwinLayer;
  weight: number;
  properties: Record<string, unknown>;
  bidirectional?: boolean;
}

export interface TwinGraphSnapshot {
  generated_at: string;
  window_minutes: number;
  nodes: TwinNode[];
  edges: TwinEdge[];
  meta?: Record<string, unknown>;
}

export interface TraverseRequest {
  seed_node_ids: string[];
  direction?: TraverseDirection;
  relations?: TwinRelation[];
  entity_types?: TwinEntityType[];
  max_depth?: number;
  layers?: TwinLayer[];
  stop_at_entity_types?: TwinEntityType[];
}

export interface TraversePath {
  seed_id: string;
  hops: string[];
}

export interface TraverseResponse {
  nodes: TwinNode[];
  edges: TwinEdge[];
  paths: TraversePath[];
}

/** Named filter presets — projections over the canonical graph, not graph structure. */
export interface GraphProjectionPreset {
  id: 'attribution' | 'path' | 'flow' | 'impact' | 'rca';
  entity_types?: TwinEntityType[];
  relations?: TwinRelation[];
  include_infra?: boolean;
  seed_driven?: boolean;
  direction?: TraverseDirection;
  max_depth?: number;
}

export const GRAPH_PROJECTION_PRESETS: Record<
  GraphProjectionPreset['id'],
  GraphProjectionPreset
> = {
  attribution: {
    id: 'attribution',
    entity_types: ['device', 'app', 'domain'],
    relations: ['runs', 'queries', 'queries_direct'],
  },
  path: {
    id: 'path',
    include_infra: true,
    relations: [
      'runs',
      'routed_via',
      'terminates_at',
      'enforces',
      'queries',
      'queries_direct',
      'resolves_to',
    ],
  },
  flow: {
    id: 'flow',
    entity_types: ['device', 'app', 'l4_service', 'flow_session', 'ip_address', 'infra_component'],
    relations: ['opens', 'opens_direct', 'uses_service', 'destinates', 'correlates', 'routed_via'],
  },
  impact: {
    id: 'impact',
    seed_driven: true,
    direction: 'both',
    max_depth: 4,
  },
  rca: {
    id: 'rca',
    seed_driven: true,
    direction: 'in',
    relations: ['blocks', 'allows', 'defines', 'includes', 'assigned', 'enforces', 'queries'],
    max_depth: 8,
  },
};
