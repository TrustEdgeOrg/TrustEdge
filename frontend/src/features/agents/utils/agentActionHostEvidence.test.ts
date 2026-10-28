import { AgentTelemetryEvent } from '../../twin/types/connectedAgent';
import { SecurityAlert } from '../../twin/types/securityAlert';
import { buildAgentActionTree } from './agentActionTree';
import { attachHostEvidence } from './agentActionHostEvidence';

function action(
  partial: Partial<AgentTelemetryEvent> & { payload: Record<string, unknown> }
): AgentTelemetryEvent {
  return {
    event_id: partial.event_id || 'ev',
    device_id: 'dev-1',
    type: 'ai_agent_action',
    ts: partial.ts || '2026-08-27T20:20:00Z',
    payload: partial.payload,
  };
}

describe('attachHostEvidence', () => {
  it('attaches matching file telemetry and AI alert to the turn', () => {
    const sessions = buildAgentActionTree([
      action({
        event_id: 'p1',
        ts: '2026-08-27T20:20:00Z',
        payload: {
          session_id: 'c1',
          turn_id: 't1',
          tool: 'prompt',
          destination: 'edit README',
        },
      }),
      action({
        event_id: 'r1',
        ts: '2026-08-27T20:20:01Z',
        payload: {
          session_id: 'c1',
          turn_id: 't1',
          tool: 'Read',
          channel: 'FILE',
          destination: '/Users/eladmines/Desktop/TrustEdge-Agent/README.md',
        },
      }),
      action({
        event_id: 'w1',
        ts: '2026-08-27T20:20:02Z',
        payload: {
          session_id: 'c1',
          turn_id: 't1',
          tool: 'Write',
          channel: 'FILE',
          destination: '/Users/eladmines/Desktop/TrustEdge-Agent/README.md',
        },
      }),
    ]);

    const hostEvents: AgentTelemetryEvent[] = [
      {
        event_id: 'fo1',
        device_id: 'dev-1',
        type: 'file_open',
        ts: '2026-08-27T20:20:01.5Z',
        payload: { path: '/Users/eladmines/Desktop/TrustEdge-Agent/README.md', pid: 1 },
      },
      {
        event_id: 'noise',
        device_id: 'dev-1',
        type: 'file_open',
        ts: '2026-08-27T20:20:01.6Z',
        payload: { path: '/tmp/unrelated.txt', pid: 2 },
      },
    ];

    const alerts: SecurityAlert[] = [
      {
        id: 1,
        timestamp: '2026-08-27T20:20:03Z',
        device_id: 'dev-1',
        alert_type: 'ai_secrets_access',
        severity: 'medium',
        message: 'AI session accessed README.md',
        detail: JSON.stringify({ path: '/Users/eladmines/Desktop/TrustEdge-Agent/README.md' }),
      },
    ];

    const withHost = attachHostEvidence(sessions, hostEvents, alerts);
    const evidence = withHost[0].turns[0].hostEvidence;
    expect(evidence.some((e) => e.kind === 'file' && e.detail.includes('README.md'))).toBe(true);
    expect(evidence.some((e) => e.kind === 'alert' && e.alertType === 'ai_secrets_access')).toBe(true);
    expect(evidence.some((e) => e.detail.includes('unrelated'))).toBe(false);
  });

  it('matches shell commands to process_start cmdline', () => {
    const sessions = buildAgentActionTree([
      action({
        event_id: 'p1',
        ts: '2026-08-27T20:20:00Z',
        payload: { session_id: 'c1', turn_id: 't1', tool: 'prompt', destination: 'push env' },
      }),
      action({
        event_id: 's1',
        ts: '2026-08-27T20:20:01Z',
        payload: {
          session_id: 'c1',
          turn_id: 't1',
          tool: 'Shell',
          channel: 'SHELL',
          destination: 'git add .env && git push origin main',
        },
      }),
    ]);

    const hostEvents: AgentTelemetryEvent[] = [
      {
        event_id: 'ps1',
        device_id: 'dev-1',
        type: 'process_start',
        ts: '2026-08-27T20:20:02Z',
        payload: {
          pid: 99,
          comm: 'git',
          cmdline: 'git add .env && git push origin main',
        },
      },
    ];

    const withHost = attachHostEvidence(sessions, hostEvents, []);
    expect(withHost[0].turns[0].hostEvidence.some((e) => e.kind === 'process')).toBe(true);
  });

  it('matches IDE host-bridge events by correlation_id', () => {
    const sessions = buildAgentActionTree([
      action({
        event_id: 'p1',
        ts: '2026-08-27T20:20:00Z',
        payload: { session_id: 'c1', turn_id: 't1', tool: 'prompt', destination: 'run ls' },
      }),
      action({
        event_id: 's1',
        ts: '2026-08-27T20:20:01Z',
        payload: {
          session_id: 'c1',
          turn_id: 't1',
          tool: 'Shell',
          channel: 'SHELL',
          destination: 'ls /tmp',
          correlation_id: 'corr-bridge-1',
        },
      }),
    ]);

    const hostEvents: AgentTelemetryEvent[] = [
      {
        event_id: 'ps-bridge',
        device_id: 'dev-1',
        type: 'process_start',
        ts: '2026-08-27T20:20:01.2Z',
        payload: {
          pid: 800000001,
          comm: 'ls',
          cmdline: 'ls /tmp',
          source: 'cursor_hook_host_bridge',
          correlation_id: 'corr-bridge-1',
        },
      },
    ];

    const withHost = attachHostEvidence(sessions, hostEvents, []);
    const evidence = withHost[0].turns[0].hostEvidence;
    expect(evidence.some((e) => e.kind === 'process' && e.title.includes('IDE bridge'))).toBe(true);
  });

  it('labels bridged file_open with operation=write as File write', () => {
    const sessions = buildAgentActionTree([
      action({
        event_id: 'w1',
        ts: '2026-08-27T20:20:01Z',
        payload: {
          session_id: 'c1',
          turn_id: 't1',
          tool: 'Write',
          channel: 'FILE',
          destination: '/tmp/out.txt',
          correlation_id: 'corr-w',
        },
      }),
    ]);

    const hostEvents: AgentTelemetryEvent[] = [
      {
        event_id: 'fo-w',
        device_id: 'dev-1',
        type: 'file_open',
        ts: '2026-08-27T20:20:01.1Z',
        payload: {
          path: '/tmp/out.txt',
          operation: 'write',
          source: 'cursor_hook_host_bridge',
          correlation_id: 'corr-w',
        },
      },
    ];

    const withHost = attachHostEvidence(sessions, hostEvents, []);
    expect(
      withHost[0].turns[0].hostEvidence.some(
        (e) => e.kind === 'file' && e.title.startsWith('File write')
      )
    ).toBe(true);
  });

  it('matches MCP gateway host bridge by correlation_id', () => {
    const sessions = buildAgentActionTree([
      action({
        event_id: 'p1',
        ts: '2026-08-27T20:20:00Z',
        payload: { session_id: 'c1', turn_id: 't1', tool: 'prompt', destination: 'list issues' },
      }),
      action({
        event_id: 'm1',
        ts: '2026-08-27T20:20:01Z',
        payload: {
          session_id: 'c1',
          turn_id: 't1',
          channel: 'MCP',
          server: 'github',
          tool: 'list_issues',
          destination: 'TrustEdgeOrg/TrustEdge',
          correlation_id: 'corr-mcp-1',
          governed: true,
        },
      }),
    ]);

    const hostEvents: AgentTelemetryEvent[] = [
      {
        event_id: 'net-mcp',
        device_id: 'dev-1',
        type: 'network_connection',
        ts: '2026-08-27T20:20:01.2Z',
        payload: {
          comm: 'github-mcp',
          domain: 'api.github.com',
          remote_addr: 'api.github.com',
          source: 'mcp_gateway_host_bridge',
          correlation_id: 'corr-mcp-1',
        },
      },
    ];

    const withHost = attachHostEvidence(sessions, hostEvents, []);
    expect(
      withHost[0].turns[0].hostEvidence.some(
        (e) => e.kind === 'network' && e.title.includes('MCP bridge')
      )
    ).toBe(true);
  });
});
