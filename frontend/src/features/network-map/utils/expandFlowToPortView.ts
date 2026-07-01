import { NetworkMapEdge, NetworkMapNode } from '../types/networkMap';
import { INFRA_GATEWAY_ID } from './expandPathView';
import { parseFlowNode, globalPortNodeId } from './flowLabels';

export const FLOW_GATEWAY_NODE: NetworkMapNode = {
  id: INFRA_GATEWAY_ID,
  type: 'gateway',
  label: 'EC2 DNS',
};

function addEdge(
  edges: NetworkMapEdge[],
  edgeMap: Map<string, NetworkMapEdge>,
  source: string,
  target: string,
  kind: NetworkMapEdge['kind'],
) {
  const key = `${source}|${target}|${kind}`;
  const existing = edgeMap.get(key);
  if (existing) {
    edgeMap.set(key, { ...existing, query_count: existing.query_count + 1 });
    return;
  }
  const edge: NetworkMapEdge = {
    source,
    target,
    kind,
    query_count: 1,
    blocked_count: 0,
  };
  edgeMap.set(key, edge);
  edges.push(edge);
}

function linkUpstreamToGateway(
  edges: NetworkMapEdge[],
  edgeMap: Map<string, NetworkMapEdge>,
  allEdges: NetworkMapEdge[],
  domainId: string,
) {
  for (const upstream of allEdges) {
    if (upstream.target !== domainId) {
      continue;
    }
    if (upstream.kind === 'dns' || upstream.kind === 'dns_direct') {
      addEdge(edges, edgeMap, upstream.source, INFRA_GATEWAY_ID, 'flow_via_gateway');
    }
  }
}

/**
 * Flow view: device → app → EC2 DNS gateway → port hub → destination.
 * Per-domain nodes are collapsed into the single EC2 resolver (dnsmasq on gateway).
 */
export function expandFlowToPortView(
  nodes: NetworkMapNode[],
  edges: NetworkMapEdge[],
): { nodes: NetworkMapNode[]; edges: NetworkMapEdge[] } {
  const nodeMap = new Map<string, NetworkMapNode>();
  for (const node of nodes) {
    if (node.type !== 'flow' && node.type !== 'domain') {
      nodeMap.set(node.id, node);
    }
  }
  nodeMap.set(FLOW_GATEWAY_NODE.id, FLOW_GATEWAY_NODE);

  const outEdges: NetworkMapEdge[] = [];
  const edgeMap = new Map<string, NetworkMapEdge>();

  for (const edge of edges) {
    if (
      edge.kind === 'dns_to_flow' ||
      edge.kind === 'flow_session' ||
      edge.kind === 'dns' ||
      edge.kind === 'dns_direct'
    ) {
      continue;
    }
    addEdge(outEdges, edgeMap, edge.source, edge.target, edge.kind);
  }

  for (const edge of edges) {
    if (edge.kind !== 'dns_to_flow' && edge.kind !== 'flow_session') {
      continue;
    }
    const flowNode = nodes.find((n) => n.id === edge.target && n.type === 'flow');
    if (!flowNode) {
      continue;
    }
    const parsed = parseFlowNode(flowNode);
    if (!parsed) {
      continue;
    }

    const pid = globalPortNodeId(parsed.protocol, parsed.port);
    if (!nodeMap.has(pid)) {
      nodeMap.set(pid, {
        id: pid,
        type: 'port',
        label: String(parsed.port),
      });
    }

    nodeMap.set(flowNode.id, {
      ...flowNode,
      label: parsed.destination,
    });

    if (edge.kind === 'dns_to_flow') {
      linkUpstreamToGateway(outEdges, edgeMap, edges, edge.source);
      addEdge(outEdges, edgeMap, INFRA_GATEWAY_ID, pid, 'to_port');
    } else {
      addEdge(outEdges, edgeMap, edge.source, pid, 'to_port');
    }
    addEdge(outEdges, edgeMap, pid, flowNode.id, 'port_to_flow');
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges: outEdges,
  };
}
