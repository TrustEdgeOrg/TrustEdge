import { NetworkMapEdge, NetworkMapNode, PositionedNode } from '../types/networkMap';

const PAD_Y = 56;
const MIN_GAP = 44;
const COL_DEVICE = 130;
const COL_APP = 380;
const COL_DOMAIN = 640;

export interface NetworkMapLayout {
  nodes: PositionedNode[];
  edges: NetworkMapEdge[];
  width: number;
  height: number;
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

function parentKeyForDomain(
  domainId: string,
  edges: NetworkMapEdge[],
): string {
  for (const edge of edges) {
    if (edge.target !== domainId) {
      continue;
    }
    if (edge.kind === 'dns') {
      return edge.source;
    }
    if (edge.kind === 'dns_direct') {
      return edge.source;
    }
  }
  return '__orphan__';
}

export function layoutNetworkMap(
  nodes: NetworkMapNode[],
  edges: NetworkMapEdge[],
): NetworkMapLayout {
  const devices = nodes.filter((n) => n.type === 'device').sort((a, b) => a.label.localeCompare(b.label));
  const apps = nodes.filter((n) => n.type === 'app').sort((a, b) => a.label.localeCompare(b.label));
  const domains = nodes.filter((n) => n.type === 'domain').sort((a, b) => a.label.localeCompare(b.label));

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
    positioned.set(device.id, { ...device, x: COL_DEVICE, y: deviceYs[index] ?? 220 });
  });

  const appYs = spreadYs(apps.length, 220, MIN_GAP);
  apps.forEach((app, index) => {
    positioned.set(app.id, { ...app, x: COL_APP, y: appYs[index] ?? 220 });
  });

  const assignedDomainYs: number[] = [];
  const takeY = (preferred: number): number => {
    let y = preferred;
    while (assignedDomainYs.some((existing) => Math.abs(existing - y) < MIN_GAP * 0.85)) {
      y += MIN_GAP * 0.85;
    }
    assignedDomainYs.push(y);
    return y;
  };

  for (const [parentId, group] of domainGroups.entries()) {
    const parent = positioned.get(parentId);
    const centerY = parent?.y ?? 220;
    const ys = spreadYs(group.length, centerY, MIN_GAP);
    group.forEach((domain, index) => {
      positioned.set(domain.id, {
        ...domain,
        x: COL_DOMAIN,
        y: takeY(ys[index] ?? centerY),
      });
    });
  }

  for (const domain of domains) {
    if (!positioned.has(domain.id)) {
      positioned.set(domain.id, { ...domain, x: COL_DOMAIN, y: takeY(220) });
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
    width: 720,
    height,
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
