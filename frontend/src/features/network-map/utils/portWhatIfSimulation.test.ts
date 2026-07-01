import { computePortWhatIfSimulation } from './portWhatIfSimulation';
import { NetworkMapEdge } from '../types/networkMap';

describe('computePortWhatIfSimulation', () => {
  it('marks downstream connections when a port is blocked', () => {
    const edges: NetworkMapEdge[] = [
      {
        source: 'app:chrome',
        target: 'port:tcp:443',
        kind: 'to_port',
        query_count: 1,
        blocked_count: 0,
      },
      {
        source: 'port:tcp:443',
        target: 'flow:tcp:1.1.1.1:443',
        kind: 'port_to_flow',
        query_count: 2,
        blocked_count: 0,
      },
    ];

    const nodes = [{ id: 'port:tcp:443', type: 'port' as const, label: '443' }];
    const result = computePortWhatIfSimulation(nodes, edges, new Set([443]));
    expect(result.affectedConnectionCount).toBe(2);
    expect(result.simulatedBlockedFlowIds.has('flow:tcp:1.1.1.1:443')).toBe(true);
  });
});
