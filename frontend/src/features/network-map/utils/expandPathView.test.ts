import { NetworkMapEdge, NetworkMapNode } from '../types/networkMap';
import { expandToPathView, INFRA_GATEWAY_ID, INFRA_POLICY_ID, INFRA_TUNNEL_ID } from './expandPathView';

const nodes: NetworkMapNode[] = [
  { id: 'device:1', type: 'device', label: 'MacBook', client_ip: '10.8.0.5', device_id: 1 },
  { id: 'app:google_chrome', type: 'app', label: 'Google Chrome', app_slug: 'google_chrome' },
  { id: 'domain:github.com', type: 'domain', label: 'github.com' },
  { id: 'domain:google.com', type: 'domain', label: 'google.com', blocked: true },
];

const edges: NetworkMapEdge[] = [
  { source: 'device:1', target: 'app:google_chrome', kind: 'foreground', query_count: 1, blocked_count: 0 },
  { source: 'app:google_chrome', target: 'domain:github.com', kind: 'dns', query_count: 3, blocked_count: 0 },
  { source: 'app:google_chrome', target: 'domain:google.com', kind: 'dns', query_count: 2, blocked_count: 2 },
  { source: 'device:1', target: 'domain:github.com', kind: 'dns_direct', query_count: 1, blocked_count: 0 },
];

describe('expandToPathView', () => {
  it('adds infrastructure spine nodes and path edges', () => {
    const expanded = expandToPathView(nodes, edges);

    expect(expanded.nodes.some((n) => n.id === INFRA_TUNNEL_ID)).toBe(true);
    expect(expanded.nodes.some((n) => n.id === INFRA_GATEWAY_ID)).toBe(true);
    expect(expanded.nodes.some((n) => n.id === INFRA_POLICY_ID)).toBe(true);

    expect(expanded.edges.some((e) => e.kind === 'path_tunnel')).toBe(true);
    expect(expanded.edges.some((e) => e.kind === 'path_resolve')).toBe(true);
    expect(expanded.edges.some((e) => e.kind === 'path_egress' && e.source === 'app:google_chrome')).toBe(true);
    expect(expanded.edges.some((e) => e.kind === 'path_egress' && e.source === 'device:1')).toBe(true);
    expect(
      expanded.edges.filter((e) => e.kind === 'path_forward' && e.target === 'domain:github.com'),
    ).toHaveLength(1);
  });

  it('preserves foreground edges', () => {
    const expanded = expandToPathView(nodes, edges);
    expect(expanded.edges.some((e) => e.kind === 'foreground')).toBe(true);
  });

  it('returns original nodes when no dns flows exist', () => {
    const fgOnly: NetworkMapEdge[] = [
      { source: 'device:1', target: 'app:google_chrome', kind: 'foreground', query_count: 1, blocked_count: 0 },
    ];
    const expanded = expandToPathView(nodes, fgOnly);
    expect(expanded.edges.every((e) => e.kind === 'foreground')).toBe(true);
    expect(expanded.edges.some((e) => e.kind === 'path_tunnel')).toBe(false);
  });
});
