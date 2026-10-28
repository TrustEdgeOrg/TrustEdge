import { AgentTelemetryEvent } from '../../twin/types/connectedAgent';
import { mergeConsecutiveHostEvidence, mergeConsecutiveTools } from './agentActionMerge';
import { AgentActionTreeNode } from './agentActionTree';
import { HostEvidenceItem } from './agentActionHostEvidence';

function node(
  partial: Partial<AgentTelemetryEvent> & { payload: Record<string, unknown> }
): AgentActionTreeNode {
  return {
    event: {
      event_id: partial.event_id || 'ev',
      device_id: 'dev-1',
      type: 'ai_agent_action',
      ts: partial.ts || '2026-08-27T20:20:00Z',
      payload: partial.payload,
    },
    payload: partial.payload,
  };
}

describe('mergeConsecutiveTools', () => {
  it('merges consecutive Shell tools but not across different tools', () => {
    const groups = mergeConsecutiveTools([
      node({ event_id: '1', payload: { tool: 'Shell', channel: 'SHELL', destination: 'pwd' } }),
      node({ event_id: '2', payload: { tool: 'Shell', channel: 'SHELL', destination: 'ls' } }),
      node({ event_id: '3', payload: { tool: 'Read', channel: 'FILE', destination: 'README.md' } }),
      node({ event_id: '4', payload: { tool: 'Shell', channel: 'SHELL', destination: 'git status' } }),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups[0].nodes).toHaveLength(2);
    expect(groups[1].nodes).toHaveLength(1);
    expect(groups[1].nodes[0].payload.tool).toBe('Read');
    expect(groups[2].nodes).toHaveLength(1);
  });

  it('does not merge same tool when interrupted by another', () => {
    const groups = mergeConsecutiveTools([
      node({ payload: { tool: 'Read', channel: 'FILE', destination: 'a' } }),
      node({ payload: { tool: 'Write', channel: 'FILE', destination: 'b' } }),
      node({ payload: { tool: 'Read', channel: 'FILE', destination: 'c' } }),
    ]);
    expect(groups).toHaveLength(3);
  });
});

describe('mergeConsecutiveHostEvidence', () => {
  it('merges consecutive process rows even when titles differ', () => {
    const items: HostEvidenceItem[] = [
      {
        kind: 'process',
        title: 'Process start · echo (IDE bridge)',
        detail: 'echo START · pid 1',
        ts: '2026-08-27T20:20:01Z',
      },
      {
        kind: 'process',
        title: 'Process start · ls (IDE bridge)',
        detail: 'ls README.md · pid 2',
        ts: '2026-08-27T20:20:02Z',
      },
      {
        kind: 'file',
        title: 'File open (IDE bridge)',
        detail: 'README.md',
        ts: '2026-08-27T20:20:03Z',
      },
    ];
    const groups = mergeConsecutiveHostEvidence(items);
    expect(groups).toHaveLength(2);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items).toHaveLength(1);
  });
});
