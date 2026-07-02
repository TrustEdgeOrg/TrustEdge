import {
  projectAttributionGraph,
  projectFlowGraph,
  projectPathGraph,
  projectTwinGraph,
} from './projectGraph';
import { TwinGraphIndex } from '../graph/TwinGraphIndex';
import { TwinGraphSnapshot } from '../types/twinGraph';

function sampleSnapshot(): TwinGraphSnapshot {
  return {
    generated_at: '2026-01-01T00:00:00Z',
    window_minutes: 15,
    nodes: [
      {
        id: 'device:1',
        entity_type: 'device',
        layer: 'observed',
        label: 'laptop',
        properties: { client_ip: '10.0.0.12', device_id: 1, fresh: true },
      },
      {
        id: 'app:zoom',
        entity_type: 'app',
        layer: 'observed',
        label: 'Zoom',
        properties: { app_slug: 'zoom' },
      },
      {
        id: 'domain:zoom.us',
        entity_type: 'domain',
        layer: 'observed',
        label: 'zoom.us',
        properties: { blocked: false },
      },
      {
        id: 'infra:wireguard',
        entity_type: 'infra_component',
        layer: 'desired',
        label: 'WireGuard',
        properties: { kind: 'wireguard' },
      },
      {
        id: 'infra:dns_resolver',
        entity_type: 'infra_component',
        layer: 'desired',
        label: 'TrustEdge DNS',
        properties: { kind: 'dns_resolver' },
      },
      {
        id: 'policy_profile:1',
        entity_type: 'policy_profile',
        layer: 'desired',
        label: 'Teen',
        properties: { slug: 'teen' },
      },
      {
        id: 'l4:tcp:443',
        entity_type: 'l4_service',
        layer: 'observed',
        label: 'TCP 443',
        properties: { protocol: 'tcp', port: 443 },
      },
      {
        id: 'flow:tcp:93.184.216.34:443:10.0.0.12',
        entity_type: 'flow_session',
        layer: 'observed',
        label: 'TCP/443',
        properties: { protocol: 'tcp', dest_ip: '93.184.216.34', dest_port: 443, client_ip: '10.0.0.12' },
      },
      {
        id: 'ip:93.184.216.34',
        entity_type: 'ip_address',
        layer: 'observed',
        label: '93.184.216.34',
        properties: { addr: '93.184.216.34' },
      },
    ],
    edges: [
      {
        id: 'runs:device:1->app:zoom',
        source_id: 'device:1',
        target_id: 'app:zoom',
        relation: 'runs',
        layer: 'observed',
        weight: 1,
        properties: {},
      },
      {
        id: 'queries:app:zoom->domain:zoom.us',
        source_id: 'app:zoom',
        target_id: 'domain:zoom.us',
        relation: 'queries',
        layer: 'observed',
        weight: 3,
        properties: { blocked_count: 0 },
      },
      {
        id: 'assigned:device:1->policy_profile:1',
        source_id: 'device:1',
        target_id: 'policy_profile:1',
        relation: 'assigned',
        layer: 'desired',
        weight: 1,
        properties: {},
      },
      {
        id: 'opens:app:zoom->flow:tcp:93.184.216.34:443:10.0.0.12',
        source_id: 'app:zoom',
        target_id: 'flow:tcp:93.184.216.34:443:10.0.0.12',
        relation: 'opens',
        layer: 'observed',
        weight: 1,
        properties: {},
      },
      {
        id: 'uses:flow->l4',
        source_id: 'flow:tcp:93.184.216.34:443:10.0.0.12',
        target_id: 'l4:tcp:443',
        relation: 'uses_service',
        layer: 'observed',
        weight: 1,
        properties: {},
      },
      {
        id: 'dest:flow->ip',
        source_id: 'flow:tcp:93.184.216.34:443:10.0.0.12',
        target_id: 'ip:93.184.216.34',
        relation: 'destinates',
        layer: 'observed',
        weight: 1,
        properties: {},
      },
    ],
  };
}

describe('projectAttributionGraph', () => {
  it('maps observed telemetry to attribution nodes and edges', () => {
    const result = projectAttributionGraph(sampleSnapshot());
    expect(result.nodes.map((n) => n.type).sort()).toEqual(['app', 'device', 'domain']);
    expect(result.edges.some((e) => e.kind === 'foreground')).toBe(true);
    expect(result.edges.some((e) => e.kind === 'dns')).toBe(true);
  });
});

describe('projectPathGraph', () => {
  it('includes infra and policy nodes from twin graph', () => {
    const attribution = projectAttributionGraph(sampleSnapshot());
    const result = projectPathGraph(sampleSnapshot(), attribution);
    const types = new Set(result.nodes.map((n) => n.type));
    expect(types.has('tunnel')).toBe(true);
    expect(types.has('gateway')).toBe(true);
    expect(types.has('policy')).toBe(true);
    expect(result.edges.some((e) => e.kind === 'path_forward')).toBe(true);
  });
});

describe('projectFlowGraph', () => {
  it('projects flow sessions to port hubs', () => {
    const result = projectFlowGraph(sampleSnapshot());
    expect(result.nodes.some((n) => n.type === 'port' && n.label === '443')).toBe(true);
    expect(result.nodes.some((n) => n.type === 'flow')).toBe(true);
    expect(result.edges.some((e) => e.kind === 'port_to_flow')).toBe(true);
  });
});

describe('projectTwinGraph', () => {
  it('selects projection by mode', () => {
    const snapshot = sampleSnapshot();
    expect(projectTwinGraph(snapshot, 'attribution').edges.some((e) => e.kind === 'dns')).toBe(true);
    expect(projectTwinGraph(snapshot, 'path').edges.some((e) => e.kind === 'path_egress')).toBe(true);
    expect(projectTwinGraph(snapshot, 'flow').nodes.some((n) => n.type === 'port')).toBe(true);
  });
});

describe('TwinGraphIndex', () => {
  it('traverses reverse from domain to device via policy', () => {
    const index = new TwinGraphIndex(sampleSnapshot());
    const result = index.traverse({
      seed_node_ids: ['domain:zoom.us'],
      direction: 'in',
      relations: ['queries', 'runs', 'assigned'],
      max_depth: 4,
      layers: ['observed', 'desired'],
    });
    expect(result.nodes.some((n) => n.id === 'device:1')).toBe(true);
  });
});
