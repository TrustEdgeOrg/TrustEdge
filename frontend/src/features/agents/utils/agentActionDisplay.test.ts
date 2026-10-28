import {
  actionNodeDetail,
  actionNodeTitle,
  agentActionChips,
  isAiAgentActionEvent,
  isHighRiskAction,
  labelAgentActionChannel,
  summarizeAgentAction,
} from './agentActionDisplay';

describe('agentActionDisplay', () => {
  it('detects ai_agent_action', () => {
    expect(isAiAgentActionEvent('ai_agent_action')).toBe(true);
    expect(isAiAgentActionEvent('process_start')).toBe(false);
  });

  it('summarizes governed MCP tool calls', () => {
    const s = summarizeAgentAction({
      channel: 'MCP',
      server: 'customer-db',
      tool: 'query_customers',
      decision: 'allowed',
      sensitivity: 'sensitive',
      governed: true,
    });
    expect(s).toContain('customer-db/query_customers');
    expect(s).toContain('allowed');
    expect(s).toContain('sensitive');
    expect(s).toContain('governed');
  });

  it('summarizes ungoverned network egress', () => {
    const s = summarizeAgentAction({
      channel: 'NETWORK',
      process: 'curl',
      destination: 'unknown-site.example',
      governed: false,
    });
    expect(s).toContain('curl');
    expect(s).toContain('unknown-site.example');
    expect(s).toContain('ungoverned');
  });

  it('builds chips', () => {
    expect(
      agentActionChips({
        channel: 'MCP',
        governed: true,
        decision: 'allowed',
        sensitivity: 'sensitive',
      })
    ).toEqual(['Governed', 'allowed', 'sensitive']);
  });

  it('summarizes shell commands from destination', () => {
    expect(
      summarizeAgentAction({
        channel: 'SHELL',
        tool: 'Shell',
        destination: 'ls -la docs/',
      })
    ).toBe('ls -la docs/ · Shell');
  });

  it('labels action node titles', () => {
    expect(actionNodeTitle({ tool: 'Grep', channel: 'FILE' })).toBe('Grep');
    expect(actionNodeTitle({ tool: 'prompt', destination: 'hello · submit' })).toBe('User prompt');
  });

  it('prefers prompt_text over destination for prompts', () => {
    expect(
      actionNodeDetail({
        tool: 'prompt',
        destination: 'truncated…',
        prompt_text: 'Hey — full prompt\n\nwith newlines',
      })
    ).toBe('Hey — full prompt\n\nwith newlines');
  });

  it('labels channels', () => {
    expect(labelAgentActionChannel('MCP')).toBe('MCP tool');
    expect(labelAgentActionChannel('NETWORK')).toBe('Network');
    expect(labelAgentActionChannel('SKILL')).toBe('AI skill');
    expect(
      summarizeAgentAction({
        channel: 'SKILL',
        skill_name: 'review',
        operation: 'load',
        skill_outcome: 'succeeded',
      })
    ).toBe('review · load · succeeded');
  });

  it('flags secrets git push as high risk', () => {
    const payload = {
      risk: 'high',
      risk_type: 'secrets_git_push',
      channel: 'SHELL',
      destination: 'git add .env && git push origin main',
    };
    expect(isHighRiskAction(payload)).toBe(true);
    expect(agentActionChips(payload)).toEqual(['Secrets git push']);
  });
});
