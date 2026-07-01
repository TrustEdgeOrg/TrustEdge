import { expandFlowToPortView } from './expandFlowToPortView';
import { NetworkMapEdge, NetworkMapNode } from '../types/networkMap';

describe('expandFlowToPortView', () => {
  it('inserts port column between domain and destination', () => {
    const nodes: NetworkMapNode[] = [
      { id: 'domain:github.com', type: 'domain', label: 'github.com' },
      { id: 'flow:tcp:140.82.112.26:443', type: 'flow', label: 'TCP/443 github.com' },
    ];
    const edges: NetworkMapEdge[] = [
      {
        source: 'domain:github.com',
        target: 'flow:tcp:140.82.112.26:443',
        kind: 'dns_to_flow',
        query_count: 1,
        blocked_count: 0,
      },
    ];

    const expanded = expandFlowToPortView(nodes, edges);
    const port = expanded.nodes.find((n) => n.type === 'port');
    const dest = expanded.nodes.find((n) => n.type === 'flow');

    expect(port?.label).toBe('443');
    expect(dest?.label).toBe('github.com');
    expect(expanded.edges.some((e) => e.kind === 'to_port' && e.target === port?.id)).toBe(true);
    expect(expanded.edges.some((e) => e.kind === 'port_to_flow' && e.source === port?.id)).toBe(true);
  });
});
