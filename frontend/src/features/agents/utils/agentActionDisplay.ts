/** Display helpers for ai_agent_action telemetry in the TrustEdge UI. */

export type AgentActionPayload = {
  agent_type?: string;
  session_id?: string;
  turn_id?: string;
  channel?: string;
  server?: string;
  tool?: string;
  operation?: string;
  destination?: string;
  /** Full user prompt text when tool === prompt (preferred over destination). */
  prompt_text?: string;
  decision?: string;
  sensitivity?: string;
  classification?: string;
  governed?: boolean;
  process?: string;
  skill_name?: string;
  skill_source?: string;
  skill_outcome?: string;
  correlation_id?: string;
  evidence?: string[];
  confidence?: string;
  risk?: string;
  risk_type?: string;
};

export const AI_AGENT_ACTION_EVENT = 'ai_agent_action';
export const ALERT_SENSITIVE_MCP_UNGOVERNED_EGRESS = 'ai_sensitive_mcp_ungoverned_egress';

/** Section headers for the agent action turn timeline (prompt → tools → effective corroboration). */
export const AGENT_ACTION_SECTION_USER_PROMPT = 'User prompt';
export const AGENT_ACTION_SECTION_AGENT_EXECUTION = 'Agent execution';
export const AGENT_ACTION_SECTION_EFFECTIVE_CORROBORATION = 'Effective corroboration';
/** @deprecated Use AGENT_ACTION_SECTION_EFFECTIVE_CORROBORATION */
export const AGENT_ACTION_SECTION_HOST_EVIDENCE = AGENT_ACTION_SECTION_EFFECTIVE_CORROBORATION;

export const RISK_TYPE_LABELS: Record<string, string> = {
  secrets_git_push: 'Secrets git push',
  secret_read: 'Secret file read',
  secret_write: 'Secret file write',
};

export function isHighRiskAction(
  payload: AgentActionPayload | Record<string, unknown> | null | undefined
): boolean {
  const p = (payload || {}) as AgentActionPayload;
  if (String(p.risk || '').toLowerCase() === 'high') return true;
  return Boolean(p.risk_type && RISK_TYPE_LABELS[p.risk_type]);
}

export function riskTypeLabel(riskType: string | undefined | null): string | null {
  const key = String(riskType || '').trim();
  if (!key) return null;
  return RISK_TYPE_LABELS[key] || key.replace(/_/g, ' ');
}

export function isAiAgentActionEvent(type: string | undefined | null): boolean {
  return (type || '').trim() === AI_AGENT_ACTION_EVENT;
}

export function labelAgentActionChannel(channel: string | undefined | null): string {
  const c = (channel || '').trim().toUpperCase();
  switch (c) {
    case 'MCP':
      return 'MCP tool';
    case 'SHELL':
      return 'Shell';
    case 'PROCESS':
      return 'Process';
    case 'NETWORK':
      return 'Network';
    case 'FILE':
      return 'File';
    case 'SKILL':
      return 'AI skill';
    case 'UNKNOWN':
      return 'Unknown channel';
    default:
      return c ? c.replace(/_/g, ' ') : 'Agent action';
  }
}

export function summarizeAgentAction(payload: Record<string, unknown> | AgentActionPayload | null | undefined): string {
  const p = (payload || {}) as AgentActionPayload;
  const channel = (p.channel || '').toUpperCase();

  if (channel === 'MCP') {
    const parts = [
      p.server && p.tool ? `${p.server}/${p.tool}` : p.tool || p.server || '',
      p.decision ? String(p.decision) : '',
      p.sensitivity && p.sensitivity !== 'unknown' ? String(p.sensitivity) : '',
      p.governed === true ? 'governed' : p.governed === false ? 'ungoverned' : '',
    ].filter(Boolean);
    return parts.join(' · ') || 'MCP tool call';
  }

  if (channel === 'NETWORK') {
    const parts = [
      p.process || '',
      p.destination || '',
      p.governed === false ? 'ungoverned' : p.governed === true ? 'governed' : '',
    ].filter(Boolean);
    return parts.join(' · ') || 'Agent network action';
  }

  if (channel === 'PROCESS' || channel === 'SHELL') {
    const parts = [
      p.destination || '',
      p.tool || '',
    ].filter(Boolean);
    return parts.join(' · ') || (channel === 'SHELL' ? 'Shell command' : 'Agent process action');
  }

  if (channel === 'SKILL') {
    return [p.skill_name || p.destination, p.operation || 'observed', p.skill_outcome]
      .filter(Boolean)
      .join(' · ');
  }

  const fallback = [p.tool, p.process, p.destination, p.operation].filter(Boolean);
  return fallback.join(' · ') || 'AI agent action';
}

export function agentActionChips(payload: Record<string, unknown> | AgentActionPayload | null | undefined): string[] {
  const p = (payload || {}) as AgentActionPayload;
  const chips: string[] = [];
  const riskLabel = riskTypeLabel(p.risk_type);
  if (isHighRiskAction(p) && riskLabel) chips.push(riskLabel);
  if (p.governed === true) chips.push('Governed');
  if (p.governed === false && !isHighRiskAction(p)) chips.push('Ungoverned');
  if (p.decision && p.decision !== 'unknown' && !isHighRiskAction(p)) chips.push(String(p.decision));
  if (p.sensitivity && p.sensitivity !== 'unknown' && p.sensitivity !== 'none' && !isHighRiskAction(p)) {
    chips.push(String(p.sensitivity));
  }
  return chips;
}

export function isPromptAction(payload: AgentActionPayload | Record<string, unknown> | null | undefined): boolean {
  const p = (payload || {}) as AgentActionPayload;
  return String(p.tool || '').trim().toLowerCase() === 'prompt';
}

export function durationMsFromEvidence(evidence: unknown): number | null {
  if (!Array.isArray(evidence)) return null;
  for (const item of evidence) {
    const s = String(item || '');
    const m = /^duration_ms=(\d+)$/.exec(s);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Short label for a tree node (tool name or channel). */
export function actionNodeTitle(payload: AgentActionPayload | Record<string, unknown> | null | undefined): string {
  const p = (payload || {}) as AgentActionPayload;
  if (isPromptAction(p)) return 'User prompt';

  const channel = (p.channel || '').toUpperCase();
  const tool = String(p.tool || '').trim();

  if (channel === 'MCP') {
    return p.server && tool ? `${p.server}/${tool}` : tool || p.server || 'MCP tool';
  }
  if (tool) return tool;
  return labelAgentActionChannel(p.channel);
}

/** Primary detail line (command, path, prompt text). */
export function actionNodeDetail(payload: AgentActionPayload | Record<string, unknown> | null | undefined): string {
  const p = (payload || {}) as AgentActionPayload & { prompt_text?: string };

  if (isPromptAction(p)) {
    const full = String(p.prompt_text || '').trim();
    if (full) return full;
    const dest = String(p.destination || '').trim();
    return dest.replace(/\s·\s*submit$/i, '').trim() || 'User prompt';
  }

  const dest = String(p.destination || '').trim();
  if (dest) return dest;

  const channel = (p.channel || '').toUpperCase();
  if (channel === 'MCP' && p.server && p.tool) {
    return `${p.server}/${p.tool}`;
  }

  return summarizeAgentAction(p);
}

/** Accent color token for timeline nodes. */
export function actionNodeAccent(payload: AgentActionPayload | Record<string, unknown> | null | undefined): string {
  const p = (payload || {}) as AgentActionPayload;
  if (isHighRiskAction(p)) return 'error.main';
  if (isPromptAction(p)) return 'primary.main';

  const channel = (p.channel || '').toUpperCase();
  switch (channel) {
    case 'MCP':
      return p.governed ? 'success.main' : 'warning.main';
    case 'SHELL':
      return 'warning.main';
    case 'FILE':
      return 'info.main';
    case 'NETWORK':
      return 'error.main';
    case 'PROCESS':
      return 'secondary.main';
    default:
      return 'text.secondary';
  }
}
