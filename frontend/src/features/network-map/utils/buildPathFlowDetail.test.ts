import { NetworkMapEdge, NetworkMapNode } from '../types/networkMap';
import { buildPathFlowDetail, buildPathFlowDetailsForDomain } from './buildPathFlowDetail';

const nodes: NetworkMapNode[] = [
  { id: 'device:1', type: 'device', label: 'MacBook', client_ip: '10.8.0.5' },
  { id: 'app:google_chrome', type: 'app', label: 'Google Chrome' },
  { id: 'domain:google.com', type: 'domain', label: 'google.com', blocked: true },
];

const dnsEdge: NetworkMapEdge = {
  source: 'app:google_chrome',
  target: 'domain:google.com',
  kind: 'dns',
  query_count: 4,
  blocked_count: 4,
};

const foregroundEdge: NetworkMapEdge = {
  source: 'device:1',
  target: 'app:google_chrome',
  kind: 'foreground',
  query_count: 1,
  blocked_count: 0,
};

describe('buildPathFlowDetail', () => {
  it('builds step-by-step path for attributed dns flow', () => {
    const detail = buildPathFlowDetail(dnsEdge, nodes, [foregroundEdge, dnsEdge]);
    expect(detail).not.toBeNull();
    expect(detail?.deviceLabel).toBe('MacBook');
    expect(detail?.appLabel).toBe('Google Chrome');
    expect(detail?.blocked).toBe(true);
    expect(detail?.steps).toHaveLength(6);
    expect(detail?.steps[0].title).toBe('MacBook');
    expect(detail?.steps[4].status).toBe('blocked');
  });

  it('marks direct dns as unknown process', () => {
    const direct: NetworkMapEdge = {
      source: 'device:1',
      target: 'domain:google.com',
      kind: 'dns_direct',
      query_count: 1,
      blocked_count: 0,
    };
    const detail = buildPathFlowDetail(direct, nodes, [direct]);
    expect(detail?.appLabel).toBeUndefined();
    expect(detail?.steps[1].title).toBe('Unknown process');
  });
});

describe('buildPathFlowDetailsForDomain', () => {
  it('returns all flows targeting a domain', () => {
    const direct: NetworkMapEdge = {
      source: 'device:1',
      target: 'domain:google.com',
      kind: 'dns_direct',
      query_count: 1,
      blocked_count: 0,
    };
    const details = buildPathFlowDetailsForDomain('domain:google.com', nodes, [
      foregroundEdge,
      dnsEdge,
      direct,
    ]);
    expect(details).toHaveLength(2);
    expect(details[0].queryCount).toBeGreaterThanOrEqual(details[1].queryCount);
  });
});
