import { NetworkMapEdge, NetworkMapNode } from '../types/networkMap';
import { edgeKey } from './whatIfSimulation';

export type PathFlowStepStatus = 'ok' | 'blocked' | 'warning' | 'neutral';

export interface PathFlowStep {
  title: string;
  detail: string;
  status: PathFlowStepStatus;
}

export interface PathFlowDetail {
  flowKey: string;
  domainLabel: string;
  deviceLabel: string;
  clientIp?: string | null;
  appLabel?: string | null;
  blocked: boolean;
  queryCount: number;
  blockedCount: number;
  steps: PathFlowStep[];
}

function findDeviceForSource(
  sourceId: string,
  nodes: NetworkMapNode[],
  edges: NetworkMapEdge[],
): NetworkMapNode | undefined {
  const sourceNode = nodes.find((n) => n.id === sourceId);
  if (!sourceNode) {
    return undefined;
  }
  if (sourceNode.type === 'device') {
    return sourceNode;
  }
  if (sourceNode.type === 'app') {
    const fg = edges.find((e) => e.kind === 'foreground' && e.target === sourceId);
    if (fg) {
      return nodes.find((n) => n.id === fg.source);
    }
  }
  return undefined;
}

export function buildPathFlowDetail(
  flowEdge: NetworkMapEdge,
  nodes: NetworkMapNode[],
  edges: NetworkMapEdge[],
): PathFlowDetail | null {
  if (flowEdge.kind !== 'dns' && flowEdge.kind !== 'dns_direct') {
    return null;
  }

  const domainNode = nodes.find((n) => n.id === flowEdge.target);
  const appNode = flowEdge.kind === 'dns' ? nodes.find((n) => n.id === flowEdge.source) : undefined;
  const deviceNode = findDeviceForSource(flowEdge.source, nodes, edges);
  const blocked = flowEdge.blocked_count > 0;
  const queryCount = flowEdge.query_count;
  const blockedCount = flowEdge.blocked_count;

  const steps: PathFlowStep[] = [
    {
      title: deviceNode?.label ?? 'Endpoint',
      detail: deviceNode?.client_ip
        ? `DNS query from ${deviceNode.client_ip} via VPN client`
        : 'DNS query leaves endpoint through TrustEdge VPN',
      status: 'neutral',
    },
  ];

  if (appNode) {
    steps.push({
      title: appNode.label,
      detail: 'Foreground process attributed at query time',
      status: 'neutral',
    });
  } else {
    steps.push({
      title: 'Unknown process',
      detail: 'No foreground app context — direct device DNS',
      status: 'warning',
    });
  }

  steps.push(
    {
      title: 'WireGuard tunnel',
      detail: 'Encrypted egress from endpoint to TrustEdge gateway',
      status: 'ok',
    },
    {
      title: 'TrustEdge DNS (dnsmasq)',
      detail: 'Query received on EC2 gateway resolver',
      status: 'ok',
    },
    {
      title: blocked ? 'Policy gate — BLOCKED' : 'Policy gate — ALLOWED',
      detail: blocked
        ? `${blockedCount} of ${queryCount} quer${queryCount === 1 ? 'y' : 'ies'} denied by policy`
        : 'Forwarded to upstream resolver',
      status: blocked ? 'blocked' : 'ok',
    },
    {
      title: domainNode?.label ?? flowEdge.target,
      detail: blocked
        ? 'Destination unreachable — response not returned to client'
        : `${queryCount} DNS quer${queryCount === 1 ? 'y' : 'ies'} observed`,
      status: blocked ? 'blocked' : 'ok',
    },
  );

  return {
    flowKey: edgeKey(flowEdge),
    domainLabel: domainNode?.label ?? flowEdge.target,
    deviceLabel: deviceNode?.label ?? 'Unknown device',
    clientIp: deviceNode?.client_ip,
    appLabel: appNode?.label,
    blocked,
    queryCount,
    blockedCount,
    steps,
  };
}

export function buildPathFlowDetailsForDomain(
  domainId: string,
  nodes: NetworkMapNode[],
  edges: NetworkMapEdge[],
): PathFlowDetail[] {
  return edges
    .filter(
      (edge) =>
        edge.target === domainId && (edge.kind === 'dns' || edge.kind === 'dns_direct'),
    )
    .map((edge) => buildPathFlowDetail(edge, nodes, edges))
    .filter((detail): detail is PathFlowDetail => detail !== null)
    .sort((a, b) => b.queryCount - a.queryCount);
}

export function findDnsFlowEdgeForPathForward(
  pathForwardEdge: NetworkMapEdge,
  originalEdges: NetworkMapEdge[],
): NetworkMapEdge[] {
  if (pathForwardEdge.kind !== 'path_forward') {
    return [];
  }
  return originalEdges.filter(
    (edge) =>
      edge.target === pathForwardEdge.target &&
      (edge.kind === 'dns' || edge.kind === 'dns_direct'),
  );
}
