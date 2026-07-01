import { NetworkMapEdge, NetworkMapNode } from '../types/networkMap';
import { edgeKey } from './whatIfSimulation';

export const INFRA_TUNNEL_ID = 'infra:wireguard';
export const INFRA_GATEWAY_ID = 'infra:gateway';
export const INFRA_POLICY_ID = 'infra:policy';

const INFRA_NODES: NetworkMapNode[] = [
  { id: INFRA_TUNNEL_ID, type: 'tunnel', label: 'WireGuard' },
  { id: INFRA_GATEWAY_ID, type: 'gateway', label: 'TrustEdge DNS' },
  { id: INFRA_POLICY_ID, type: 'policy', label: 'Policy gate' },
];

function mergeEdge(existing: NetworkMapEdge, incoming: NetworkMapEdge): NetworkMapEdge {
  return {
    ...existing,
    query_count: existing.query_count + incoming.query_count,
    blocked_count: existing.blocked_count + incoming.blocked_count,
  };
}

function upsertEdge(map: Map<string, NetworkMapEdge>, edge: NetworkMapEdge): NetworkMapEdge {
  const key = edgeKey(edge);
  const existing = map.get(key);
  if (existing) {
    const merged = mergeEdge(existing, edge);
    map.set(key, merged);
    return merged;
  }
  map.set(key, edge);
  return edge;
}

export interface ExpandedPathGraph {
  nodes: NetworkMapNode[];
  edges: NetworkMapEdge[];
}

/** Expand attribution graph with WireGuard → dnsmasq → policy hops (digital-twin path). */
export function expandToPathView(nodes: NetworkMapNode[], edges: NetworkMapEdge[]): ExpandedPathGraph {
  const nodeMap = new Map<string, NetworkMapNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }
  for (const infra of INFRA_NODES) {
    nodeMap.set(infra.id, infra);
  }

  const edgeMap = new Map<string, NetworkMapEdge>();
  let hasDnsFlow = false;

  for (const edge of edges) {
    if (edge.kind === 'foreground') {
      upsertEdge(edgeMap, edge);
      continue;
    }

    if (edge.kind !== 'dns' && edge.kind !== 'dns_direct') {
      continue;
    }

    hasDnsFlow = true;
    const egressSource = edge.kind === 'dns' ? edge.source : edge.source;
    upsertEdge(edgeMap, {
      source: egressSource,
      target: INFRA_TUNNEL_ID,
      kind: 'path_egress',
      query_count: edge.query_count,
      blocked_count: 0,
    });
    upsertEdge(edgeMap, {
      source: INFRA_POLICY_ID,
      target: edge.target,
      kind: 'path_forward',
      query_count: edge.query_count,
      blocked_count: edge.blocked_count,
    });
  }

  if (hasDnsFlow) {
    upsertEdge(edgeMap, {
      source: INFRA_TUNNEL_ID,
      target: INFRA_GATEWAY_ID,
      kind: 'path_tunnel',
      query_count: 0,
      blocked_count: 0,
    });
    upsertEdge(edgeMap, {
      source: INFRA_GATEWAY_ID,
      target: INFRA_POLICY_ID,
      kind: 'path_resolve',
      query_count: 0,
      blocked_count: 0,
    });
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values()),
  };
}
