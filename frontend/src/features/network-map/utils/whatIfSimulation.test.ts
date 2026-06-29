import { computeWhatIfSimulation, toggleDisabledApp } from './whatIfSimulation';
import { NetworkMapEdge, NetworkMapNode } from '../types/networkMap';

const nodes: NetworkMapNode[] = [
  { id: 'device:1', type: 'device', label: 'Mac' },
  { id: 'app:google_chrome', type: 'app', label: 'Google Chrome', app_slug: 'google_chrome' },
  { id: 'app:cursor', type: 'app', label: 'Cursor', app_slug: 'cursor' },
  { id: 'domain:github.com', type: 'domain', label: 'github.com' },
  { id: 'domain:google.com', type: 'domain', label: 'google.com' },
];

const edges: NetworkMapEdge[] = [
  { source: 'device:1', target: 'app:google_chrome', kind: 'foreground', query_count: 1, blocked_count: 0 },
  { source: 'app:google_chrome', target: 'domain:github.com', kind: 'dns', query_count: 3, blocked_count: 0 },
  { source: 'app:google_chrome', target: 'domain:google.com', kind: 'dns', query_count: 5, blocked_count: 0 },
  { source: 'app:cursor', target: 'domain:github.com', kind: 'dns', query_count: 2, blocked_count: 0 },
];

describe('computeWhatIfSimulation', () => {
  it('marks domains blocked when only disabled apps reach them', () => {
    const result = computeWhatIfSimulation(nodes, edges, new Set(['app:google_chrome']));

    expect(result.affectedQueryCount).toBe(8);
    expect(result.simulatedBlockedDomainIds.has('domain:google.com')).toBe(true);
    expect(result.simulatedBlockedDomainIds.has('domain:github.com')).toBe(false);
    expect(result.affectedDomainCount).toBe(1);
  });

  it('returns empty impact when no apps are disabled', () => {
    const result = computeWhatIfSimulation(nodes, edges, new Set());
    expect(result.affectedQueryCount).toBe(0);
    expect(result.disabledEdgeKeys.size).toBe(0);
  });
});

describe('toggleDisabledApp', () => {
  it('adds and removes app ids', () => {
    let selected = new Set<string>();
    selected = toggleDisabledApp(selected, 'app:google_chrome');
    expect(selected.has('app:google_chrome')).toBe(true);
    selected = toggleDisabledApp(selected, 'app:google_chrome');
    expect(selected.has('app:google_chrome')).toBe(false);
  });
});
