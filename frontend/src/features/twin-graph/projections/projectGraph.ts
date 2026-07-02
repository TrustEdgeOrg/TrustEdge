import { NetworkMapEdge, NetworkMapNode, NetworkMapResponse } from '../../network-map/types/networkMap';
import { globalPortNodeId } from '../../network-map/utils/flowLabels';
import { edgeKey } from '../../network-map/utils/whatIfSimulation';
import { TwinGraphIndex } from '../graph/TwinGraphIndex';
import { TwinEdge, TwinGraphSnapshot, TwinNode } from '../types/twinGraph';

export type TwinProjectionMode = 'attribution' | 'path' | 'flow';

const WIREGUARD_ID = 'infra:wireguard';
const DNS_RESOLVER_ID = 'infra:dns_resolver';

const OBSERVED_RELATION_TO_KIND: Partial<Record<TwinEdge['relation'], NetworkMapEdge['kind']>> = {
  runs: 'foreground',
  queries: 'dns',
  queries_direct: 'dns_direct',
  correlates: 'dns_to_flow',
  opens: 'flow_session',
  opens_direct: 'flow_session',
};

function edgeCounts(edge: TwinEdge): Pick<NetworkMapEdge, 'query_count' | 'blocked_count'> {
  const blocked = Number(edge.properties.blocked_count ?? 0);
  return {
    query_count: Math.max(1, Math.round(edge.weight)),
    blocked_count: Number.isFinite(blocked) ? blocked : 0,
  };
}

function twinDeviceToMap(node: TwinNode): NetworkMapNode {
  return {
    id: node.id,
    type: 'device',
    label: node.label,
    client_ip: (node.properties.client_ip as string) ?? null,
    device_id: (node.properties.device_id as number) ?? null,
    fresh: node.properties.fresh as boolean | undefined,
    blocked: node.properties.blocked as boolean | undefined,
  };
}

function twinAppToMap(node: TwinNode): NetworkMapNode {
  return {
    id: node.id,
    type: 'app',
    label: node.label,
    app_slug: (node.properties.slug as string) ?? (node.properties.app_slug as string) ?? null,
  };
}

function twinDomainToMap(node: TwinNode): NetworkMapNode {
  return {
    id: node.id,
    type: 'domain',
    label: node.label,
    blocked: node.properties.blocked as boolean | undefined,
  };
}

function twinInfraToMap(node: TwinNode): NetworkMapNode | null {
  const kind = String(node.properties.kind ?? '');
  if (kind === 'wireguard') {
    return { id: node.id, type: 'tunnel', label: node.label };
  }
  if (kind === 'dns_resolver') {
    return { id: node.id, type: 'gateway', label: 'EC2 DNS' };
  }
  if (kind === 'ec2_gateway') {
    return null;
  }
  return { id: node.id, type: 'gateway', label: node.label };
}

function twinPolicyProfileToMap(node: TwinNode): NetworkMapNode {
  return { id: node.id, type: 'policy', label: node.label };
}

function twinFlowSessionToMap(node: TwinNode, destinationLabel: string): NetworkMapNode {
  const protocol = String(node.properties.protocol ?? 'tcp');
  const port = Number(node.properties.dest_port ?? 0);
  return {
    id: node.id,
    type: 'flow',
    label: destinationLabel || `${protocol.toUpperCase()}/${port} → ${node.properties.dest_ip ?? ''}`,
  };
}

function upsertMapEdge(map: Map<string, NetworkMapEdge>, edge: NetworkMapEdge): void {
  const key = edgeKey(edge);
  const existing = map.get(key);
  if (!existing) {
    map.set(key, edge);
    return;
  }
  map.set(key, {
    ...existing,
    query_count: existing.query_count + edge.query_count,
    blocked_count: existing.blocked_count + edge.blocked_count,
  });
}

function policyProfileForSource(index: TwinGraphIndex, sourceId: string): string | null {
  let deviceId = sourceId;
  if (sourceId.startsWith('app:')) {
    const runEdge = [...index.edges.values()].find(
      (edge) => edge.relation === 'runs' && edge.target_id === sourceId,
    );
    deviceId = runEdge?.source_id ?? sourceId;
  }
  if (!deviceId.startsWith('device:')) {
    return null;
  }
  const assigned = index.neighbors(deviceId, {
    direction: 'out',
    relations: new Set(['assigned']),
    layers: new Set(['desired']),
  })[0];
  return assigned?.target_id ?? null;
}

/** Project canonical twin graph to attribution view (device → app → domain). */
export function projectAttributionGraph(
  snapshot: TwinGraphSnapshot,
  override?: NetworkMapResponse | null,
): NetworkMapResponse {
  if (override) {
    return override;
  }

  const nodeMap = new Map<string, NetworkMapNode>();
  const edgeMap = new Map<string, NetworkMapEdge>();

  for (const node of snapshot.nodes) {
    if (node.layer !== 'observed') {
      continue;
    }
    if (node.entity_type === 'device') {
      nodeMap.set(node.id, twinDeviceToMap(node));
    } else if (node.entity_type === 'app') {
      nodeMap.set(node.id, twinAppToMap(node));
    } else if (node.entity_type === 'domain') {
      nodeMap.set(node.id, twinDomainToMap(node));
    }
  }

  for (const edge of snapshot.edges) {
    if (edge.layer !== 'observed') {
      continue;
    }
    const kind = OBSERVED_RELATION_TO_KIND[edge.relation];
    if (!kind || !nodeMap.has(edge.source_id) || !nodeMap.has(edge.target_id)) {
      continue;
    }
    upsertMapEdge(edgeMap, {
      source: edge.source_id,
      target: edge.target_id,
      kind,
      ...edgeCounts(edge),
    });
  }

  return {
    generated_at: snapshot.generated_at,
    minutes: snapshot.window_minutes,
    nodes: [...nodeMap.values()],
    edges: [...edgeMap.values()],
  };
}

/** Project twin graph to path view using infra + policy nodes from the canonical graph. */
export function projectPathGraph(
  snapshot: TwinGraphSnapshot,
  attribution: NetworkMapResponse,
): NetworkMapResponse {
  const index = new TwinGraphIndex(snapshot);
  const nodeMap = new Map<string, NetworkMapNode>();
  const edgeMap = new Map<string, NetworkMapEdge>();

  for (const node of attribution.nodes) {
    nodeMap.set(node.id, node);
  }

  for (const node of snapshot.nodes) {
    if (node.entity_type === 'infra_component') {
      const mapped = twinInfraToMap(node);
      if (mapped) {
        nodeMap.set(mapped.id, mapped);
      }
    }
    if (node.entity_type === 'policy_profile') {
      nodeMap.set(node.id, twinPolicyProfileToMap(node));
    }
  }

  for (const edge of attribution.edges) {
    if (edge.kind === 'foreground') {
      upsertMapEdge(edgeMap, edge);
    }
  }

  let hasDnsFlow = false;
  for (const edge of attribution.edges) {
    if (edge.kind !== 'dns' && edge.kind !== 'dns_direct') {
      continue;
    }
    hasDnsFlow = true;
    const policyId =
      policyProfileForSource(index, edge.source) ??
      [...nodeMap.values()].find((n) => n.type === 'policy')?.id;
    upsertMapEdge(edgeMap, {
      source: edge.source,
      target: WIREGUARD_ID,
      kind: 'path_egress',
      query_count: edge.query_count,
      blocked_count: 0,
    });
    if (policyId) {
      upsertMapEdge(edgeMap, {
        source: policyId,
        target: edge.target,
        kind: 'path_forward',
        query_count: edge.query_count,
        blocked_count: edge.blocked_count,
      });
    }
  }

  if (hasDnsFlow && nodeMap.has(WIREGUARD_ID) && nodeMap.has(DNS_RESOLVER_ID)) {
    upsertMapEdge(edgeMap, {
      source: WIREGUARD_ID,
      target: DNS_RESOLVER_ID,
      kind: 'path_tunnel',
      query_count: 0,
      blocked_count: 0,
    });
    const policyNode = [...nodeMap.values()].find((n) => n.type === 'policy');
    if (policyNode) {
      upsertMapEdge(edgeMap, {
        source: DNS_RESOLVER_ID,
        target: policyNode.id,
        kind: 'path_resolve',
        query_count: 0,
        blocked_count: 0,
      });
    }
  }

  return {
    generated_at: snapshot.generated_at,
    minutes: snapshot.window_minutes,
    nodes: [...nodeMap.values()],
    edges: [...edgeMap.values()],
  };
}

/** Project twin graph to flow view (device → app → EC2 DNS → port → destination). */
export function projectFlowGraph(snapshot: TwinGraphSnapshot): NetworkMapResponse {
  const index = new TwinGraphIndex(snapshot);
  const nodeMap = new Map<string, NetworkMapNode>();
  const edgeMap = new Map<string, NetworkMapEdge>();

  for (const node of snapshot.nodes) {
    if (node.entity_type === 'device') {
      nodeMap.set(node.id, twinDeviceToMap(node));
    }
    if (node.entity_type === 'app') {
      nodeMap.set(node.id, twinAppToMap(node));
    }
    if (node.entity_type === 'infra_component' && node.properties.kind === 'dns_resolver') {
      nodeMap.set(node.id, { id: node.id, type: 'gateway', label: 'EC2 DNS' });
    }
  }

  const destLabelByFlow = new Map<string, string>();
  for (const edge of snapshot.edges) {
    if (edge.relation !== 'destinates') {
      continue;
    }
    const ipNode = index.nodes.get(edge.target_id);
    if (ipNode) {
      destLabelByFlow.set(edge.source_id, ipNode.label);
    }
  }

  for (const node of snapshot.nodes) {
    if (node.entity_type !== 'flow_session') {
      continue;
    }
    const destination = destLabelByFlow.get(node.id) ?? String(node.properties.dest_ip ?? node.label);
    nodeMap.set(node.id, twinFlowSessionToMap(node, destination));

    const serviceEdge = snapshot.edges.find(
      (edge) => edge.relation === 'uses_service' && edge.source_id === node.id,
    );
    if (!serviceEdge) {
      continue;
    }
    const l4Node = index.nodes.get(serviceEdge.target_id);
    if (!l4Node) {
      continue;
    }
    const protocol = String(l4Node.properties.protocol ?? 'tcp');
    const port = Number(l4Node.properties.port ?? 0);
    const portId = globalPortNodeId(protocol, port);
    nodeMap.set(portId, { id: portId, type: 'port', label: String(port) });
  }

  for (const edge of snapshot.edges) {
    if (edge.relation === 'runs') {
      upsertMapEdge(edgeMap, {
        source: edge.source_id,
        target: edge.target_id,
        kind: 'foreground',
        ...edgeCounts(edge),
      });
    }
  }

  for (const edge of snapshot.edges) {
    if (edge.relation !== 'opens' && edge.relation !== 'opens_direct' && edge.relation !== 'correlates') {
      continue;
    }
    const flowId = edge.target_id;
    const flowNode = index.nodes.get(flowId);
    if (!flowNode || flowNode.entity_type !== 'flow_session') {
      continue;
    }
    const serviceEdge = snapshot.edges.find(
      (item) => item.relation === 'uses_service' && item.source_id === flowId,
    );
    const l4Node = serviceEdge ? index.nodes.get(serviceEdge.target_id) : null;
    if (!l4Node) {
      continue;
    }
    const protocol = String(l4Node.properties.protocol ?? 'tcp');
    const port = Number(l4Node.properties.port ?? 0);
    const portId = globalPortNodeId(protocol, port);

    if (edge.relation === 'correlates') {
      const upstream = snapshot.edges.filter(
        (item) =>
          (item.relation === 'queries' || item.relation === 'queries_direct') &&
          item.target_id === edge.source_id,
      );
      for (const dnsEdge of upstream) {
        upsertMapEdge(edgeMap, {
          source: dnsEdge.source_id,
          target: DNS_RESOLVER_ID,
          kind: 'flow_via_gateway',
          ...edgeCounts(dnsEdge),
        });
      }
      upsertMapEdge(edgeMap, {
        source: DNS_RESOLVER_ID,
        target: portId,
        kind: 'to_port',
        ...edgeCounts(edge),
      });
    } else {
      upsertMapEdge(edgeMap, {
        source: edge.source_id,
        target: portId,
        kind: 'to_port',
        ...edgeCounts(edge),
      });
    }

    upsertMapEdge(edgeMap, {
      source: portId,
      target: flowId,
      kind: 'port_to_flow',
      ...edgeCounts(edge),
    });
  }

  return {
    generated_at: snapshot.generated_at,
    minutes: snapshot.window_minutes,
    nodes: [...nodeMap.values()],
    edges: [...edgeMap.values()],
  };
}

export function projectTwinGraph(
  snapshot: TwinGraphSnapshot,
  mode: TwinProjectionMode,
  attributionOverride?: NetworkMapResponse | null,
): NetworkMapResponse {
  const attribution = projectAttributionGraph(snapshot, attributionOverride);
  if (mode === 'attribution') {
    return attribution;
  }
  if (mode === 'path') {
    return projectPathGraph(snapshot, attribution);
  }
  return projectFlowGraph(snapshot);
}
