import { NetworkMapEdge, NetworkMapNode } from '../types/networkMap';
import { parseFlowNode, globalPortNodeId } from './flowLabels';

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

/**
 * Flow view: one Port node per protocol+number for the whole network (e.g. single TCP/443 hub).
 * domain/app → shared port → destination (IP or hostname).
 */
export function expandFlowToPortView(
  nodes: NetworkMapNode[],
  edges: NetworkMapEdge[],
): { nodes: NetworkMapNode[]; edges: NetworkMapEdge[] } {
  const nodeMap = new Map<string, NetworkMapNode>();
  for (const node of nodes) {
    if (node.type !== 'flow') {
      nodeMap.set(node.id, node);
    }
  }

  const outEdges: NetworkMapEdge[] = [];
  const edgeMap = new Map<string, NetworkMapEdge>();

  for (const edge of edges) {
    if (edge.kind !== 'dns_to_flow' && edge.kind !== 'flow_session') {
      addEdge(outEdges, edgeMap, edge.source, edge.target, edge.kind);
    }
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

    addEdge(outEdges, edgeMap, edge.source, pid, 'to_port');
    addEdge(outEdges, edgeMap, pid, flowNode.id, 'port_to_flow');
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges: outEdges,
  };
}
