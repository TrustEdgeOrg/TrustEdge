import { AgentTelemetryEvent } from '../../twin/types/connectedAgent';
import { SecurityAlert } from '../../twin/types/securityAlert';
import { AgentActionPayload, isAiAgentActionEvent } from './agentActionDisplay';
import { AgentActionSessionTree, AgentActionTurn } from './agentActionTree';

export type HostEvidenceKind = 'alert' | 'process' | 'file' | 'network';

export type HostEvidenceItem = {
  kind: HostEvidenceKind;
  title: string;
  detail: string;
  ts: string;
  severity?: string;
  alertType?: string;
  eventId?: string;
};

export type AgentActionTurnWithHost = AgentActionTurn & {
  hostEvidence: HostEvidenceItem[];
};

export type AgentActionSessionWithHost = Omit<AgentActionSessionTree, 'turns'> & {
  turns: AgentActionTurnWithHost[];
};

const HOST_EVENT_TYPES = new Set([
  'file_open',
  'file_write',
  'process_start',
  'process_exit',
  'network_connection',
]);

const PRE_WINDOW_MS = 5_000;
const POST_WINDOW_MS = 45_000;

function parseTs(ts: string | null | undefined): number {
  if (!ts) return 0;
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : 0;
}

function turnEndTs(turn: AgentActionTurn): number {
  const times = [
    turn.startTs,
    ...(turn.prompt ? [parseTs(turn.prompt.event.ts)] : []),
    ...turn.tools.map((t) => parseTs(t.event.ts)),
  ].filter((n) => n > 0);
  return times.length ? Math.max(...times) : turn.startTs;
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/').toLowerCase();
}

function basename(path: string): string {
  const norm = normalizePath(path);
  const parts = norm.split('/').filter(Boolean);
  return parts[parts.length - 1] || norm;
}

function collectHints(turn: AgentActionTurn): {
  paths: string[];
  cmds: string[];
  corrIds: string[];
  mcpServers: string[];
} {
  const paths: string[] = [];
  const cmds: string[] = [];
  const corrIds: string[] = [];
  const mcpServers: string[] = [];

  for (const node of [...(turn.prompt ? [turn.prompt] : []), ...turn.tools]) {
    const p = node.payload as AgentActionPayload;
    const dest = String(p.destination || '').trim();
    const channel = String(p.channel || '').toUpperCase();
    const tool = String(p.tool || '').trim();
    const corr = String(p.correlation_id || '').trim();
    if (corr) corrIds.push(corr);

    if (channel === 'MCP') {
      const server = String(p.server || '').trim().toLowerCase();
      if (server) {
        mcpServers.push(server);
        if (server === 'github') cmds.push('api.github.com');
      }
      continue;
    }

    if (!dest) continue;

    if (channel === 'SHELL' || tool === 'Shell' || tool === 'Bash') {
      cmds.push(dest);
      for (const m of dest.match(/\/(?:[^\s"']+)/g) || []) {
        if (m.includes('.') || m.includes('/')) paths.push(m);
      }
      continue;
    }

    if (
      channel === 'FILE' ||
      ['Read', 'Write', 'StrReplace', 'Delete', 'Edit', 'Grep', 'Glob'].includes(tool)
    ) {
      paths.push(dest);
    }
  }

  return {
    paths: [...new Set(paths.map(normalizePath).filter(Boolean))],
    cmds: [...new Set(cmds.map((c) => c.toLowerCase()).filter(Boolean))],
    corrIds: [...new Set(corrIds)],
    mcpServers: [...new Set(mcpServers)],
  };
}

function pathMatches(candidate: string, hints: string[]): boolean {
  const c = normalizePath(candidate);
  if (!c || !hints.length) return false;
  const cBase = basename(c);
  return hints.some((h) => {
    if (!h) return false;
    if (c === h || c.endsWith(h) || h.endsWith(c)) return true;
    if (c.includes(h) || h.includes(c)) return true;
    const hBase = basename(h);
    return Boolean(hBase && cBase && hBase === cBase);
  });
}

function cmdMatches(candidate: string, cmds: string[]): boolean {
  const c = candidate.toLowerCase();
  if (!c || !cmds.length) return false;
  return cmds.some((cmd) => {
    if (!cmd) return false;
    if (c.includes(cmd) || cmd.includes(c)) return true;
    // Token overlap for short commands
    const tokens = cmd.split(/\s+/).filter((t) => t.length > 3).slice(0, 6);
    return tokens.length > 0 && tokens.every((t) => c.includes(t));
  });
}

function hostBridgeSource(source: string): 'cursor' | 'mcp' | null {
  if (source === 'cursor_hook_host_bridge') return 'cursor';
  if (source === 'mcp_gateway_host_bridge') return 'mcp';
  return null;
}

function hostEventItem(event: AgentTelemetryEvent): HostEvidenceItem | null {
  const payload = event.payload || {};
  const ts = event.ts || '';
  const type = event.type;
  const bridge = hostBridgeSource(String(payload.source || ''));

  if (type === 'file_open' || type === 'file_write') {
    const path = String(payload.path || payload.file || '').trim();
    const writeOp =
      type === 'file_write' || String(payload.operation || '').toLowerCase() === 'write';
    const op = writeOp ? 'File write' : 'File open';
    return {
      kind: 'file',
      title: bridge === 'mcp' ? `${op} (MCP bridge)` : bridge === 'cursor' ? `${op} (IDE bridge)` : op,
      detail: path || '(path unknown)',
      ts,
      eventId: event.event_id,
    };
  }

  if (type === 'process_start' || type === 'process_exit') {
    const comm = String(payload.comm || payload.name || '').trim();
    const cmdline = String(payload.cmdline || payload.command || '').trim();
    const pid = payload.pid != null ? `pid ${payload.pid}` : '';
    const titleBase =
      type === 'process_start' ? `Process start · ${comm || 'unknown'}` : `Process exit · ${comm || 'unknown'}`;
    return {
      kind: 'process',
      title:
        bridge === 'mcp'
          ? `${titleBase} (MCP bridge)`
          : bridge === 'cursor'
            ? `${titleBase} (IDE bridge)`
            : titleBase,
      detail: [cmdline || comm, pid].filter(Boolean).join(' · '),
      ts,
      eventId: event.event_id,
    };
  }

  if (type === 'network_connection') {
    const dest = [payload.dst_ip || payload.remote_addr, payload.dst_port || payload.rport]
      .filter(Boolean)
      .join(':');
    const host = String(payload.remote_hostname || payload.domain || '').trim();
    const proc = String(payload.comm || payload.process || '').trim();
    const title =
      bridge === 'mcp'
        ? 'Logical egress (MCP bridge)'
        : bridge === 'cursor'
          ? 'Network connection (IDE bridge)'
          : 'Network connection';
    return {
      kind: 'network',
      title,
      detail: [proc, host || dest || 'external'].filter(Boolean).join(' → '),
      ts,
      eventId: event.event_id,
    };
  }

  return null;
}

function alertItem(alert: SecurityAlert): HostEvidenceItem {
  let detail = String(alert.message || '').trim();
  if (alert.detail) {
    try {
      const parsed = JSON.parse(alert.detail);
      if (parsed && typeof parsed === 'object') {
        const bits = [
          parsed.path,
          parsed.cmdline,
          parsed.cursor_pid && `cursor_pid=${parsed.cursor_pid}`,
          parsed.git_pid && `git_pid=${parsed.git_pid}`,
        ].filter(Boolean);
        if (bits.length) detail = bits.join(' · ');
      }
    } catch {
      // keep message
    }
  }
  return {
    kind: 'alert',
    title: String(alert.alert_type || 'alert').replace(/_/g, ' '),
    detail: detail || alert.alert_type,
    ts: alert.timestamp,
    severity: alert.severity,
    alertType: alert.alert_type,
    eventId: alert.event_id || String(alert.id),
  };
}

function alertRelevant(alert: SecurityAlert, hints: { paths: string[]; cmds: string[]; corrIds: string[] }): boolean {
  const type = String(alert.alert_type || '').toLowerCase();
  if (type.startsWith('ai_') || type.includes('secret') || type.includes('exfil')) {
    return true;
  }
  const blob = `${alert.message || ''} ${alert.detail || ''}`.toLowerCase();
  if (hints.paths.some((p) => blob.includes(p) || blob.includes(basename(p)))) return true;
  if (hints.cmds.some((c) => blob.includes(c.slice(0, 40)))) return true;
  return false;
}

function eventRelevant(
  event: AgentTelemetryEvent,
  hints: { paths: string[]; cmds: string[]; corrIds: string[]; mcpServers: string[] }
): boolean {
  const payload = event.payload || {};
  const source = String(payload.source || '');
  const corr = String(payload.correlation_id || '').trim();
  if (corr && hints.corrIds.includes(corr)) {
    return true;
  }
  if (source === 'cursor_hook_host_bridge' || source === 'mcp_gateway_host_bridge') {
    // Bridged from IDE hooks — match aggressively on path/cmdline hints.
    if (event.type === 'file_open' || event.type === 'file_write') {
      return pathMatches(String(payload.path || payload.file || ''), hints.paths);
    }
    if (event.type === 'process_start' || event.type === 'process_exit') {
      const cmdline = String(payload.cmdline || payload.command || '');
      return cmdMatches(cmdline, hints.cmds) || hints.cmds.some((c) => cmdline.toLowerCase() === c);
    }
  }
  if (event.type === 'file_open' || event.type === 'file_write') {
    const path = String(payload.path || payload.file || '');
    return pathMatches(path, hints.paths);
  }
  if (event.type === 'process_start' || event.type === 'process_exit') {
    const cmdline = String(payload.cmdline || payload.command || '');
    const comm = String(payload.comm || '');
    if (cmdMatches(cmdline, hints.cmds) || cmdMatches(comm, hints.cmds)) return true;
    if (hints.paths.some((p) => cmdline.toLowerCase().includes(basename(p)))) return true;
    return false;
  }
  if (event.type === 'network_connection') {
    const host = String(
      payload.remote_hostname || payload.domain || payload.remote_addr || ''
    ).toLowerCase();
    if (hints.cmds.some((c) => host.includes(c) || c.includes(host))) return true;
    if (hints.mcpServers.includes('github') && host.includes('github')) return true;
    return hints.cmds.some((c) => /curl|wget|ssh|nc\b|http/i.test(c));
  }
  return false;
}

/** Attach host-observed alerts + OS telemetry to each turn (time + hint match). */
export function attachHostEvidence(
  sessions: AgentActionSessionTree[],
  events: AgentTelemetryEvent[],
  alerts: SecurityAlert[] = []
): AgentActionSessionWithHost[] {
  const hostEvents = events.filter((e) => HOST_EVENT_TYPES.has(e.type) && !isAiAgentActionEvent(e.type));

  return sessions.map((session) => ({
    ...session,
    turns: session.turns.map((turn) => {
      const hints = collectHints(turn);
      const start = turn.startTs > 0 ? turn.startTs - PRE_WINDOW_MS : 0;
      const end = (turnEndTs(turn) || turn.startTs) + POST_WINDOW_MS;
      const items: HostEvidenceItem[] = [];
      const seen = new Set<string>();

      const push = (item: HostEvidenceItem) => {
        const key = `${item.kind}|${item.eventId || ''}|${item.title}|${item.detail}`;
        if (seen.has(key)) return;
        seen.add(key);
        items.push(item);
      };

      for (const alert of alerts) {
        const ts = parseTs(alert.timestamp);
        if (start && end && (ts < start || ts > end)) continue;
        if (!alertRelevant(alert, hints)) continue;
        push(alertItem(alert));
      }

      for (const event of hostEvents) {
        const ts = parseTs(event.ts);
        if (start && end && (ts < start || ts > end)) continue;
        if (!eventRelevant(event, hints)) continue;
        const item = hostEventItem(event);
        if (item) push(item);
      }

      items.sort((a, b) => parseTs(a.ts) - parseTs(b.ts));
      return { ...turn, hostEvidence: items };
    }),
  }));
}

export function isHostEventType(type: string | undefined | null): boolean {
  return HOST_EVENT_TYPES.has(String(type || '').trim());
}

function turnUsesGovernedMcp(turn: AgentActionTurn): boolean {
  return turn.tools.some((node) => {
    const p = node.payload as AgentActionPayload;
    return String(p.channel || '').toUpperCase() === 'MCP' || p.governed === true;
  });
}

/** Empty-state copy for the effective corroboration section. */
export function hostEvidenceEmptyMessage(turn: AgentActionTurn): string {
  if (turnUsesGovernedMcp(turn)) {
    return 'Governed MCP tools run in an isolated downstream process, so local OS telemetry often misses per-call egress. Rebuild trustedge-mcp-gateway and reload Cursor MCP to enable logical host bridging.';
  }
  return "No matching host process, file, network, or alert evidence in this turn's time window. (Twin telemetry may have rotated.)";
}
