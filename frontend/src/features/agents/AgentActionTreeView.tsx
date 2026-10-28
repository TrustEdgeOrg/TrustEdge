import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import { alpha, Theme, useTheme } from '@mui/material/styles';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import TerminalOutlinedIcon from '@mui/icons-material/TerminalOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import LanguageOutlinedIcon from '@mui/icons-material/LanguageOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import MemoryOutlinedIcon from '@mui/icons-material/MemoryOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import { formatShortDateTime } from '../../shared/utils/dateUtils';
import {
  AgentActionPayload,
  AGENT_ACTION_SECTION_AGENT_EXECUTION,
  AGENT_ACTION_SECTION_EFFECTIVE_CORROBORATION,
  AGENT_ACTION_SECTION_USER_PROMPT,
  actionNodeAccent,
  actionNodeDetail,
  actionNodeTitle,
  agentActionChips,
  durationMsFromEvidence,
  isPromptAction,
  isHighRiskAction,
} from './utils/agentActionDisplay';
import { AgentActionTreeNode } from './utils/agentActionTree';
import {
  AgentActionSessionWithHost,
  AgentActionTurnWithHost,
  HostEvidenceItem,
  hostEvidenceEmptyMessage,
} from './utils/agentActionHostEvidence';
import { mergeConsecutiveHostEvidence, mergeConsecutiveTools } from './utils/agentActionMerge';

function chipColor(label: string): 'error' | 'warning' | 'success' | 'default' {
  if (label === 'Secrets git push' || label === 'Secret file read' || label === 'Secret file write') {
    return 'error';
  }
  if (label === 'Ungoverned' || label === 'blocked' || label === 'sensitive') return 'warning';
  if (label === 'Governed' || label === 'allowed') return 'success';
  return 'default';
}

function resolveAccent(theme: Theme, token: string): string {
  const [paletteKey, shade] = token.split('.');
  const palette = theme.palette[paletteKey as keyof typeof theme.palette];
  if (palette && typeof palette === 'object' && shade in palette) {
    return String((palette as Record<string, string>)[shade]);
  }
  return theme.palette.text.secondary;
}

function NodeIcon({ payload }: { payload: AgentActionPayload }) {
  const tool = String(payload.tool || '').trim();
  const channel = String(payload.channel || '').toUpperCase();
  const sx = { fontSize: 18 };

  if (isPromptAction(payload)) return <ChatBubbleOutlineIcon sx={sx} />;
  if (channel === 'MCP') return <HubOutlinedIcon sx={sx} />;
  if (channel === 'SHELL' || tool === 'Shell' || tool === 'Bash') return <TerminalOutlinedIcon sx={sx} />;
  if (tool === 'Grep' || tool === 'Glob') return <SearchOutlinedIcon sx={sx} />;
  if (tool === 'Write' || tool === 'StrReplace' || tool === 'Edit' || tool === 'Delete') {
    return <EditOutlinedIcon sx={sx} />;
  }
  if (tool === 'Read') return <DescriptionOutlinedIcon sx={sx} />;
  if (tool === 'Task') return <SmartToyOutlinedIcon sx={sx} />;
  if (channel === 'NETWORK' || tool === 'WebFetch' || tool === 'WebSearch') {
    return <LanguageOutlinedIcon sx={sx} />;
  }
  return <BuildOutlinedIcon sx={sx} />;
}

function HostIcon({ kind }: { kind: HostEvidenceItem['kind'] }) {
  const sx = { fontSize: 18 };
  if (kind === 'alert') return <WarningAmberOutlinedIcon sx={sx} />;
  if (kind === 'file') return <FolderOpenOutlinedIcon sx={sx} />;
  if (kind === 'network') return <LanguageOutlinedIcon sx={sx} />;
  return <MemoryOutlinedIcon sx={sx} />;
}

function ActionNodeCard({
  nodes,
  isLast,
}: {
  nodes: AgentActionTreeNode[];
  isLast: boolean;
}) {
  const theme = useTheme();
  const primary = nodes[0];
  const payload = primary.payload as AgentActionPayload;
  const accentToken = actionNodeAccent(payload);
  const accent = resolveAccent(theme, accentToken);
  const prompt = isPromptAction(payload);
  const highRisk = nodes.some((n) => isHighRiskAction(n.payload));
  const chips = Array.from(
    new Set(nodes.flatMap((n) => agentActionChips(n.payload as AgentActionPayload)))
  );
  const durations = nodes
    .map((n) => durationMsFromEvidence((n.payload as AgentActionPayload).evidence))
    .filter((n): n is number => n != null);
  const durationMs = durations.length ? durations.reduce((a, b) => a + b, 0) : null;
  const count = nodes.length;
  const cardBorder = highRisk
    ? alpha(theme.palette.error.main, 0.55)
    : prompt
      ? alpha(theme.palette.primary.main, 0.25)
      : 'divider';
  const cardBg = highRisk
    ? alpha(theme.palette.error.main, 0.06)
    : prompt
      ? alpha(theme.palette.primary.main, 0.04)
      : 'background.paper';
  const firstTs = primary.event.ts;
  const lastTs = nodes[nodes.length - 1].event.ts;

  return (
    <Stack direction="row" spacing={1.5} sx={{ position: 'relative', pb: isLast ? 0 : 1.75 }}>
      {!isLast ? (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            left: 17,
            top: 36,
            bottom: 0,
            width: 2,
            bgcolor: 'divider',
            borderRadius: 1,
          }}
        />
      ) : null}

      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: accent,
          bgcolor: alpha(accent, 0.08),
          border: `1.5px solid ${alpha(accent, 0.35)}`,
          boxShadow: prompt ? `0 0 0 4px ${alpha(theme.palette.primary.main, 0.08)}` : 'none',
          zIndex: 1,
        }}
      >
        <NodeIcon payload={payload} />
      </Box>

      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          border: '1px solid',
          borderColor: cardBorder,
          borderRadius: 1.5,
          px: 1.5,
          py: 1.25,
          bgcolor: cardBg,
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {actionNodeTitle(payload)}
          </Typography>
          {count > 1 ? (
            <Chip size="small" label={`×${count}`} variant="outlined" sx={{ height: 22 }} />
          ) : null}
          <Typography variant="caption" color="text.secondary">
            {count > 1 && firstTs !== lastTs
              ? `${formatShortDateTime(firstTs)} → ${formatShortDateTime(lastTs)}`
              : formatShortDateTime(firstTs)}
          </Typography>
          {durationMs != null ? (
            <Chip
              size="small"
              label={count > 1 ? `${durationMs}ms total` : `${durationMs}ms`}
              variant="outlined"
              sx={{ height: 22 }}
            />
          ) : null}
          {chips.map((c) => (
            <Chip key={c} size="small" label={c} color={chipColor(c)} variant="outlined" sx={{ height: 22 }} />
          ))}
        </Stack>

        {count === 1 ? (
          <Typography
            variant="body2"
            color={prompt ? 'text.primary' : 'text.secondary'}
            sx={{
              mt: 0.75,
              fontFamily: prompt ? 'inherit' : 'monospace',
              fontSize: prompt ? '0.875rem' : '0.8125rem',
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
              whiteSpace: prompt ? 'pre-wrap' : 'normal',
              lineHeight: 1.5,
            }}
          >
            {actionNodeDetail(payload)}
          </Typography>
        ) : (
          <Stack spacing={0.75} sx={{ mt: 0.75 }}>
            {nodes.map((n, idx) => {
              const p = n.payload as AgentActionPayload;
              const dMs = durationMsFromEvidence(p.evidence);
              return (
                <Box key={`${n.event.event_id || idx}-${idx}`}>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                      fontFamily: 'monospace',
                      fontSize: '0.8125rem',
                      wordBreak: 'break-word',
                      lineHeight: 1.45,
                    }}
                  >
                    {actionNodeDetail(p)}
                  </Typography>
                  <Typography variant="caption" color="text.disabled">
                    {formatShortDateTime(n.event.ts)}
                    {dMs != null ? ` · ${dMs}ms` : ''}
                  </Typography>
                </Box>
              );
            })}
          </Stack>
        )}

        {payload.operation && !prompt ? (
          <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5, display: 'block' }}>
            {String(payload.operation)}
            {payload.agent_type ? ` · ${payload.agent_type}` : ''}
            {count > 1 ? ` · ${count} calls` : ''}
          </Typography>
        ) : null}
      </Box>
    </Stack>
  );
}

function HostEvidenceCard({ items, isLast }: { items: HostEvidenceItem[]; isLast: boolean }) {
  const theme = useTheme();
  const primary = items[0];
  const count = items.length;
  const isAlert = primary.kind === 'alert';
  const bridgedCursor = items.some((i) => i.title.includes('IDE bridge'));
  const bridgedMcp = items.some((i) => i.title.includes('MCP bridge'));
  const bridged = bridgedCursor || bridgedMcp;
  const accent = isAlert ? theme.palette.error.main : theme.palette.text.secondary;
  const title =
    count > 1
      ? primary.kind === 'process'
        ? bridged
          ? 'Process starts (IDE bridge)'
          : 'Process starts'
        : primary.kind === 'file'
          ? bridged
            ? 'File activity (IDE bridge)'
            : 'File activity'
          : primary.kind === 'network'
            ? 'Network connections'
            : primary.kind === 'alert'
              ? 'Host alerts'
              : primary.title
      : primary.title;

  return (
    <Stack direction="row" spacing={1.5} sx={{ position: 'relative', pb: isLast ? 0 : 1.75 }}>
      {!isLast ? (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            left: 17,
            top: 36,
            bottom: 0,
            width: 2,
            bgcolor: 'divider',
            borderRadius: 1,
          }}
        />
      ) : null}

      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: accent,
          bgcolor: alpha(accent, isAlert ? 0.1 : 0.06),
          border: `1.5px solid ${alpha(accent, isAlert ? 0.45 : 0.25)}`,
          zIndex: 1,
        }}
      >
        <HostIcon kind={primary.kind} />
      </Box>

      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          border: '1px solid',
          borderColor: isAlert ? alpha(theme.palette.error.main, 0.45) : 'divider',
          borderRadius: 1.5,
          px: 1.5,
          py: 1.25,
          bgcolor: isAlert ? alpha(theme.palette.error.main, 0.05) : 'background.paper',
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          {count > 1 ? (
            <Chip size="small" label={`×${count}`} variant="outlined" sx={{ height: 22 }} />
          ) : null}
          <Typography variant="caption" color="text.secondary">
            {count > 1 && items[0].ts !== items[items.length - 1].ts
              ? `${formatShortDateTime(items[0].ts)} → ${formatShortDateTime(items[items.length - 1].ts)}`
              : formatShortDateTime(primary.ts)}
          </Typography>
          <Chip
            size="small"
            label={primary.kind}
            color={isAlert ? 'error' : 'default'}
            variant="outlined"
            sx={{ height: 22 }}
          />
          {primary.severity ? (
            <Chip size="small" label={primary.severity} color="warning" variant="outlined" sx={{ height: 22 }} />
          ) : null}
        </Stack>

        {count === 1 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.75, fontFamily: 'monospace', fontSize: '0.8125rem', wordBreak: 'break-word' }}
          >
            {primary.detail}
          </Typography>
        ) : (
          <Stack spacing={0.75} sx={{ mt: 0.75 }}>
            {items.map((item, idx) => (
              <Box key={`${item.eventId || item.detail}-${idx}`}>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ fontFamily: 'monospace', fontSize: '0.8125rem', wordBreak: 'break-word' }}
                >
                  {item.detail}
                </Typography>
                <Typography variant="caption" color="text.disabled">
                  {item.title !== title ? `${item.title} · ` : ''}
                  {formatShortDateTime(item.ts)}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}

        <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5, display: 'block' }}>
          {bridgedMcp
            ? 'logical host evidence bridged from MCP gateway (Docker stdio MCP often hides real egress)'
            : bridgedCursor
              ? 'host evidence bridged from Cursor hooks (OS poll often misses short-lived tools)'
              : 'host telemetry'}
        </Typography>
      </Box>
    </Stack>
  );
}

function TurnCard({ turn, turnIndex }: { turn: AgentActionTurnWithHost; turnIndex: number }) {
  const theme = useTheme();
  const asked = turn.prompt;
  const happened = turn.tools;
  const host = turn.hostEvidence || [];
  const toolCount = happened.length;
  const hasHighRisk =
    (asked ? isHighRiskAction(asked.payload) : false) ||
    happened.some((n) => isHighRiskAction(n.payload)) ||
    host.some((h) => h.kind === 'alert');

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        borderRadius: 2,
        bgcolor: alpha(theme.palette.background.default, 0.6),
        borderColor: hasHighRisk ? alpha(theme.palette.error.main, 0.45) : undefined,
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.2, fontWeight: 700 }}>
          Turn {turnIndex + 1}
        </Typography>
        <Stack direction="row" spacing={0.75} alignItems="center" flexShrink={0}>
          {host.some((h) => h.kind === 'alert') ? (
            <Chip size="small" label="Host alert" color="error" variant="outlined" />
          ) : null}
          <Chip
            size="small"
            label={toolCount === 1 ? '1 tool' : `${toolCount} tools`}
            variant="outlined"
            color={hasHighRisk ? 'error' : 'default'}
          />
        </Stack>
      </Stack>

      <Stack spacing={2}>
        <Box>
          <Typography
            variant="caption"
            sx={{ fontWeight: 700, color: 'primary.main', letterSpacing: 0.4, display: 'block', mb: 1 }}
          >
            {AGENT_ACTION_SECTION_USER_PROMPT}
          </Typography>
          {asked ? (
            <ActionNodeCard nodes={[asked]} isLast />
          ) : (
            <Typography variant="body2" color="text.secondary">
              No prompt captured for this turn (tools only).
            </Typography>
          )}
        </Box>

        <Box>
          <Typography
            variant="caption"
            sx={{ fontWeight: 700, color: 'text.secondary', letterSpacing: 0.4, display: 'block', mb: 1 }}
          >
            {AGENT_ACTION_SECTION_AGENT_EXECUTION}
          </Typography>
          {happened.length ? (
            <Stack spacing={0}>
              {mergeConsecutiveTools(happened).map((group, idx, arr) => (
                <ActionNodeCard
                  key={`${group.nodes[0].event.event_id || idx}-g${idx}`}
                  nodes={group.nodes}
                  isLast={idx === arr.length - 1}
                />
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No tools recorded after this prompt yet.
            </Typography>
          )}
        </Box>

        <Box>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography
              variant="caption"
              sx={{ fontWeight: 700, color: 'error.main', letterSpacing: 0.4 }}
            >
              {AGENT_ACTION_SECTION_EFFECTIVE_CORROBORATION}
            </Typography>
            <Chip
              size="small"
              label={host.length ? 'observed' : 'none'}
              color={host.length ? 'success' : 'default'}
              variant="outlined"
              sx={{ height: 20, fontSize: '0.65rem' }}
            />
          </Stack>
          {host.length ? (
            <Stack spacing={0}>
              {mergeConsecutiveHostEvidence(host).map((group, idx, arr) => (
                <HostEvidenceCard
                  key={`${group.items[0].eventId || group.items[0].title}-g${idx}`}
                  items={group.items}
                  isLast={idx === arr.length - 1}
                />
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {hostEvidenceEmptyMessage(turn)}
            </Typography>
          )}
        </Box>
      </Stack>
    </Paper>
  );
}

export default function AgentActionTreeView({ sessions }: { sessions: AgentActionSessionWithHost[] }) {
  return (
    <Stack spacing={2.5}>
      {sessions.map((session) => (
        <Box key={session.sessionId}>
          {sessions.length > 1 ? (
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, mb: 1, display: 'block' }}>
              Conversation · {session.sessionId.slice(0, 16)}
              {session.sessionId.length > 16 ? '…' : ''}
            </Typography>
          ) : null}

          <Stack spacing={2}>
            {session.turns.map((turn, idx) => (
              <Box key={`${session.sessionId}-${turn.turnId}-${idx}`}>
                {idx > 0 ? <Divider sx={{ mb: 2 }} /> : null}
                <TurnCard turn={turn} turnIndex={idx} />
              </Box>
            ))}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}
