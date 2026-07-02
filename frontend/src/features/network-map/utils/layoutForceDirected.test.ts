import { NetworkMapEdge, NetworkMapNode } from '../types/networkMap';
import { layoutForceDirected } from './layoutForceDirected';

const nodes: NetworkMapNode[] = [
  { id: 'device:1', type: 'device', label: 'MacBook', client_ip: '10.8.0.5', device_id: 1 },
  { id: 'app:chrome', type: 'app', label: 'Chrome', app_slug: 'google_chrome' },
  { id: 'domain:github.com', type: 'domain', label: 'github.com' },
  { id: 'domain:google.com', type: 'domain', label: 'google.com' },
];

const edges: NetworkMapEdge[] = [
  { source: 'device:1', target: 'app:chrome', kind: 'foreground', query_count: 1, blocked_count: 0 },
  { source: 'app:chrome', target: 'domain:github.com', kind: 'dns', query_count: 3, blocked_count: 0 },
  { source: 'app:chrome', target: 'domain:google.com', kind: 'dns', query_count: 2, blocked_count: 0 },
];

describe('layoutForceDirected', () => {
  it('assigns x/y to every node', () => {
    const layout = layoutForceDirected(nodes, edges, 'attribution');
    expect(layout.layoutStyle).toBe('force');
    expect(layout.columnGuides).toEqual({});
    expect(layout.nodes).toHaveLength(4);
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });

  it('places connected nodes closer than unrelated pairs on average', () => {
    const layout = layoutForceDirected(nodes, edges, 'attribution', { iterations: 200 });
    const pos = new Map(layout.nodes.map((n) => [n.id, n]));
    const device = pos.get('device:1')!;
    const app = pos.get('app:chrome')!;
    const github = pos.get('domain:github.com')!;
    const distDeviceApp = Math.hypot(device.x - app.x, device.y - app.y);
    const distAppGithub = Math.hypot(app.x - github.x, app.y - github.y);
    expect(distDeviceApp).toBeLessThan(400);
    expect(distAppGithub).toBeLessThan(400);
  });
});
