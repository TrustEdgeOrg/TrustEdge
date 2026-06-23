import { NetworkMapEdge, NetworkMapResponse } from '../types/networkMap';

function edgeKey(edge: NetworkMapEdge): string {
  return `${edge.source}|${edge.target}|${edge.kind}`;
}

/** Keep live WebSocket graph when API poll returns fewer rows (allowed DNS is often WS-only). */
export function mergeMapSnapshots(
  api: NetworkMapResponse,
  live: NetworkMapResponse | null,
): NetworkMapResponse {
  if (!live || (live.nodes.length === 0 && live.edges.length === 0)) {
    return api;
  }
  if (api.nodes.length === 0 && api.edges.length === 0) {
    return { ...live, generated_at: api.generated_at, minutes: api.minutes };
  }

  const nodes = new Map(api.nodes.map((n) => [n.id, n]));
  for (const node of live.nodes) {
    const existing = nodes.get(node.id);
    if (!existing) {
      nodes.set(node.id, node);
      continue;
    }
    if (node.fresh && !existing.fresh) {
      nodes.set(node.id, { ...existing, fresh: true });
    }
  }

  const edges = new Map(api.edges.map((e) => [edgeKey(e), e]));
  for (const edge of live.edges) {
    const key = edgeKey(edge);
    const existing = edges.get(key);
    if (!existing) {
      edges.set(key, edge);
      continue;
    }
    edges.set(key, {
      ...existing,
      query_count: Math.max(existing.query_count, edge.query_count),
      blocked_count: Math.max(existing.blocked_count, edge.blocked_count),
    });
  }

  return {
    generated_at: api.generated_at,
    minutes: api.minutes,
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  };
}
