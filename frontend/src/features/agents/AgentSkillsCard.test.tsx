import { render, screen } from '@testing-library/react';
import AgentSkillsCard, { buildAgentSkillRows } from './AgentSkillsCard';
import { AiSoftwareItem } from '../twin/types/aiSoftware';
import { AgentTelemetryEvent } from '../twin/types/connectedAgent';

const items: AiSoftwareItem[] = [{
  id: 'cursor:/Applications/Cursor.app', product_id: 'cursor', product_name: 'Cursor', vendor: 'Cursor',
  category: 'code_editor', confidence: 'VERIFIED', installed: true, running: true,
  path: '/Applications/Cursor.app', version: '', bundle_id: '', executable: '', signing_id: '', team_id: '',
  skills: [{ id: 'agents:review-folder', name: 'Review', source: 'agents', scope: 'user' }],
}];

const events: AgentTelemetryEvent[] = [{
  event_id: 'skill-load-1', device_id: 'dev_1', type: 'ai_agent_action', ts: '2026-10-04T10:00:00Z',
  payload: { channel: 'SKILL', skill_name: 'review-folder', skill_source: 'agents', operation: 'load', skill_outcome: 'succeeded' },
}];

describe('AgentSkillsCard', () => {
  it('shows skills beside their observed activity', () => {
    const rows = buildAgentSkillRows(items, events);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Review', source: 'agents', scope: 'user', editors: ['Cursor'], available: true, activity: 'load · succeeded' });

    render(<AgentSkillsCard items={items} events={events} loading={false} error={null} />);
    expect(screen.getByRole('table', { name: 'AI agent skills inventory' })).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.getByText('load · succeeded')).toBeInTheDocument();
  });

  it('shows an empty state when no skills are reported', () => {
    render(<AgentSkillsCard items={[]} events={[]} loading={false} error={null} />);
    expect(screen.getByText('No AI agent skills detected for this agent yet.')).toBeInTheDocument();
  });
});