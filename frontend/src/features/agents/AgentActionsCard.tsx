import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import ViewListOutlinedIcon from '@mui/icons-material/ViewListOutlined';
import { AgentTelemetryEvent } from '../../twin/types/connectedAgent';
import { SecurityAlert } from '../../twin/types/securityAlert';
import { formatShortDateTime } from '../../shared/utils/dateUtils';
import AgentActionTreeView from './AgentActionTreeView';
import {
  AGENT_ACTION_SECTION_AGENT_EXECUTION,
  AGENT_ACTION_SECTION_USER_PROMPT,
  agentActionChips,
  isAiAgentActionEvent,
  isPromptAction,
  labelAgentActionChannel,
  summarizeAgentAction,
} from './utils/agentActionDisplay';
import { buildAgentActionTree } from './utils/agentActionTree';
import { attachHostEvidence } from './utils/agentActionHostEvidence';

type Props = {
  events: AgentTelemetryEvent[];
  alerts?: SecurityAlert[];
  loading?: boolean;
  error?: string | null;
};

type ViewMode = 'tree' | 'list';

function chipColor(label: string): 'error' | 'warning' | 'success' | 'default' {
  if (label === 'Secrets git push' || label === 'Secret file read' || label === 'Secret file write') {
    return 'error';
  }
  if (label === 'Ungoverned' || label === 'blocked' || label === 'sensitive') return 'warning';
  if (label === 'Governed' || label === 'allowed') return 'success';
  return 'default';
}

function ActionChips({ payload }: { payload: Record<string, unknown> }) {
  const chips = agentActionChips(payload);
  if (!chips.length) return null;
  return (
    <>
      {chips.map((c) => (
        <Chip key={c} size="small" label={c} color={chipColor(c)} variant="outlined" />
      ))}
    </>
  );
}

function ActionListView({ actions }: { actions: AgentTelemetryEvent[] }) {
  return (
    <List dense disablePadding>
      {actions.map((event, index) => {
        const payload = (event.payload || {}) as Record<string, unknown>;
        const channel = String(payload.channel || '');
        const asked = isPromptAction(payload as never);
        return (
          <Box key={`${event.event_id || 'action'}-${event.ts}-${index}`}>
            {index > 0 && <Divider />}
            <ListItem alignItems="flex-start" sx={{ px: 0, py: 1.25 }}>
              <ListItemText
                primary={
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Chip
                      size="small"
                      label={asked ? AGENT_ACTION_SECTION_USER_PROMPT : AGENT_ACTION_SECTION_AGENT_EXECUTION}
                      color={asked ? 'primary' : 'default'}
                      variant="outlined"
                    />
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {labelAgentActionChannel(channel)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatShortDateTime(event.ts)}
                    </Typography>
                    <ActionChips payload={payload} />
                  </Stack>
                }
                secondary={
                  <Stack spacing={0.25} sx={{ mt: 0.25 }}>
                    <Typography variant="body2" color="text.secondary">
                      {summarizeAgentAction(payload)}
                    </Typography>
                    {payload.agent_type ? (
                      <Typography variant="caption" color="text.disabled">
                        Agent {String(payload.agent_type)}
                        {payload.correlation_id ? ` · ${String(payload.correlation_id)}` : ''}
                      </Typography>
                    ) : null}
                  </Stack>
                }
              />
            </ListItem>
          </Box>
        );
      })}
    </List>
  );
}

export default function AgentActionsCard({
  events,
  alerts = [],
  loading = false,
  error = null,
}: Props) {
  const [view, setView] = useState<ViewMode>('tree');
  const actions = useMemo(
    () => events.filter((e) => isAiAgentActionEvent(e.type)),
    [events]
  );
  const tree = useMemo(
    () => attachHostEvidence(buildAgentActionTree(events), events, alerts),
    [events, alerts]
  );

  if (loading && actions.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="warning" variant="outlined">
        {error}
      </Alert>
    );
  }

  if (actions.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No AI agent actions yet. Prompts and tools appear when Cursor hooks (or the MCP gateway)
        emit ai_agent_action events — durable history survives twin Redis churn.
      </Typography>
    );
  }

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" justifyContent="flex-end">
        <ToggleButtonGroup
          size="small"
          exclusive
          value={view}
          onChange={(_, next: ViewMode | null) => {
            if (next) setView(next);
          }}
          aria-label="AI agent action view"
        >
          <ToggleButton value="tree" aria-label="Tree view">
            <AccountTreeOutlinedIcon fontSize="small" sx={{ mr: 0.5 }} />
            Tree
          </ToggleButton>
          <ToggleButton value="list" aria-label="List view">
            <ViewListOutlinedIcon fontSize="small" sx={{ mr: 0.5 }} />
            List
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {view === 'tree' ? <AgentActionTreeView sessions={tree} /> : <ActionListView actions={actions} />}
    </Stack>
  );
}
