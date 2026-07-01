import { expandFlowToPortView, FLOW_GATEWAY_NODE } from './expandFlowToPortView';
import { INFRA_GATEWAY_ID } from './expandPathView';
import { NetworkMapEdge, NetworkMapNode } from '../types/networkMap';

describe('expandFlowToPortView', () => {
  it('routes DNS-resolved flows through EC2 gateway instead of per-domain nodes', () => {
    const nodes: NetworkMapNode[] = [
      { id: 'app:chrome', type: 'app', label: 'Chrome' },
      { id: 'domain:github.com', type: 'domain', label: 'github.com' },
      { id: 'flow:tcp:140.82.112.26:443', type: 'flow', label: 'TCP/443 github.com' },
    ];
    const edges: NetworkMapEdge[] = [
      {
        source: 'app:chrome',
        target: 'domain:github.com',
        kind: 'dns',
        query_count: 1,
        blocked_count: 0,
      },
      {
        source: 'domain:github.com',
        target: 'flow:tcp:140.82.112.26:443',
        kind: 'dns_to_flow',
        query_count: 1,
        blocked_count: 0,
      },
    ];

    const expanded = expandFlowToPortView(nodes, edges);

    expect(expanded.nodes.find((n) => n.type === 'domain')).toBeUndefined();
    expect(expanded.nodes.find((n) => n.id === INFRA_GATEWAY_ID)).toEqual(FLOW_GATEWAY_NODE);
    expect(expanded.edges.some((e) => e.kind === 'flow_via_gateway' && e.target === INFRA_GATEWAY_ID)).toBe(
      true,
    );
    expect(expanded.edges.some((e) => e.kind === 'to_port' && e.source === INFRA_GATEWAY_ID)).toBe(true);
  });

  it('merges multiple domains into one port hub via EC2', () => {
    const nodes: NetworkMapNode[] = [
      { id: 'domain:github.com', type: 'domain', label: 'github.com' },
      { id: 'domain:google.com', type: 'domain', label: 'google.com' },
      { id: 'flow:tcp:140.82.112.26:443', type: 'flow', label: 'TCP/443 github.com' },
      { id: 'flow:tcp:142.250.80.46:443', type: 'flow', label: 'TCP/443 google.com' },
    ];
    const edges: NetworkMapEdge[] = [
      {
        source: 'domain:github.com',
        target: 'flow:tcp:140.82.112.26:443',
        kind: 'dns_to_flow',
        query_count: 1,
        blocked_count: 0,
      },
      {
        source: 'domain:google.com',
        target: 'flow:tcp:142.250.80.46:443',
        kind: 'dns_to_flow',
        query_count: 1,
        blocked_count: 0,
      },
    ];

    const expanded = expandFlowToPortView(nodes, edges);
    const ports = expanded.nodes.filter((n) => n.type === 'port');

    expect(ports).toHaveLength(1);
    expect(ports[0].id).toBe('port:443');
    expect(
      expanded.edges.filter((e) => e.kind === 'to_port' && e.source === INFRA_GATEWAY_ID && e.target === 'port:443'),
    ).toHaveLength(1);
  });

  it('merges TCP and UDP on the same port into one hub', () => {
    const nodes: NetworkMapNode[] = [
      { id: 'app:chrome', type: 'app', label: 'Chrome' },
      { id: 'flow:tcp:142.250.80.46:443', type: 'flow', label: 'TCP/443 → 142.250.80.46' },
      { id: 'flow:udp:142.250.80.46:443', type: 'flow', label: 'UDP/443 → 142.250.80.46' },
    ];
    const edges: NetworkMapEdge[] = [
      {
        source: 'app:chrome',
        target: 'flow:tcp:142.250.80.46:443',
        kind: 'flow_session',
        query_count: 1,
        blocked_count: 0,
      },
      {
        source: 'app:chrome',
        target: 'flow:udp:142.250.80.46:443',
        kind: 'flow_session',
        query_count: 1,
        blocked_count: 0,
      },
    ];

    const expanded = expandFlowToPortView(nodes, edges);
    const ports = expanded.nodes.filter((n) => n.type === 'port');

    expect(ports).toHaveLength(1);
    expect(ports[0].id).toBe('port:443');
  });
});
