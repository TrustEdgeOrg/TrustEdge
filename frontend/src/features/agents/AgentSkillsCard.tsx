import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { formatShortDateTime } from '../../shared/utils/dateUtils';
import { AiSoftwareItem } from '../twin/types/aiSoftware';
import { AgentTelemetryEvent } from '../twin/types/connectedAgent';

export type AgentSkillRow = {
  id: string;
  name: string;
  source: string;
  scope: string;
  editors: string[];
  available: boolean;
  activity: string;
  observations: number;
  lastObservedAt: string | null;
};

const normalize = (value: string) => value.trim().toLowerCase();

export function buildAgentSkillRows(items: AiSoftwareItem[], events: AgentTelemetryEvent[]): AgentSkillRow[] {
  const rows = new Map<string, AgentSkillRow>();
  const byName = new Map<string, AgentSkillRow[]>();

  for (const item of items) {
    for (const skill of item.skills || []) {
      const name = String(skill.name || '').trim();
      if (!name) continue;
      const source = String(skill.source || 'unknown').trim();
      const id = String(skill.id || `${source}:${name}`).trim();
      const key = normalize(id);
      let row = rows.get(key);
      if (!row) {
        row = {
          id,
          name,
          source,
          scope: skill.scope || 'user',
          editors: [],
          available: true,
          activity: '',
          observations: 0,
          lastObservedAt: null,
        };
        rows.set(key, row);
        byName.set(normalize(name), [...(byName.get(normalize(name)) || []), row]);
      }
      if (item.product_name && !row.editors.includes(item.product_name)) row.editors.push(item.product_name);
    }
  }

  const usage = events
    .filter((event) => event.type === 'ai_agent_action' && normalize(String(event.payload.channel || '')) === 'skill')
    .sort((a, b) => (Date.parse(a.ts || '') || 0) - (Date.parse(b.ts || '') || 0));

  for (const event of usage) {
    const payload = event.payload || {};
    const name = String(payload.skill_name || payload.destination || '').trim();
    if (!name) continue;
    const source = String(payload.skill_source || 'unknown').trim();
    let row = rows.get(normalize(`${source}:${name}`));
    const sameName = byName.get(normalize(name)) || [];
    if (!row) row = sameName.find((candidate) => normalize(candidate.source) === normalize(source));
    if (!row && sameName.length === 1) row = sameName[0];
    if (!row) {
      const id = `${source}:${name}`;
      row = {
        id,
        name,
        source,
        scope: source === 'github' ? 'workspace' : 'observed',
        editors: [],
        available: false,
        activity: '',
        observations: 0,
        lastObservedAt: null,
      };
      rows.set(normalize(id), row);
    }
    row.observations += 1;
    row.activity = [payload.operation, payload.skill_outcome].map((v) => String(v || '').trim()).filter(Boolean).join(' · ');
    row.lastObservedAt = event.ts || null;
  }

  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

type Props = {
  items: AiSoftwareItem[];
  events: AgentTelemetryEvent[];
  loading: boolean;
  error: string | null;
};

export default function AgentSkillsCard({ items, events, loading, error }: Props) {
  const skills = buildAgentSkillRows(items, events);
  if (loading && skills.length === 0) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} /></Box>;
  }
  if (skills.length === 0) {
    return <Alert severity={error ? 'warning' : 'info'} variant="outlined">{error || 'No AI agent skills detected for this agent yet.'}</Alert>;
  }

  return (
    <Stack spacing={1}>
      {error ? <Alert severity="warning" variant="outlined">{error}</Alert> : null}
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" aria-label="AI agent skills inventory">
          <TableHead><TableRow>
            <TableCell>Skill</TableCell><TableCell>Source</TableCell><TableCell>Scope</TableCell>
            <TableCell>IDE / agent</TableCell><TableCell>Availability</TableCell>
            <TableCell>Observed activity</TableCell><TableCell>Last observed</TableCell>
          </TableRow></TableHead>
          <TableBody>{skills.map((skill) => (
            <TableRow key={skill.id} hover>
              <TableCell><Typography variant="body2" sx={{ fontWeight: 600 }}>{skill.name}</Typography></TableCell>
              <TableCell>{skill.source}</TableCell><TableCell>{skill.scope}</TableCell>
              <TableCell>{skill.editors.join(', ') || '—'}</TableCell>
              <TableCell><Chip size="small" label={skill.available ? 'Available' : 'Observed only'} color={skill.available ? 'success' : 'default'} variant="outlined" /></TableCell>
              <TableCell>{skill.activity || <Typography variant="body2" color="text.secondary">Not observed</Typography>}</TableCell>
              <TableCell>{skill.lastObservedAt ? formatShortDateTime(skill.lastObservedAt) : '—'}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      </Box>
    </Stack>
  );
}