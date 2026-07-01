import { NetworkMapEdge, NetworkMapLayoutMode, NetworkMapNode, PositionedNode } from '../types/networkMap';

const PAD_Y = 56;
const MIN_GAP = 44;

const COL_ATTRIBUTION = {
  device: 130,
  app: 380,
  domain: 640,
} as const;

const COL_PATH = {
  device: 80,
  app: 175,
  tunnel: 270,
  gateway: 365,
  policy: 460,
  domain: 555,
} as const;

const COL_FLOW = {
  device: 70,
  app: 180,
  domain: 290,
  port: 400,
  flow: 510,
} as const;

export const PATH_LAYOUT_WIDTH = 640;
export const ATTRIBUTION_LAYOUT_WIDTH = 720;
export const FLOW_LAYOUT_WIDTH = 580;

export interface NetworkMapLayout {
  nodes: PositionedNode[];
  edges: NetworkMapEdge[];
  width: number;
  height: number;
  mode: NetworkMapLayoutMode;
  columnGuides: Record<string, number>;
}

function spreadYs(count: number, centerY: number, gap: number): number[] {
  if (count <= 0) {
    return [];
  }
  if (count === 1) {
    return [centerY];
  }
  return Array.from({ length: count }, (_, index) => centerY + (index - (count - 1) / 2) * gap);
}

function parentKeyForDomain(domainId: string, edges: NetworkMapEdge[]): string {
  for (const edge of edges) {
    if (edge.target !== domainId) {
      continue;
    }
    if (
      edge.kind === 'dns' ||
      edge.kind === 'dns_direct' ||
      edge.kind === 'path_forward'
    ) {
      return edge.source;
    }
  }
  return '__orphan__';
}

function parentKeyForFlow(flowId: string, edges: NetworkMapEdge[]): string {
  for (const edge of edges) {
    if (edge.target !== flowId) {
      continue;
    }
    if (edge.kind === 'port_to_flow') {
      return edge.source;
    }
    if (edge.kind === 'dns_to_flow' || edge.kind === 'flow_session') {
      return edge.source;
    }
  }
  return '__orphan__';
}

function parentKeyForPort(portId: string, edges: NetworkMapEdge[]): string {
  for (const edge of edges) {
    if (edge.target === portId && edge.kind === 'to_port') {
      return edge.source;
    }
  }
  return '__orphan__';
}

function nextFreeY(preferred: number, assigned: number[], gap: number): number {
  let y = preferred;
  const minGap = gap * 0.85;
  for (;;) {
    let collision = false;
    for (let i = 0; i < assigned.length; i += 1) {
      if (Math.abs(assigned[i] - y) < minGap) {
        collision = true;
        break;
      }
    }
    if (!collision) {
      break;
    }
    y += minGap;
  }
  assigned.push(y);
  return y;
}

export function layoutNetworkMap(
  nodes: NetworkMapNode[],
  edges: NetworkMapEdge[],
  mode: NetworkMapLayoutMode = 'attribution',
): NetworkMapLayout {
  const columns =
    mode === 'path' ? COL_PATH : mode === 'flow' ? COL_FLOW : COL_ATTRIBUTION;
  const width =
    mode === 'path'
      ? PATH_LAYOUT_WIDTH
      : mode === 'flow'
        ? FLOW_LAYOUT_WIDTH
        : ATTRIBUTION_LAYOUT_WIDTH;

  const devices = nodes.filter((n) => n.type === 'device').sort((a, b) => a.label.localeCompare(b.label));
  const apps = nodes.filter((n) => n.type === 'app').sort((a, b) => a.label.localeCompare(b.label));
  const domains = nodes.filter((n) => n.type === 'domain').sort((a, b) => a.label.localeCompare(b.label));
  const flows = nodes.filter((n) => n.type === 'flow').sort((a, b) => a.label.localeCompare(b.label));
  const ports = nodes.filter((n) => n.type === 'port').sort((a, b) => Number(a.label) - Number(b.label));
  const infra = nodes.filter((n) => n.type === 'tunnel' || n.type === 'gateway' || n.type === 'policy');

  const domainGroups = new Map<string, NetworkMapNode[]>();
  for (const domain of domains) {
    const parent = parentKeyForDomain(domain.id, edges);
    const list = domainGroups.get(parent) ?? [];
    list.push(domain);
    domainGroups.set(parent, list);
  }

  const positioned = new Map<string, PositionedNode>();
  const deviceYs = spreadYs(devices.length, 220, MIN_GAP);
  devices.forEach((device, index) => {
    positioned.set(device.id, { ...device, x: columns.device, y: deviceYs[index] ?? 220 });
  });

  const appYs = spreadYs(apps.length, 220, MIN_GAP);
  apps.forEach((app, index) => {
    positioned.set(app.id, { ...app, x: columns.app, y: appYs[index] ?? 220 });
  });

  if (mode === 'path') {
    const spineY = 220;
    for (const node of infra) {
      const x =
        node.type === 'tunnel'
          ? columns.tunnel
          : node.type === 'gateway'
            ? columns.gateway
            : columns.policy;
      positioned.set(node.id, { ...node, x, y: spineY });
    }
  }

  const assignedDomainYs: number[] = [];

  for (const [parentId, group] of domainGroups.entries()) {
    const parent = positioned.get(parentId);
    const centerY = parent?.y ?? 220;
    const ys = spreadYs(group.length, centerY, MIN_GAP);
    group.forEach((domain, index) => {
      positioned.set(domain.id, {
        ...domain,
        x: columns.domain,
        y: nextFreeY(ys[index] ?? centerY, assignedDomainYs, MIN_GAP),
      });
    });
  }

  for (const domain of domains) {
    if (!positioned.has(domain.id)) {
      positioned.set(domain.id, {
        ...domain,
        x: columns.domain,
        y: nextFreeY(220, assignedDomainYs, MIN_GAP),
      });
    }
  }

  if (mode === 'flow') {
    const portGroups = new Map<string, NetworkMapNode[]>();
    for (const port of ports) {
      const parent = parentKeyForPort(port.id, edges);
      const list = portGroups.get(parent) ?? [];
      list.push(port);
      portGroups.set(parent, list);
    }
    const assignedPortYs: number[] = [];
    for (const [parentId, group] of portGroups.entries()) {
      const parent = positioned.get(parentId);
      const centerY = parent?.y ?? 220;
      const ys = spreadYs(group.length, centerY, MIN_GAP);
      group.forEach((port, index) => {
        positioned.set(port.id, {
          ...port,
          x: columns.port,
          y: nextFreeY(ys[index] ?? centerY, assignedPortYs, MIN_GAP),
        });
      });
    }
    for (const port of ports) {
      if (!positioned.has(port.id)) {
        positioned.set(port.id, {
          ...port,
          x: columns.port,
          y: nextFreeY(220, assignedPortYs, MIN_GAP),
        });
      }
    }

    const flowGroups = new Map<string, NetworkMapNode[]>();
    for (const flow of flows) {
      const parent = parentKeyForFlow(flow.id, edges);
      const list = flowGroups.get(parent) ?? [];
      list.push(flow);
      flowGroups.set(parent, list);
    }
    const assignedFlowYs: number[] = [];
    for (const [parentId, group] of flowGroups.entries()) {
      const parent = positioned.get(parentId);
      const centerY = parent?.y ?? 220;
      const ys = spreadYs(group.length, centerY, MIN_GAP);
      group.forEach((flow, index) => {
        positioned.set(flow.id, {
          ...flow,
          x: columns.flow,
          y: nextFreeY(ys[index] ?? centerY, assignedFlowYs, MIN_GAP),
        });
      });
    }
    for (const flow of flows) {
      if (!positioned.has(flow.id)) {
        positioned.set(flow.id, {
          ...flow,
          x: columns.flow,
          y: nextFreeY(220, assignedFlowYs, MIN_GAP),
        });
      }
    }
  }

  const allPositioned = Array.from(positioned.values());
  const maxY = allPositioned.reduce((max, node) => Math.max(max, node.y), PAD_Y);
  const minY = allPositioned.reduce((min, node) => Math.min(min, node.y), PAD_Y);
  const height = Math.max(320, maxY - minY + PAD_Y * 2);

  const yShift = PAD_Y - minY + 20;
  const shifted = allPositioned.map((node) => ({ ...node, y: node.y + yShift }));

  return {
    nodes: shifted,
    edges,
    width,
    height,
    mode,
    columnGuides: columns as Record<string, number>,
  };
}

/** Curved arc between node centers (world-map style). */
export function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy) || 1;
  const bend = Math.min(56, dist * 0.22);
  const nx = (-dy / dist) * bend;
  const ny = (dx / dist) * bend;
  return `M ${x1} ${y1} Q ${mx + nx} ${my + ny} ${x2} ${y2}`;
}

export function shortenLabel(label: string, max = 18): string {
  if (label.length <= max) {
    return label;
  }
  const parts = label.split('.');
  if (parts.length >= 2) {
    const tail = parts.slice(-2).join('.');
    if (tail.length <= max) {
      return tail;
    }
  }
  return `${label.slice(0, max - 1)}…`;
}

export function pathColumnLabels(mode: NetworkMapLayoutMode): { key: string; label: string }[] {
  if (mode === 'flow') {
    return [
      { key: 'device', label: 'Devices' },
      { key: 'app', label: 'Processes' },
      { key: 'domain', label: 'DNS names' },
      { key: 'port', label: 'Ports' },
      { key: 'flow', label: 'Destinations' },
    ];
  }
  if (mode === 'path') {
    return [
      { key: 'device', label: 'Devices' },
      { key: 'app', label: 'Processes' },
      { key: 'tunnel', label: 'WireGuard' },
      { key: 'gateway', label: 'DNS' },
      { key: 'policy', label: 'Policy' },
      { key: 'domain', label: 'Destinations' },
    ];
  }
  return [
    { key: 'device', label: 'Devices' },
    { key: 'app', label: 'Processes' },
    { key: 'domain', label: 'Destinations' },
  ];
}
