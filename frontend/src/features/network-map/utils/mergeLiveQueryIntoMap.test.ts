import { mergeLiveQueryIntoMap } from './mergeLiveQueryIntoMap';
import { NetworkMapResponse } from '../types/networkMap';

const emptyMap: NetworkMapResponse = {
  generated_at: '2026-06-29T12:00:00Z',
  minutes: 15,
  nodes: [],
  edges: [],
};

describe('mergeLiveQueryIntoMap', () => {
  it('groups subdomains under the same root domain node', () => {
    const ipToDevice = new Map([['10.0.0.2', { deviceId: 1, label: 'Mac' }]]);

    const afterFirst = mergeLiveQueryIntoMap(
      emptyMap,
      {
        timestamp: '2026-06-29T12:00:00Z',
        client_ip: '10.0.0.2',
        domain: 'www.google.com',
        blocked: false,
      },
      ipToDevice,
    );

    const afterSecond = mergeLiveQueryIntoMap(
      afterFirst,
      {
        timestamp: '2026-06-29T12:01:00Z',
        client_ip: '10.0.0.2',
        domain: 'mail.google.com',
        blocked: false,
      },
      ipToDevice,
    );

    const domainNodes = afterSecond.nodes.filter((n) => n.type === 'domain');
    expect(domainNodes).toHaveLength(1);
    expect(domainNodes[0].label).toBe('google.com');

    const directEdge = afterSecond.edges.find((e) => e.kind === 'dns_direct');
    expect(directEdge?.query_count).toBe(2);
  });

  it('groups attributed DNS edges by root domain', () => {
    const ipToDevice = new Map([['10.0.0.2', { deviceId: 1, label: 'Mac' }]]);

    const graph = mergeLiveQueryIntoMap(
      emptyMap,
      {
        timestamp: '2026-06-29T12:00:00Z',
        client_ip: '10.0.0.2',
        domain: 'www.zoom.us',
        blocked: false,
        attributed_app_slug: 'zoom',
        attributed_app_display_name: 'Zoom',
      },
      ipToDevice,
    );

    const merged = mergeLiveQueryIntoMap(
      graph,
      {
        timestamp: '2026-06-29T12:01:00Z',
        client_ip: '10.0.0.2',
        domain: 'meeting.zoom.us',
        blocked: false,
        attributed_app_slug: 'zoom',
        attributed_app_display_name: 'Zoom',
      },
      ipToDevice,
    );

    const domainNodes = merged.nodes.filter((n) => n.type === 'domain');
    expect(domainNodes).toHaveLength(1);
    expect(domainNodes[0].label).toBe('zoom.us');

    const dnsEdge = merged.edges.find((e) => e.kind === 'dns');
    expect(dnsEdge?.query_count).toBe(2);
  });
});
