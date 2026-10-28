import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Paper from '@mui/material/Paper';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Collapse from '@mui/material/Collapse';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CodeIcon from '@mui/icons-material/Code';
import { useMemo, useState, type MouseEvent } from 'react';
import { twinApi } from '../features/twin/config/api';
import { useSecurityAlerts } from '../features/twin/hooks/useSecurityAlerts';
import { SecurityAlert } from '../features/twin/types/securityAlert';
import { formatShortDateTime } from '../shared/utils/dateUtils';

const SEVERITY_COLOR: Record<string, 'error' | 'warning' | 'info' | 'default'> = {
  high: 'error',
  medium: 'warning',
  low: 'info',
};

const TYPE_LABEL: Record<string, string> = {
  temp_path_execution: 'Temp path execution',
  shell_spawns_downloader: 'Shell spawned downloader',
  ai_tool_execution: 'AI tool started',
  shell_spawns_ai_tool: 'Shell spawned AI tool',
  ai_terminal_tool_chain: 'AI terminal tool chain',
  ai_shell_network_exfil: 'AI shell network activity',
  ai_secrets_access: 'AI secrets access',
  ai_secrets_git_push: 'AI secrets git push',
  ai_cloud_cli_from_agent: 'AI cloud CLI',
  ai_container_build_deploy: 'AI container deploy',
  ai_multi_tool_burst: 'AI multi-tool burst',
  ai_sensitive_mcp_ungoverned_egress: 'Sensitive MCP then ungoverned egress',
  ai_novel_cursor_tool: 'Novel Cursor tool',
  script_spawns_shell: 'Script spawned shell',
  binary_path_mismatch: 'Binary path mismatch',
  novel_process: 'Novel process',
  dropper_behavior: 'Dropper behavior',
  persistence_with_network: 'Persistence with network',
  elevated_process_risk: 'Elevated process risk',
  process_network_activity: 'Process network activity',
  new_public_ip: 'New public IP',
  network_type_change: 'Network type change',
  network_change_while_active: 'Network change while active',
  simultaneous_ip_and_type_change: 'IP and type change',
  rapid_public_ip_changes: 'Rapid public IP changes',
  double_ip_change_10m: 'Double IP change',
  network_type_flapping: 'Network type flapping',
  network_flap_5m: 'Network flap',
  active_ip_churn: 'Active IP churn',
  driver_load: 'Driver loaded',
  service_install: 'Service installed',
  registry_persistence: 'Persistence artifact',
};

const AI_ALERT_TYPES = new Set([
  'ai_tool_execution',
  'shell_spawns_ai_tool',
  'ai_terminal_tool_chain',
  'ai_shell_network_exfil',
  'ai_secrets_access',
  'ai_secrets_git_push',
  'ai_cloud_cli_from_agent',
  'ai_container_build_deploy',
  'ai_multi_tool_burst',
  'ai_sensitive_mcp_ungoverned_egress',
  'ai_novel_cursor_tool',
]);

type CategoryFilter = 'all' | 'ai' | 'process' | 'network';
type SeverityFilter = 'all' | 'high' | 'medium' | 'low';

function alertCategory(alertType: string): Exclude<CategoryFilter, 'all'> {
  if (AI_ALERT_TYPES.has(alertType) || alertType.startsWith('ai_')) return 'ai';
  if (
    alertType.includes('network') ||
    alertType.includes('ip_') ||
    alertType.includes('_ip') ||
    alertType === 'active_ip_churn' ||
    alertType === 'missing_network_telemetry' ||
    alertType === 'idle_with_network_activity' ||
    alertType === 'stale_client_details' ||
    alertType === 'repeated_network_summary' ||
    alertType === 'established_count_spike' ||
    alertType === 'listening_port_spike' ||
    alertType === 'foreground_connections_spike' ||
    alertType === 'high_listening_while_active'
  ) {
    return 'network';
  }
  return 'process';
}

function isAiAlert(alertType: string): boolean {
  return AI_ALERT_TYPES.has(alertType) || alertType.startsWith('ai_');
}

const DETAIL_LABELS: Record<string, string> = {
  git_cmdline: 'Git command',
  secrets: 'Secrets',
  cursor_pid: 'Cursor PID',
  git_pid: 'Git PID',
  parent_comm: 'Parent',
  child_comm: 'Child',
  parent_pid: 'Parent PID',
  child_pid: 'Child PID',
  parent_cmdline: 'Parent command',
  child_cmdline: 'Child command',
  cmdline: 'Command',
  executable: 'Executable',
  comm: 'Process',
  pid: 'PID',
  from: 'From',
  to: 'To',
  from_ip: 'From IP',
  to_ip: 'To IP',
  from_type: 'From type',
  to_type: 'To type',
  ips: 'IPs',
  changes: 'Changes',
  count: 'Count',
  window_minutes: 'Window (min)',
  presence: 'Presence',
  listening_count: 'Listening ports',
  network_events: 'Network events',
  sample_limit: 'Sample size',
  top_comms: 'Top processes',
  processes: 'Recent processes',
  name: 'Name',
  display_name: 'Display name',
  state: 'State',
  status: 'Status',
  path: 'Path',
  service_type: 'Service type',
  start_mode: 'Start mode',
  account: 'Account',
  program: 'Program',
  hive: 'Hive',
  key_path: 'Key path',
  value_name: 'Value name',
  value: 'Value',
  version: 'Version',
  finding_type: 'Finding',
  governed_mcp: 'Governed MCP',
  ungoverned_runtime: 'Ungoverned runtime',
  claim: 'Claim',
  not_claimed: 'Not claimed',
  engine: 'Engine',
};

type AlertDetail = Record<string, unknown>;

function parseDetail(raw?: string | null): AlertDetail | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as AlertDetail;
    }
  } catch {
    return null;
  }
  return null;
}

function formatDetailValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (value == null) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function CmdlineBlock({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        component="pre"
        sx={{
          m: 0,
          mt: 0.25,
          p: 1,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: '0.75rem',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          bgcolor: 'background.paper',
          borderRadius: 1,
          border: 1,
          borderColor: 'divider',
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function uniqueSecretPaths(paths: string[]): string[] {
  const ordered = [...new Set(paths.map((p) => p.trim()).filter(Boolean))];
  const full = ordered.filter((p) => p.includes('/') || p.startsWith('~'));
  const bare = ordered.filter((p) => !full.includes(p));
  const out = [...full];
  for (const b of bare) {
    const covered = out.some((f) => f === b || f.endsWith(`/${b}`) || f.endsWith(b));
    if (!covered) out.push(b);
  }
  return out;
}

function secretsFromDetail(detail: AlertDetail | null): string[] {
  if (!detail) return [];
  return uniqueSecretPaths(
    Array.isArray(detail.secrets)
      ? detail.secrets.map((s) => String(s))
      : detail.secret_path != null
        ? [String(detail.secret_path)]
        : [],
  );
}

function friendlyAlertTitle(alert: SecurityAlert, detail: AlertDetail | null, fallbackLabel: string): string {
  if (alert.alert_type === 'ai_secrets_git_push') {
    const app = String(detail?.parent_comm || detail?.app_name || 'An AI app');
    const secret = secretsFromDetail(detail)[0] || 'a secret file';
    return `${app} accessed ${secret} and tried to push it with git`;
  }
  if (alert.alert_type === 'ai_sensitive_mcp_ungoverned_egress') {
    const mcp = detail?.governed_mcp as Record<string, unknown> | undefined;
    const runtime = detail?.ungoverned_runtime as Record<string, unknown> | undefined;
    const tool = mcp?.tool != null ? String(mcp.tool) : 'an MCP tool';
    const server = mcp?.server != null ? String(mcp.server) : 'MCP';
    const dest = runtime?.destination != null ? String(runtime.destination) : 'an external host';
    return `Sensitive ${server}/${tool} followed by ungoverned egress to ${dest}`;
  }
  return alert.message || fallbackLabel;
}

function FriendlyAlertSummary({
  alert,
  detail,
}: {
  alert: SecurityAlert;
  detail: AlertDetail | null;
}) {
  const secrets = secretsFromDetail(detail);
  const parent = detail?.parent_comm != null ? String(detail.parent_comm) : null;
  const child = detail?.child_comm != null ? String(detail.child_comm) : null;
  const isSecretsPush = alert.alert_type === 'ai_secrets_git_push' || (secrets.length > 0 && Boolean(child));

  if (alert.alert_type === 'ai_sensitive_mcp_ungoverned_egress') {
    const mcp = (detail?.governed_mcp || {}) as Record<string, unknown>;
    const runtime = (detail?.ungoverned_runtime || {}) as Record<string, unknown>;
    const server = mcp.server != null ? String(mcp.server) : 'MCP';
    const tool = mcp.tool != null ? String(mcp.tool) : 'tool';
    const dest = runtime.destination != null ? String(runtime.destination) : 'external host';
    const proc = runtime.process != null ? String(runtime.process) : 'process';
    const steps = [
      { label: 'Governed MCP', value: `${server}/${tool}` },
      { label: 'Ungoverned', value: `${proc} → ${dest}` },
    ];
    return (
      <Stack spacing={1.25}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          What happened
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
          An AI agent read sensitive data through an approved MCP tool, then made ungoverned
          external network contact. This is a potential sensitive-data exfiltration path
          (correlation — not proof that data was transferred).
        </Typography>
        <Stack direction="row" spacing={1} alignItems="stretch" flexWrap="wrap" useFlexGap>
          {steps.map((step, idx) => (
            <Stack key={step.label} direction="row" spacing={1} alignItems="center">
              {idx > 0 ? <ArrowForwardIcon fontSize="small" color="action" /> : null}
              <Box
                sx={{
                  px: 1.25,
                  py: 0.75,
                  minWidth: 0,
                  maxWidth: 280,
                  borderRadius: 1,
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 0.25, fontWeight: 600 }}
                >
                  {step.label}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 600,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontSize: '0.75rem',
                    wordBreak: 'break-word',
                  }}
                >
                  {step.value}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Stack>
      </Stack>
    );
  }

  if (isSecretsPush) {
    const app = parent || String(detail?.app_name || 'AI app');
    const secret = secrets[0] || 'a secret file';
    const steps = [
      { label: 'AI app', value: app },
      { label: 'Secret accessed', value: secret },
      { label: 'Action', value: 'Tried to git push' },
    ];
    return (
      <Stack spacing={1.25}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          What happened
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
          {app} opened a sensitive file, then ran a git push that looked like it was trying to
          include that secret.
        </Typography>
        <Stack direction="row" spacing={1} alignItems="stretch" flexWrap="wrap" useFlexGap>
          {steps.map((step, idx) => (
            <Stack key={step.label} direction="row" spacing={1} alignItems="center">
              {idx > 0 ? <ArrowForwardIcon fontSize="small" color="action" /> : null}
              <Box
                sx={{
                  px: 1.25,
                  py: 0.75,
                  minWidth: 0,
                  maxWidth: 260,
                  borderRadius: 1,
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 0.25, fontWeight: 600 }}
                >
                  {step.label}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 600,
                    fontFamily:
                      idx === 1
                        ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
                        : 'inherit',
                    fontSize: idx === 1 ? '0.75rem' : undefined,
                    wordBreak: 'break-word',
                  }}
                >
                  {step.value}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Stack>
      </Stack>
    );
  }

  // Generic friendly fallback for other alerts with a process chain.
  if (parent && child) {
    return (
      <Stack spacing={1}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          What happened
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {parent} → {child}
        </Typography>
        {alert.message ? (
          <Typography variant="body2" color="text.secondary">
            {alert.message}
          </Typography>
        ) : null}
      </Stack>
    );
  }

  if (alert.message) {
    return (
      <Stack spacing={0.75}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          What happened
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {alert.message}
        </Typography>
      </Stack>
    );
  }

  return null;
}

function TechnicalDetailsPanel({
  alert,
  detail,
}: {
  alert: SecurityAlert;
  detail: AlertDetail | null;
}) {
  const parent = detail?.parent_comm != null ? String(detail.parent_comm) : null;
  const child = detail?.child_comm != null ? String(detail.child_comm) : null;
  const parentCmd = detail?.parent_cmdline != null ? String(detail.parent_cmdline).trim() : '';
  const childCmd = detail?.child_cmdline != null ? String(detail.child_cmdline).trim() : '';
  const singleCmd = detail?.cmdline != null ? String(detail.cmdline).trim() : '';
  const secrets = secretsFromDetail(detail);
  const isSecretsPush = secrets.length > 0 && Boolean(child);

  return (
    <Stack spacing={1.5}>
      {(parent || child) && (
        <Stack spacing={0.75}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            Process chain
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            {parent ? (
              <Chip
                label={`${parent}${detail?.parent_pid != null ? ` (pid ${detail.parent_pid})` : ''}`}
                size="small"
                variant="outlined"
              />
            ) : null}
            {parent && child ? <ArrowForwardIcon fontSize="small" color="action" /> : null}
            {secrets[0] ? (
              <>
                <Chip label={secrets[0]} size="small" color="error" variant="outlined" />
                <ArrowForwardIcon fontSize="small" color="action" />
              </>
            ) : null}
            {child ? (
              <Chip
                label={`${child}${detail?.child_pid != null ? ` (pid ${detail.child_pid})` : ''}`}
                size="small"
                color="warning"
                variant="outlined"
              />
            ) : null}
          </Stack>
        </Stack>
      )}
      {parentCmd ? (
        <CmdlineBlock label={isSecretsPush ? 'Cursor executable' : 'Parent command'} value={parentCmd} />
      ) : null}
      {childCmd ? (
        <CmdlineBlock label={isSecretsPush ? 'Git command' : 'Child command'} value={childCmd} />
      ) : null}
      {!parentCmd && !childCmd && singleCmd ? <CmdlineBlock label="Command" value={singleCmd} /> : null}
      <AlertMetadata alert={alert} />
      {detail ? <SourceEventView detail={detail} /> : null}
      {detail ? <ProcessContextView detail={detail} /> : null}
      {detail ? <DetailFields detail={detail} /> : null}
    </Stack>
  );
}

type ProcessSample = {
  eventId: string;
  pid: string;
  ppid: string | null;
  comm: string;
  parentComm: string;
  executable: string;
  cmdline: string;
  startedAt: string;
  role: string;
};

type NetworkConnectionSample = {
  pid: string;
  remoteAddr: string;
  remotePort: string;
  protocol: string;
  direction: string;
  timestamp: string;
};

function processSampleFromUnknown(item: unknown): ProcessSample {
  const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
  return {
    eventId: row.event_id != null ? String(row.event_id) : '',
    pid: row.pid != null ? String(row.pid) : '?',
    ppid: row.ppid != null ? String(row.ppid) : null,
    comm: row.comm != null ? String(row.comm) : 'unknown',
    parentComm: row.parent_comm != null ? String(row.parent_comm) : '',
    executable: row.executable != null ? String(row.executable).trim() : '',
    cmdline: row.cmdline != null ? String(row.cmdline).trim() : '',
    startedAt: row.started_at != null ? String(row.started_at) : '',
    role: row.role != null ? String(row.role) : 'context',
  };
}

function networkConnectionFromUnknown(item: unknown): NetworkConnectionSample | null {
  const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
  const remoteAddr = row.remote_addr != null ? String(row.remote_addr).trim() : '';
  const remotePort = row.remote_port != null ? String(row.remote_port) : '';
  if (!remoteAddr && !remotePort) return null;
  return {
    pid: row.pid != null ? String(row.pid) : '?',
    remoteAddr: remoteAddr || 'unknown',
    remotePort,
    protocol: row.protocol != null ? String(row.protocol) : '',
    direction: row.direction != null ? String(row.direction) : '',
    timestamp: row.timestamp != null ? String(row.timestamp) : '',
  };
}

function processRowsForGraph(rows: ProcessSample[], selectedComm: string | null): ProcessSample[] {
  if (!selectedComm) return rows;
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const keep = new Set<string>();
  for (const row of rows) {
    if (row.comm !== selectedComm) continue;
    let current: ProcessSample | undefined = row;
    while (current && !keep.has(current.pid)) {
      keep.add(current.pid);
      current = current.ppid ? byPid.get(current.ppid) : undefined;
    }
  }
  return rows.filter((row) => keep.has(row.pid));
}

/** Walk ppid links from the trigger up to the root — the causal execution chain. */
function buildExecutionChain(rows: ProcessSample[]): ProcessSample[] {
  if (rows.length === 0) return [];
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const trigger = rows.find((row) => row.role === 'trigger') || rows[rows.length - 1];
  const chain: ProcessSample[] = [];
  const seen = new Set<string>();
  let current: ProcessSample | undefined = trigger;
  while (current && !seen.has(current.pid)) {
    seen.add(current.pid);
    chain.push(current);
    current = current.ppid ? byPid.get(current.ppid) : undefined;
  }
  return chain.reverse();
}

/** Best available name for a parent PID that was not itself sampled. */
function syntheticParentLabel(ppid: string, rows: ProcessSample[]): string {
  const votes = new Map<string, number>();
  for (const row of rows) {
    if (row.ppid !== ppid || !row.parentComm) continue;
    const name = row.parentComm.trim();
    if (!name) continue;
    votes.set(name, (votes.get(name) || 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [name, count] of votes) {
    if (count > bestCount || (count === bestCount && name.localeCompare(best) < 0)) {
      best = name;
      bestCount = count;
    }
  }
  if (best) return best;
  // PID 1 is the system init process on Unix-like hosts (launchd / systemd / init).
  if (ppid === '1') return 'launchd';
  return `pid ${ppid}`;
}

type GraphGroup = {
  id: string;
  kind: 'process' | 'network';
  /** Display label shown in the node header (cmdline / name). */
  comm: string;
  pids: string[];
  triggerPids: string[];
  synthetic: boolean;
  depth: number;
  row: number;
  x: number;
  y: number;
  height: number;
  subtitle?: string;
};

const NODE_W = 280;
const H_GAP = 48;
const V_GAP = 14;
const HEADER_H = 18;
const PID_LINE_H = 12;
const NODE_PAD = 8;
const MAX_PIDS_SHOWN = 8;
const MAX_NETWORK_NODES = 8;
const MAX_LABEL_CHARS = 42;

function groupNodeHeight(pidCount: number, hasSubtitle = false): number {
  const shown = Math.min(pidCount, MAX_PIDS_SHOWN) + (pidCount > MAX_PIDS_SHOWN ? 1 : 0);
  const subtitleLines = hasSubtitle ? 1 : 0;
  return HEADER_H + (shown + subtitleLines) * PID_LINE_H + NODE_PAD;
}

function truncateLabel(label: string, max = MAX_LABEL_CHARS): string {
  const text = (label || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** Prefer cmdline, then executable basename, then comm — for graph node titles. */
function processDisplayName(row: ProcessSample): string {
  const cmd = row.cmdline.trim();
  if (cmd) {
    // "Cursor Helper (Plugin): extension-host (agent-exec) Unified Agent [9-172]"
    const helperMatch = cmd.match(
      /^(?:Cursor|Code|Windsurf|Claude)\s+Helper[^:]*:\s*(.+)$/i,
    );
    if (helperMatch) {
      const role = helperMatch[1].trim();
      // Drop trailing workspace / bracket noise for a tighter label
      const short = role
        .replace(/\s+Unified Agent\s*\[[^\]]*\]\s*$/i, '')
        .replace(/\s*\[[^\]]*\]\s*$/i, '')
        .trim();
      const app = (row.comm || 'Helper').trim() || 'Helper';
      return short ? `${app}: ${short}` : cmd;
    }
    return cmd;
  }
  const executable = row.executable.trim();
  if (executable) {
    const parts = executable.split(/[/\\]/);
    return parts[parts.length - 1] || executable;
  }
  return row.comm || 'unknown';
}

function networkLabel(conn: NetworkConnectionSample): string {
  const host = conn.remoteAddr || 'unknown';
  const port = conn.remotePort ? `:${conn.remotePort}` : '';
  const proto = conn.protocol ? `${conn.protocol} ` : '';
  return `${proto}${host}${port}`;
}

function buildProcessGraph(
  rows: ProcessSample[],
  connections: NetworkConnectionSample[] = [],
): {
  nodes: GraphGroup[];
  edges: Array<{ from: GraphGroup; to: GraphGroup }>;
  width: number;
  height: number;
} {
  const groups = new Map<string, GraphGroup>();
  const pidToGroup = new Map<string, string>();

  const ensureGroup = (
    id: string,
    label: string,
    synthetic: boolean,
    kind: 'process' | 'network' = 'process',
  ) => {
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        kind,
        comm: label,
        pids: [],
        triggerPids: [],
        synthetic,
        depth: 0,
        row: 0,
        x: 0,
        y: 0,
        height: groupNodeHeight(0),
      };
      groups.set(id, group);
    } else if (!synthetic && group.synthetic && kind === 'process') {
      group.synthetic = false;
      group.comm = label;
    }
    return group;
  };

  // One node per process so distinct helpers (extension-host, fileWatcher, …) keep their names.
  for (const r of rows) {
    const id = `pid:${r.pid}`;
    const group = ensureGroup(id, processDisplayName(r), false);
    if (!group.pids.includes(r.pid)) group.pids.push(r.pid);
    if (r.role === 'trigger' && !group.triggerPids.includes(r.pid)) group.triggerPids.push(r.pid);
    pidToGroup.set(r.pid, id);
  }

  // Synthesize missing parents as their own groups so edges still exist.
  for (const r of rows) {
    if (!r.ppid || pidToGroup.has(r.ppid)) continue;
    const id = `parent:${r.ppid}`;
    const group = ensureGroup(id, syntheticParentLabel(r.ppid, rows), true);
    if (!group.pids.includes(r.ppid)) group.pids.push(r.ppid);
    pidToGroup.set(r.ppid, id);
  }

  for (const group of groups.values()) {
    group.pids.sort((a, b) => Number(a) - Number(b));
    group.height = groupNodeHeight(group.pids.length, Boolean(group.subtitle));
  }

  const edgeKeys = new Set<string>();
  const childrenByParent = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.ppid) continue;
    const parentId = pidToGroup.get(r.ppid);
    const childId = pidToGroup.get(r.pid);
    if (!parentId || !childId || parentId === childId) continue;
    const key = `${parentId}->${childId}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    const list = childrenByParent.get(parentId) || [];
    list.push(childId);
    childrenByParent.set(parentId, list);
  }

  // Attach network endpoints as child nodes of the owning process.
  const limitedConnections = connections.slice(0, MAX_NETWORK_NODES);
  for (const conn of limitedConnections) {
    const parentId = pidToGroup.get(conn.pid);
    if (!parentId) continue;
    const label = networkLabel(conn);
    const id = `net:${conn.pid}:${conn.remoteAddr}:${conn.remotePort}:${conn.protocol}`;
    if (groups.has(id)) continue;
    const group = ensureGroup(id, label, false, 'network');
    group.subtitle = conn.direction || 'network';
    group.height = groupNodeHeight(1, true);    group.pids = [conn.remotePort || '0'];
    const key = `${parentId}->${id}`;
    if (!edgeKeys.has(key)) {
      edgeKeys.add(key);
      const list = childrenByParent.get(parentId) || [];
      list.push(id);
      childrenByParent.set(parentId, list);
    }
  }

  const childIds = new Set<string>();
  for (const children of childrenByParent.values()) {
    for (const id of children) childIds.add(id);
  }
  const roots = Array.from(groups.keys())
    .filter((id) => !childIds.has(id))
    .sort((a, b) => a.localeCompare(b));

  let maxDepth = 0;
  const visited = new Set<string>();
  const order: string[] = [];
  const walk = (id: string, depth: number) => {
    if (visited.has(id)) return;
    visited.add(id);
    const group = groups.get(id);
    if (!group) return;
    group.depth = depth;
    maxDepth = Math.max(maxDepth, depth);
    order.push(id);
    for (const childId of childrenByParent.get(id) || []) walk(childId, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  for (const id of groups.keys()) {
    if (!visited.has(id)) walk(id, 0);
  }

  const byDepth = new Map<number, GraphGroup[]>();
  for (const id of order) {
    const group = groups.get(id);
    if (!group) continue;
    const list = byDepth.get(group.depth) || [];
    list.push(group);
    byDepth.set(group.depth, list);
  }

  let maxHeight = 0;
  for (const [depth, list] of byDepth) {
    let y = 0;
    for (const group of list) {
      group.x = depth * (NODE_W + H_GAP);
      group.y = y;
      y += group.height + V_GAP;
    }
    maxHeight = Math.max(maxHeight, y - V_GAP);
  }

  const edges: Array<{ from: GraphGroup; to: GraphGroup }> = [];
  for (const key of edgeKeys) {
    const [fromId, toId] = key.split('->');
    const from = groups.get(fromId);
    const to = groups.get(toId);
    if (from && to) edges.push({ from, to });
  }

  const width = (maxDepth + 1) * NODE_W + maxDepth * H_GAP;
  const height = Math.max(maxHeight, groupNodeHeight(1));
  return { nodes: Array.from(groups.values()), edges, width, height };
}

function ProcessGraphView({
  rows,
  connections,
  selectedComm,
}: {
  rows: ProcessSample[];
  connections: NetworkConnectionSample[];
  selectedComm: string | null;
}) {
  const graph = useMemo(() => buildProcessGraph(rows, connections), [rows, connections]);
  const chain = useMemo(() => buildExecutionChain(rows), [rows]);
  if (rows.length === 0) return null;
  const { nodes, edges, width, height } = graph;

  return (
    <Box sx={{ mb: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
        Process graph
        {connections.length > 0 ? ' · includes network connections' : ''}
        {selectedComm ? ' (matching processes plus sampled ancestors)' : ' · full spawn tree'}
      </Typography>
      {chain.length > 1 ? (
        <Stack
          direction="row"
          spacing={0.5}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          sx={{ mt: 0.75, mb: 0.5 }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, mr: 0.5 }}>
            Chain
          </Typography>
          {chain.map((row, index) => (
            <Stack key={`${row.pid}-chain`} direction="row" spacing={0.5} alignItems="center">
              {index > 0 ? (
                <Typography variant="caption" color="text.secondary">
                  →
                </Typography>
              ) : null}
              <Chip
                size="small"
                color={row.role === 'trigger' ? 'error' : 'default'}
                variant={row.role === 'trigger' ? 'filled' : 'outlined'}
                label={truncateLabel(processDisplayName(row), 36)}
                title={processDisplayName(row)}
                sx={{
                  maxWidth: 280,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: '0.7rem',
                }}
              />
            </Stack>
          ))}
        </Stack>
      ) : null}
      <Box
        sx={{
          mt: 0.5,
          p: 1,
          borderRadius: 1,
          border: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          overflow: 'auto',
          maxHeight: 560,
        }}
      >
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ display: 'block', minWidth: '100%' }}
        >
          {edges.map((edge) => {
            const x1 = edge.from.x + NODE_W;
            const y1 = edge.from.y + edge.from.height / 2;
            const x2 = edge.to.x;
            const y2 = edge.to.y + edge.to.height / 2;
            const midX = (x1 + x2) / 2;
            const isNetwork = edge.to.kind === 'network';
            return (
              <path
                key={`${edge.from.id}->${edge.to.id}`}
                d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={isNetwork ? '#0288d1' : 'currentColor'}
                strokeOpacity={isNetwork ? 0.65 : 0.35}
                strokeWidth={1.5}
                strokeDasharray={isNetwork ? '5 3' : undefined}
              />
            );
          })}
          {nodes.map((node) => {
            const isNetwork = node.kind === 'network';
            const selected =
              !node.synthetic &&
              !isNetwork &&
              Boolean(selectedComm) &&
              rows.some((r) => node.pids.includes(r.pid) && r.comm === selectedComm);
            const triggered = node.triggerPids.length > 0;
            const shown = isNetwork ? [] : node.pids.slice(0, MAX_PIDS_SHOWN);
            const hidden = isNetwork ? 0 : node.pids.length - shown.length;
            const title = truncateLabel(node.comm);
            return (
              <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
                <title>{node.comm}</title>
                <rect
                  width={NODE_W}
                  height={node.height}
                  rx={6}
                  ry={6}
                  fill={
                    isNetwork
                      ? 'rgba(2, 136, 209, 0.12)'
                      : triggered
                        ? 'rgba(211, 47, 47, 0.14)'
                        : selected
                          ? 'rgba(237, 108, 2, 0.16)'
                          : 'transparent'
                  }
                  stroke={isNetwork ? '#0288d1' : triggered ? '#d32f2f' : 'currentColor'}
                  strokeOpacity={node.synthetic ? 0.4 : 0.75}
                  strokeDasharray={isNetwork || node.synthetic ? '4 3' : undefined}
                  strokeWidth={triggered || selected || isNetwork ? 2 : 1}
                />
                <text
                  x={8}
                  y={14}
                  fontSize={10}
                  fontWeight={600}
                  fill="currentColor"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                >
                  {title}
                  {!isNetwork && triggered ? ' · source' : ''}
                </text>
                {isNetwork ? (
                  <text
                    x={8}
                    y={HEADER_H + PID_LINE_H}
                    fontSize={10}
                    fill="currentColor"
                    fillOpacity={0.7}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                  >
                    {node.subtitle || 'connection'}
                  </text>
                ) : (
                  <>
                    {shown.map((pid, index) => (
                      <text
                        key={pid}
                        x={8}
                        y={HEADER_H + (index + 1) * PID_LINE_H}
                        fontSize={10}
                        fill="currentColor"
                        fillOpacity={0.7}
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                      >
                        {node.synthetic
                          ? `pid ${pid} · parent`
                          : `pid ${pid}${node.triggerPids.includes(pid) ? ' · source' : ''}`}
                      </text>
                    ))}
                    {hidden > 0 ? (
                      <text
                        x={8}
                        y={HEADER_H + (shown.length + 1) * PID_LINE_H}
                        fontSize={10}
                        fill="currentColor"
                        fillOpacity={0.55}
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                      >
                        +{hidden} more
                      </text>
                    ) : null}
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </Box>
    </Box>
  );
}

function SourceEventView({ detail }: { detail: AlertDetail }) {
  const raw = detail.source_event;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const type = source.type != null ? String(source.type) : '';
  const timestamp = source.timestamp != null ? String(source.timestamp) : '';
  const eventId = source.event_id != null ? String(source.event_id) : '';
  if (!type && !timestamp && !eventId) return null;

  return (
    <Stack spacing={0.5}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
        Source event
      </Typography>
      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
        {type ? <Chip label={type} size="small" color="error" variant="outlined" /> : null}
        {timestamp ? <Chip label={formatShortDateTime(timestamp)} size="small" variant="outlined" /> : null}
        {eventId ? (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
          >
            {eventId}
          </Typography>
        ) : null}
      </Stack>
    </Stack>
  );
}

function ProcessContextView({ detail }: { detail: AlertDetail }) {
  const processes = Array.isArray(detail.processes) ? detail.processes : [];
  const topComms = Array.isArray(detail.top_comms) ? detail.top_comms : [];
  const networkConnections = Array.isArray(detail.network_connections)
    ? detail.network_connections
        .map(networkConnectionFromUnknown)
        .filter((item): item is NetworkConnectionSample => item != null)
    : [];
  const [selectedComm, setSelectedComm] = useState<string | null>(null);
  if (processes.length === 0 && topComms.length === 0) return null;

  const processRows = processes.map(processSampleFromUnknown);
  const visibleProcesses = selectedComm ? processRows.filter((row) => row.comm === selectedComm) : processRows;
  const graphProcesses = processRowsForGraph(processRows, selectedComm);
  const graphConnections = selectedComm
    ? networkConnections.filter((conn) =>
        graphProcesses.some((row) => row.pid === conn.pid),
      )
    : networkConnections;
  const contextKind = detail.process_context_kind != null ? String(detail.process_context_kind) : '';
  const processSummary =
    contextKind === 'ancestry' || contextKind === 'session' || contextKind === 'process_state'
      ? ` (${visibleProcesses.length} related process${visibleProcesses.length === 1 ? '' : 'es'})`
      : detail.count != null
        ? ` (showing ${visibleProcesses.length} of ${String(detail.count)})`
        : ` (${visibleProcesses.length})`;

  return (
    <Stack spacing={1}>
      {topComms.length > 0 ? (
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            Top processes
            {selectedComm ? ` · filtered to ${selectedComm}` : ' · click to filter'}
          </Typography>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
            {topComms.map((item, index) => {
              const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
              const comm = row.comm != null ? String(row.comm) : 'unknown';
              const count = row.count != null ? String(row.count) : '?';
              const selected = selectedComm === comm;
              return (
                <Chip
                  key={`${comm}-${index}`}
                  label={`${comm} ×${count}`}
                  size="small"
                  clickable
                  color={selected ? 'warning' : 'default'}
                  variant={selected ? 'filled' : 'outlined'}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedComm((current) => (current === comm ? null : comm));
                  }}
                  onDelete={
                    selected
                      ? (event) => {
                          event.stopPropagation();
                          setSelectedComm(null);
                        }
                      : undefined
                  }
                />
              );
            })}
          </Stack>
        </Box>
      ) : null}
      {processes.length > 0 ? (
        <Box>
          <ProcessGraphView
            rows={graphProcesses}
            connections={graphConnections}
            selectedComm={selectedComm}
          />
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            Process timeline
            {selectedComm
              ? ` (showing ${visibleProcesses.length} matching ${selectedComm})`
              : processSummary}
          </Typography>
          <Stack spacing={0.75} sx={{ mt: 0.5 }}>
            {visibleProcesses.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No sampled processes match this filter.
              </Typography>
            ) : (
              visibleProcesses.map((row, index) => {
                return (
                  <Box
                    key={`${row.pid}-${index}`}
                    sx={{
                      p: 1,
                      borderRadius: 1,
                      border: 1,
                      borderColor: 'divider',
                      bgcolor: 'background.paper',
                    }}
                  >
                    <Typography
                      variant="body2"
                      sx={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                      }}
                    >
                      {row.comm}
                      {` (pid ${row.pid}`}
                      {row.ppid
                        ? `, ppid ${row.ppid}${row.parentComm ? ` ${row.parentComm}` : ''}`
                        : ''}
                      {`)`}
                    </Typography>
                    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                      {row.role === 'trigger' ? <Chip label="Source" size="small" color="error" /> : null}
                      {row.startedAt ? (
                        <Typography variant="caption" color="text.secondary">
                          {formatShortDateTime(row.startedAt)}
                        </Typography>
                      ) : null}
                    </Stack>
                    {row.executable ? (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{
                          display: 'block',
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        }}
                      >
                        {row.executable}
                      </Typography>
                    ) : null}
                    {row.cmdline ? (
                      <Typography
                        variant="caption"
                        component="pre"
                        sx={{
                          m: 0,
                          mt: 0.5,
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                          fontSize: '0.7rem',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {row.cmdline}
                      </Typography>
                    ) : null}
                  </Box>
                );
              })
            )}
          </Stack>
        </Box>
      ) : null}
    </Stack>
  );
}

function DetailFields({ detail }: { detail: AlertDetail }) {
  const chainKeys = new Set([
    'parent_comm',
    'child_comm',
    'parent_pid',
    'child_pid',
    'parent_cmdline',
    'child_cmdline',
    'cmdline',
    'cursor_pid',
    'git_pid',
    'execution_path',
    'secrets',
    'secret_path',
    'story',
    'git_cmdline',
    'processes',
    'top_comms',
    'sample_limit',
    'source_event',
    'session_id',
    'app_name',
    'process_context_kind',
    'process_context_window_minutes',
    'network_connections',
    'created_files',
    'matched_rules',
    'process_id',
    'network_connection_count',
    'created_file_count',
    'registry_change_count',
    'remote_addrs',
    'registry_keys',
  ]);
  const entries = Object.entries(detail).filter(([key, value]) => !chainKeys.has(key) && value != null);
  if (entries.length === 0) return null;

  return (
    <Stack spacing={0.75}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
        Related evidence
      </Typography>
      <Box
        component="dl"
        sx={{
          m: 0,
          display: 'grid',
          gridTemplateColumns: 'max-content 1fr',
          columnGap: 1.5,
          rowGap: 0.5,
        }}
      >
        {entries.map(([key, value]) => (
          <Box key={key} sx={{ display: 'contents' }}>
            <Typography
              component="dt"
              variant="caption"
              color="text.secondary"
              sx={{ fontWeight: 600 }}
            >
              {DETAIL_LABELS[key] || key.replace(/_/g, ' ')}
            </Typography>
            <Typography
              component="dd"
              variant="body2"
              sx={{
                m: 0,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: '0.75rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {formatDetailValue(value)}
            </Typography>
          </Box>
        ))}
      </Box>
    </Stack>
  );
}

function MetaField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <Typography variant="caption" color="text.secondary" component="span" sx={{ display: 'inline-flex', gap: 0.5 }}>
      <Box component="span" sx={{ color: 'text.disabled', fontWeight: 600 }}>
        {label}
      </Box>
      <Box component="span" sx={mono ? { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' } : undefined}>
        {value}
      </Box>
    </Typography>
  );
}

function AlertMetadata({ alert }: { alert: SecurityAlert }) {
  const entries: Array<[string, string]> = [
    ['Device', alert.device_id],
    ...(alert.event_type ? [['Event', alert.event_type] as [string, string]] : []),
    ...(alert.event_id ? [['Event ID', alert.event_id] as [string, string]] : []),
  ];

  if (entries.length === 0) return null;

  return (
    <Stack spacing={0.75}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
        Alert metadata
      </Typography>
      <Box
        component="dl"
        sx={{
          m: 0,
          display: 'grid',
          gridTemplateColumns: 'max-content 1fr',
          columnGap: 1.5,
          rowGap: 0.5,
        }}
      >
        {entries.map(([key, value]) => (
          <Box key={key} sx={{ display: 'contents' }}>
            <Typography component="dt" variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
              {key}
            </Typography>
            <Typography
              component="dd"
              variant="body2"
              sx={{
                m: 0,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: '0.75rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {value}
            </Typography>
          </Box>
        ))}
      </Box>
    </Stack>
  );
}

function AlertRow({
  alert,
  expanded,
  onToggle,
}: {
  alert: SecurityAlert;
  expanded: boolean;
  onToggle: () => void;
}) {
  const label = TYPE_LABEL[alert.alert_type] || alert.alert_type.replace(/_/g, ' ');
  const severity = SEVERITY_COLOR[alert.severity] || 'default';
  const detail = parseDetail(alert.detail);
  const title = friendlyAlertTitle(alert, detail, label);
  const hasDetail = detail != null;
  const hasMetadata = Boolean(alert.device_id || alert.event_type || alert.event_id);
  const canExpand = hasDetail || hasMetadata;
  const [showTechnical, setShowTechnical] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explainModel, setExplainModel] = useState<string | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);

  const handleExplain = async (event: MouseEvent) => {
    event.stopPropagation();
    setExplaining(true);
    setExplainError(null);
    try {
      const result = await twinApi.explainAlert(alert);
      setExplanation(result.explanation);
      setExplainModel(result.model);
    } catch (err) {
      setExplanation(null);
      setExplainModel(null);
      setExplainError(err instanceof Error ? err.message : 'Failed to explain alert');
    } finally {
      setExplaining(false);
    }
  };

  return (
    <Box>
      <ListItemButton onClick={canExpand ? onToggle : undefined} sx={{ py: 1, px: 2, alignItems: 'flex-start' }}>
        <ListItemText
          primary={
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              {isAiAlert(alert.alert_type) ? (
                <Chip
                  icon={<AutoAwesomeIcon sx={{ fontSize: '0.95rem !important' }} />}
                  label="AI"
                  size="small"
                  color="secondary"
                  variant="filled"
                />
              ) : null}
              <Chip label={label} size="small" color={severity} variant="outlined" />
              <Chip label={alert.severity} size="small" color={severity} />
              <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 160 }}>
                {title}
              </Typography>
              {canExpand && (expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />)}
            </Stack>
          }
          secondary={
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
              <MetaField label="Time" value={formatShortDateTime(alert.timestamp)} />
            </Stack>
          }
        />
      </ListItemButton>
      {canExpand && (
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          <Box sx={{ px: 2, pb: 1.5, pt: 0.5 }}>
            <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'action.hover' }}>
              <Stack spacing={1.5}>
                {/* User-facing summary; PIDs/commands live under Technical details */}
                <FriendlyAlertSummary alert={alert} detail={detail} />
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Button
                    size="small"
                    variant={showTechnical ? 'contained' : 'outlined'}
                    color="inherit"
                    startIcon={<CodeIcon />}
                    endIcon={showTechnical ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    onClick={(event) => {
                      event.stopPropagation();
                      setShowTechnical((v) => !v);
                    }}
                  >
                    {showTechnical ? 'Hide technical details' : 'Technical details'}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={explaining ? <CircularProgress size={14} /> : <AutoAwesomeIcon />}
                    onClick={handleExplain}
                    disabled={explaining}
                  >
                    {explaining ? 'Explaining…' : 'Explain with Ollama'}
                  </Button>
                  {explainModel ? (
                    <Typography variant="caption" color="text.secondary">
                      Model: {explainModel}
                    </Typography>
                  ) : null}
                </Stack>
                <Collapse in={showTechnical} timeout="auto" unmountOnExit>
                  <Box
                    sx={{
                      p: 1.25,
                      borderRadius: 1,
                      border: 1,
                      borderColor: 'divider',
                      bgcolor: 'background.paper',
                    }}
                  >
                    <TechnicalDetailsPanel alert={alert} detail={detail} />
                  </Box>
                </Collapse>
                {explainError ? (
                  <Alert severity="error" onClose={() => setExplainError(null)}>
                    {explainError}
                  </Alert>
                ) : null}
                {explanation ? (
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                      AI explanation
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{ mt: 0.5, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}
                    >
                      {explanation}
                    </Typography>
                  </Box>
                ) : null}
              </Stack>
            </Paper>
          </Box>
        </Collapse>
      )}
    </Box>
  );
}

export default function AlertsPage() {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [hideNovelProcess, setHideNovelProcess] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const severityParam = severityFilter === 'all' ? undefined : severityFilter;
  const { items, total, loading, refetch } = useSecurityAlerts({
    pageSize: 100,
    severity: severityParam,
  });

  const visibleItems = useMemo(() => {
    let next = items;
    if (hideNovelProcess) {
      next = next.filter((alert) => alert.alert_type !== 'novel_process');
    }
    if (categoryFilter !== 'all') {
      next = next.filter((alert) => alertCategory(alert.alert_type) === categoryFilter);
    }
    return next;
  }, [items, categoryFilter, hideNovelProcess]);

  const emptyCopy = useMemo(() => {
    if (categoryFilter === 'ai') {
      return 'No AI process alerts yet. When ollama, claude, aider, or other AI tools start, they appear here.';
    }
    if (categoryFilter !== 'all') {
      return `No ${categoryFilter} alerts match the current filters.`;
    }
    if (severityFilter === 'all') {
      return 'No detection alerts yet. When the rules engine fires, findings appear here.';
    }
    return `No ${severityFilter}-severity alerts yet.`;
  }, [severityFilter, categoryFilter]);

  return (
    <Box sx={{ width: '100%', maxWidth: { sm: '100%', md: '1700px' } }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography
            component="h1"
            sx={{
              fontWeight: 700,
              fontSize: { xs: '1.5rem', md: '1.75rem' },
              letterSpacing: '-0.03em',
              color: 'text.primary',
              lineHeight: 1.2,
              mb: 0.75,
            }}
          >
            Alerts
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Detection findings from the rules engine (all severities). Expand an alert to see linked
            process or network evidence.
          </Typography>
        </Box>
        <Stack spacing={1} alignItems={{ xs: 'stretch', sm: 'flex-end' }}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1}
            alignItems={{ xs: 'stretch', md: 'center' }}
            justifyContent="flex-end"
            flexWrap="wrap"
            useFlexGap
          >
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="caption" color="text.secondary" sx={{ minWidth: 52 }}>
                Category
              </Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={categoryFilter}
                onChange={(_event, value: CategoryFilter | null) => {
                  if (value) setCategoryFilter(value);
                }}
              >
                <ToggleButton value="all" sx={{ px: 1.25 }}>
                  All types
                </ToggleButton>
                <ToggleButton value="ai" sx={{ px: 1.25 }}>
                  AI
                </ToggleButton>
                <ToggleButton value="process" sx={{ px: 1.25 }}>
                  Process
                </ToggleButton>
                <ToggleButton value="network" sx={{ px: 1.25 }}>
                  Network
                </ToggleButton>
              </ToggleButtonGroup>
            </Stack>
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="caption" color="text.secondary" sx={{ minWidth: 52 }}>
                Severity
              </Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={severityFilter}
                onChange={(_event, value: SeverityFilter | null) => {
                  if (value) setSeverityFilter(value);
                }}
              >
                <ToggleButton value="all" sx={{ px: 1.25 }}>
                  Any
                </ToggleButton>
                <ToggleButton value="high" sx={{ px: 1.25 }}>
                  High
                </ToggleButton>
                <ToggleButton value="medium" sx={{ px: 1.25 }}>
                  Medium
                </ToggleButton>
                <ToggleButton value="low" sx={{ px: 1.25 }}>
                  Low
                </ToggleButton>
              </ToggleButtonGroup>
            </Stack>
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={hideNovelProcess}
                  onChange={(event) => setHideNovelProcess(event.target.checked)}
                />
              }
              label={
                <Typography variant="caption" color="text.secondary">
                  Hide novel process
                </Typography>
              }
              sx={{ ml: 0.5, mr: 0 }}
            />
            {total > 0 && (
              <Chip
                label={
                  hideNovelProcess || categoryFilter !== 'all'
                    ? `${visibleItems.length}/${total}`
                    : total
                }
                size="small"
                variant="outlined"
              />
            )}
            <Tooltip title="Refresh">
              <span>
                <IconButton size="small" onClick={refetch} disabled={loading}>
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Stack>
      </Stack>

      <Paper variant="outlined">
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={28} />
          </Box>
        ) : visibleItems.length === 0 ? (
          <Typography color="text.secondary" sx={{ p: 3 }}>
            {emptyCopy}
          </Typography>
        ) : (
          <List dense disablePadding>
            {visibleItems.map((alert, index) => (
              <Box key={alert.id}>
                <AlertRow
                  alert={alert}
                  expanded={expandedId === alert.id}
                  onToggle={() => setExpandedId((current) => (current === alert.id ? null : alert.id))}
                />
                {index < visibleItems.length - 1 && <Divider component="li" />}
              </Box>
            ))}
          </List>
        )}
      </Paper>
    </Box>
  );
}
