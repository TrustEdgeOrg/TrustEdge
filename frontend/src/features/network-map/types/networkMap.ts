export type NetworkMapNodeType = 'device' | 'app' | 'domain' | 'flow' | 'port' | 'tunnel' | 'gateway' | 'policy';

export type NetworkMapEdgeKind =
  | 'foreground'
  | 'dns'
  | 'dns_direct'
  | 'path_egress'
  | 'path_tunnel'
  | 'path_resolve'
  | 'path_forward'
  | 'flow_session'
  | 'dns_to_flow'
  | 'to_port'
  | 'port_to_flow'
  | 'flow_via_gateway';

export type NetworkMapLayoutMode = 'attribution' | 'path' | 'flow';

export interface NetworkMapNode {
  id: string;
  type: NetworkMapNodeType;
  label: string;
  app_slug?: string | null;
  client_ip?: string | null;
  device_id?: number | null;
  blocked?: boolean | null;
  fresh?: boolean | null;
}

export interface NetworkMapEdge {
  source: string;
  target: string;
  kind: NetworkMapEdgeKind;
  query_count: number;
  blocked_count: number;
}

export interface NetworkMapResponse {
  generated_at: string;
  minutes: number;
  nodes: NetworkMapNode[];
  edges: NetworkMapEdge[];
}

export interface PositionedNode extends NetworkMapNode {
  x: number;
  y: number;
}
