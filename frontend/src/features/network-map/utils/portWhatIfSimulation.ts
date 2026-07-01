import { NetworkMapEdge, NetworkMapNode } from '../types/networkMap';
import { edgeKey } from './whatIfSimulation';

export interface PortWhatIfSimulationResult {
  disabledPortIds: Set<string>;
  disabledEdgeKeys: Set<string>;
  simulatedBlockedFlowIds: Set<string>;
  affectedConnectionCount: number;
}

export function computePortWhatIfSimulation(
  nodes: NetworkMapNode[],
  edges: NetworkMapEdge[],
  disabledPortNumbers: Set<number>,
): PortWhatIfSimulationResult {
  const disabledPortIds = new Set(
    nodes
      .filter((n) => n.type === 'port' && disabledPortNumbers.has(Number(n.label)))
      .map((n) => n.id),
  );

  const empty: PortWhatIfSimulationResult = {
    disabledPortIds,
    disabledEdgeKeys: new Set(),
    simulatedBlockedFlowIds: new Set(),
    affectedConnectionCount: 0,
  };

  if (disabledPortNumbers.size === 0) {
    return empty;
  }

  const disabledEdgeKeys = new Set<string>();
  const simulatedBlockedFlowIds = new Set<string>();
  let affectedConnectionCount = 0;

  for (const edge of edges) {
    if (edge.kind === 'to_port' && disabledPortIds.has(edge.target)) {
      disabledEdgeKeys.add(edgeKey(edge));
    }
    if (edge.kind === 'port_to_flow' && disabledPortIds.has(edge.source)) {
      disabledEdgeKeys.add(edgeKey(edge));
      simulatedBlockedFlowIds.add(edge.target);
      affectedConnectionCount += edge.query_count;
    }
  }

  return {
    disabledPortIds,
    disabledEdgeKeys,
    simulatedBlockedFlowIds,
    affectedConnectionCount,
  };
}

export function toggleDisabledPortNumber(current: Set<number>, port: number): Set<number> {
  const next = new Set(current);
  if (next.has(port)) {
    next.delete(port);
  } else {
    next.add(port);
  }
  return next;
}

export function listActivePortNumbers(nodes: NetworkMapNode[]): number[] {
  const ports = new Set<number>();
  for (const node of nodes) {
    if (node.type === 'port') {
      const num = Number(node.label);
      if (Number.isFinite(num)) {
        ports.add(num);
      }
    }
  }
  return [...ports].sort((a, b) => a - b);
}
