import { AgentTelemetryEvent } from '../../twin/types/connectedAgent';
import { buildAgentActionTree } from './agentActionTree';

function action(
  partial: Partial<AgentTelemetryEvent> & { payload: Record<string, unknown> }
): AgentTelemetryEvent {
  return {
    event_id: partial.event_id || 'ev',
    device_id: 'dev-1',
    type: 'ai_agent_action',
    ts: partial.ts || '2026-08-25T00:29:00Z',
    payload: partial.payload,
  };
}

describe('buildAgentActionTree', () => {
  it('groups prompt and following tools into one turn', () => {
    const sessions = buildAgentActionTree([
      action({
        event_id: 'p1',
        ts: '2026-08-25T00:29:00Z',
        payload: {
          session_id: 'conv-1',
          turn_id: 'gen-1',
          tool: 'prompt',
          correlation_id: 'gen-1',
          destination: 'how to trigger ?',
        },
      }),
      action({
        event_id: 't1',
        ts: '2026-08-25T00:29:01Z',
        payload: {
          session_id: 'conv-1',
          turn_id: 'gen-1',
          tool: 'Grep',
          channel: 'FILE',
          destination: '/project',
        },
      }),
      action({
        event_id: 't2',
        ts: '2026-08-25T00:29:02Z',
        payload: {
          session_id: 'conv-1',
          turn_id: 'gen-1',
          tool: 'Grep',
          channel: 'FILE',
          destination: '/project',
        },
      }),
    ]);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].turns).toHaveLength(1);
    expect(sessions[0].turns[0].prompt?.payload.destination).toBe('how to trigger ?');
    expect(sessions[0].turns[0].tools).toHaveLength(2);
  });

  it('splits multiple prompts into separate turns', () => {
    const sessions = buildAgentActionTree([
      action({
        event_id: 'p1',
        ts: '2026-08-25T00:29:00Z',
        payload: { session_id: 'conv-1', tool: 'prompt', destination: 'first' },
      }),
      action({
        event_id: 't1',
        ts: '2026-08-25T00:29:01Z',
        payload: { session_id: 'conv-1', tool: 'Shell', channel: 'SHELL' },
      }),
      action({
        event_id: 'p2',
        ts: '2026-08-25T00:30:00Z',
        payload: { session_id: 'conv-1', tool: 'prompt', destination: 'second' },
      }),
    ]);

    expect(sessions[0].turns).toHaveLength(2);
    expect(sessions[0].turns[0].prompt?.payload.destination).toBe('second');
    expect(sessions[0].turns[1].tools).toHaveLength(1);
  });

  it('places orphan tools without a prompt in their own turn', () => {
    const sessions = buildAgentActionTree([
      action({
        event_id: 'm1',
        ts: '2026-08-25T00:29:00Z',
        payload: {
          session_id: 'conv-1',
          channel: 'MCP',
          server: 'github',
          tool: 'list_issues',
          governed: true,
        },
      }),
    ]);

    expect(sessions[0].turns).toHaveLength(1);
    expect(sessions[0].turns[0].prompt).toBeNull();
    expect(sessions[0].turns[0].tools).toHaveLength(1);
  });

  it('merges orphan MCP tools with the nearest prompt turn', () => {
    const sessions = buildAgentActionTree([
      action({
        event_id: 'm1',
        ts: '2026-08-25T00:29:00Z',
        payload: {
          channel: 'MCP',
          server: 'github',
          tool: 'list_issues',
          governed: true,
        },
      }),
      action({
        event_id: 'p1',
        ts: '2026-08-25T00:29:02Z',
        payload: {
          session_id: 'conv-1',
          turn_id: 'gen-1',
          tool: 'prompt',
          correlation_id: 'gen-1',
          destination: 'list issues',
        },
      }),
    ]);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].turns).toHaveLength(1);
    expect(sessions[0].turns[0].prompt?.payload.destination).toBe('list issues');
    expect(sessions[0].turns[0].tools).toHaveLength(1);
    expect(sessions[0].turns[0].tools[0].payload.tool).toBe('list_issues');
  });
});
