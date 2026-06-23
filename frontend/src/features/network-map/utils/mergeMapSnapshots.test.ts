import { NetworkMapResponse } from '../types/networkMap';
import { mergeMapSnapshots } from './mergeMapSnapshots';

describe('mergeMapSnapshots', () => {
  const empty: NetworkMapResponse = {
    generated_at: '2026-01-01T00:00:00Z',
    minutes: 15,
    nodes: [],
    edges: [],
  };

  const live: NetworkMapResponse = {
    generated_at: '2026-01-01T00:00:00Z',
    minutes: 15,
    nodes: [
      { id: 'device:1', type: 'device', label: 'Mac', client_ip: '10.0.0.2', device_id: 1 },
      { id: 'domain:example.com', type: 'domain', label: 'example.com' },
    ],
    edges: [
      {
        source: 'device:1',
        target: 'domain:example.com',
        kind: 'dns_direct',
        query_count: 2,
        blocked_count: 0,
      },
    ],
  };

  it('keeps live graph when API returns empty', () => {
    const merged = mergeMapSnapshots(empty, live);
    expect(merged.nodes).toHaveLength(2);
    expect(merged.edges).toHaveLength(1);
  });

  it('merges API and live nodes', () => {
    const api: NetworkMapResponse = {
      ...empty,
      nodes: [{ id: 'device:1', type: 'device', label: 'Mac', client_ip: '10.0.0.2', device_id: 1 }],
      edges: [],
    };
    const merged = mergeMapSnapshots(api, live);
    expect(merged.nodes).toHaveLength(2);
    expect(merged.edges).toHaveLength(1);
  });

  it('returns API when live is empty', () => {
    const api: NetworkMapResponse = {
      ...empty,
      nodes: [{ id: 'device:1', type: 'device', label: 'Mac', device_id: 1 }],
      edges: [],
    };
    expect(mergeMapSnapshots(api, null)).toEqual(api);
  });
});
