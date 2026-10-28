import { AgentTelemetryEvent } from '../../twin/types/connectedAgent';
import { AgentActionPayload, isAiAgentActionEvent } from './agentActionDisplay';

export type AgentActionTreeNode = {
  event: AgentTelemetryEvent;
  payload: AgentActionPayload;
};

export type AgentActionTurn = {
  turnId: string;
  prompt: AgentActionTreeNode | null;
  tools: AgentActionTreeNode[];
  startTs: number;
};

export type AgentActionSessionTree = {
  sessionId: string;
  turns: AgentActionTurn[];
  latestTs: number;
};

function parseTs(ts: string | null | undefined): number {
  if (!ts) return 0;
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : 0;
}

function payloadOf(event: AgentTelemetryEvent): AgentActionPayload {
  return (event.payload || {}) as AgentActionPayload;
}

function isPromptNode(payload: AgentActionPayload): boolean {
  return String(payload.tool || '').trim().toLowerCase() === 'prompt';
}

function isMcpToolNode(payload: AgentActionPayload): boolean {
  if (String(payload.channel || '').toUpperCase() === 'MCP') return true;
  return Boolean(String(payload.server || '').trim());
}

const ORPHAN_MCP_WINDOW_MS = 10 * 60 * 1000;

/** Attach session/turn from the nearest prompt when gateway events lack correlation. */
function correlateOrphanMcpEvents(events: AgentTelemetryEvent[]): AgentTelemetryEvent[] {
  const prompts = events
    .map((event) => ({ event, payload: payloadOf(event), ts: parseTs(event.ts) }))
    .filter((item) => isPromptNode(item.payload) && String(item.payload.session_id || '').trim());

  if (!prompts.length) return events;

  return events.map((event) => {
    const payload = payloadOf(event);
    if (!isMcpToolNode(payload) || String(payload.tool || '').toLowerCase() === 'prompt') {
      return event;
    }
    if (String(payload.session_id || '').trim() && String(payload.turn_id || '').trim()) {
      return event;
    }

    const ts = parseTs(event.ts);
    let best: (typeof prompts)[number] | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const prompt of prompts) {
      const delta = Math.abs(ts - prompt.ts);
      if (delta <= ORPHAN_MCP_WINDOW_MS && delta < bestDelta) {
        best = prompt;
        bestDelta = delta;
      }
    }
    if (!best) return event;

    const turnId =
      String(payload.turn_id || '').trim() ||
      String(best.payload.turn_id || '').trim() ||
      String(best.payload.correlation_id || '').trim();

    return {
      ...event,
      payload: {
        ...payload,
        session_id: String(best.payload.session_id || '').trim(),
        ...(turnId ? { turn_id: turnId } : {}),
      },
    };
  });
}

function sessionKey(payload: AgentActionPayload): string {
  const sid = String(payload.session_id || '').trim();
  return sid || '__default__';
}

function turnKey(payload: AgentActionPayload, event: AgentTelemetryEvent): string {
  const turn = String(payload.turn_id || '').trim();
  if (turn) return turn;
  if (isPromptNode(payload)) {
    const corr = String(payload.correlation_id || '').trim();
    if (corr) return corr;
  }
  return `orphan-${event.event_id || parseTs(event.ts)}`;
}

function toNode(event: AgentTelemetryEvent): AgentActionTreeNode {
  return { event, payload: payloadOf(event) };
}

function turnHasContent(turn: AgentActionTurn | null): turn is AgentActionTurn {
  if (!turn) return false;
  return Boolean(turn.prompt) || turn.tools.length > 0;
}

function finalizeTurn(turn: AgentActionTurn): AgentActionTurn {
  const tsCandidates = [
    turn.prompt ? parseTs(turn.prompt.event.ts) : 0,
    ...turn.tools.map((t) => parseTs(t.event.ts)),
  ].filter((n) => n > 0);
  return {
    ...turn,
    startTs: tsCandidates.length ? Math.min(...tsCandidates) : 0,
  };
}

function attachToolToTurn(turns: AgentActionTurn[], node: AgentActionTreeNode): void {
  const payload = node.payload;
  const turnId = String(payload.turn_id || '').trim();
  if (turnId) {
    const match = [...turns].reverse().find((t) => t.turnId === turnId);
    if (match) {
      match.tools.push(node);
      return;
    }
  }

  const nodeTs = parseTs(node.event.ts);
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn.startTs > 0 && nodeTs > 0 && nodeTs < turn.startTs) {
      continue;
    }
    if (turn.prompt || i === turns.length - 1) {
      turn.tools.push(node);
      return;
    }
  }

  turns.push(
    finalizeTurn({
      turnId: turnKey(payload, node.event),
      prompt: null,
      tools: [node],
      startTs: nodeTs,
    })
  );
}

function buildSessionTurns(events: AgentTelemetryEvent[]): AgentActionTurn[] {
  const sorted = [...events].sort(
    (a, b) => parseTs(a.ts) - parseTs(b.ts) || String(a.event_id).localeCompare(String(b.event_id))
  );

  const turns: AgentActionTurn[] = [];
  let current: AgentActionTurn | null = null;

  for (const event of sorted) {
    const node = toNode(event);
    const payload = node.payload;

    if (isPromptNode(payload)) {
      const id = turnKey(payload, event);
      if (turnHasContent(current)) {
        turns.push(finalizeTurn(current));
        current = null;
      }
      const orphanIdx = turns.findIndex((t) => t.turnId === id && !t.prompt);
      if (orphanIdx >= 0) {
        const orphan = turns.splice(orphanIdx, 1)[0];
        orphan.prompt = node;
        current = finalizeTurn(orphan);
        continue;
      }
      current = finalizeTurn({
        turnId: id,
        prompt: node,
        tools: [],
        startTs: parseTs(event.ts),
      });
      continue;
    }

    if (current) {
      current.tools.push(node);
    } else {
      attachToolToTurn(turns, node);
    }
  }

  if (turnHasContent(current)) {
    turns.push(finalizeTurn(current));
  }

  return turns.sort((a, b) => b.startTs - a.startTs);
}

/** Group ai_agent_action telemetry into session → prompt → tool trees. */
export function buildAgentActionTree(events: AgentTelemetryEvent[]): AgentActionSessionTree[] {
  const actions = correlateOrphanMcpEvents(events.filter((e) => isAiAgentActionEvent(e.type)));
  if (!actions.length) return [];

  const bySession = new Map<string, AgentTelemetryEvent[]>();
  for (const event of actions) {
    const key = sessionKey(payloadOf(event));
    const bucket = bySession.get(key) || [];
    bucket.push(event);
    bySession.set(key, bucket);
  }

  const sessions: AgentActionSessionTree[] = [];
  for (const [sessionId, sessionEvents] of bySession.entries()) {
    const turns = buildSessionTurns(sessionEvents);
    const latestTs = turns.reduce((max, turn) => {
      const turnLatest = Math.max(
        turn.startTs,
        ...turn.tools.map((t) => parseTs(t.event.ts))
      );
      return Math.max(max, turnLatest);
    }, 0);
    sessions.push({
      sessionId: sessionId === '__default__' ? 'Session' : sessionId,
      turns,
      latestTs,
    });
  }

  return sessions.sort((a, b) => b.latestTs - a.latestTs);
}

export function countAgentActionTreeNodes(sessions: AgentActionSessionTree[]): number {
  return sessions.reduce(
    (sum, session) =>
      sum +
      session.turns.reduce(
        (turnSum, turn) => turnSum + (turn.prompt ? 1 : 0) + turn.tools.length,
        0
      ),
    0
  );
}
