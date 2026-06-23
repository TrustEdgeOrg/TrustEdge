import { NetworkMapEdge, NetworkMapNode, PositionedNode } from '../types/networkMap';

const COL_DEVICE = 90;
const COL_APP = 340;
const COL_DOMAIN = 620;
const ROW_HEIGHT = 76;
const TOP_PAD = 48;

export interface NetworkMapLayout {
  nodes: PositionedNode[];
  edges: NetworkMapEdge[];
  width: number;
  height: number;
}

export function layoutNetworkMap(
  nodes: NetworkMapNode[],
  edges: NetworkMapEdge[],
): NetworkMapLayout {
  const devices = nodes.filter((n) => n.type === 'device').sort((a, b) => a.label.localeCompare(b.label));
  const apps = nodes.filter((n) => n.type === 'app');
  const domains = nodes.filter((n) => n.type === 'domain');

  const deviceY = new Map<string, number>();
  devices.forEach((d, index) => {
    deviceY.set(d.id, TOP_PAD + index * ROW_HEIGHT);
  });

  const appDeviceLinks = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind !== 'foreground') {
      continue;
    }
    const fromDevice = devices.some((d) => d.id === edge.source);
    const toApp = apps.some((a) => a.id === edge.target);
    if (fromDevice && toApp) {
      const list = appDeviceLinks.get(edge.target) ?? [];
      list.push(edge.source);
      appDeviceLinks.set(edge.target, list);
    }
  }

  const appY = new Map<string, number>();
  apps.forEach((app, index) => {
    const linked = appDeviceLinks.get(app.id) ?? [];
    if (linked.length === 0) {
      appY.set(app.id, TOP_PAD + index * ROW_HEIGHT);
      return;
    }
    const ys = linked.map((id) => deviceY.get(id) ?? TOP_PAD);
    appY.set(app.id, ys.reduce((sum, y) => sum + y, 0) / ys.length);
  });

  const domainAppLinks = new Map<string, string>();
  for (const edge of edges) {
    if (edge.kind !== 'dns') {
      continue;
    }
    domainAppLinks.set(edge.target, edge.source);
  }

  const domainsByApp = new Map<string, NetworkMapNode[]>();
  for (const domain of domains) {
    const appId = domainAppLinks.get(domain.id);
    if (!appId) {
      continue;
    }
    const list = domainsByApp.get(appId) ?? [];
    list.push(domain);
    domainsByApp.set(appId, list);
  }

  const domainY = new Map<string, number>();
  for (const [appId, group] of domainsByApp.entries()) {
    const center = appY.get(appId) ?? TOP_PAD;
    const spread = Math.max(ROW_HEIGHT * 0.55, 28);
    const sorted = [...group].sort((a, b) => a.label.localeCompare(b.label));
    sorted.forEach((domain, index) => {
      const offset = (index - (sorted.length - 1) / 2) * spread;
      domainY.set(domain.id, center + offset);
    });
  }

  const positioned: PositionedNode[] = nodes.map((node) => {
    if (node.type === 'device') {
      return { ...node, x: COL_DEVICE, y: deviceY.get(node.id) ?? TOP_PAD };
    }
    if (node.type === 'app') {
      return { ...node, x: COL_APP, y: appY.get(node.id) ?? TOP_PAD };
    }
    return { ...node, x: COL_DOMAIN, y: domainY.get(node.id) ?? TOP_PAD };
  });

  const maxY = positioned.reduce((max, node) => Math.max(max, node.y), TOP_PAD);
  const height = Math.max(280, maxY + TOP_PAD);
  const width = 760;

  return { nodes: positioned, edges, width, height };
}

export function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}
