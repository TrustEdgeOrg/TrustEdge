import { useCallback, useEffect, useState } from 'react';
import { agentsApi } from '../config/api';
import { twinApi } from '../../twin/config/api';
import { Agent } from '../types/agent';
import { AgentTelemetryEvent, ConnectedAgent } from '../../twin/types/connectedAgent';
import { isAiAgentActionEvent } from '../utils/agentActionDisplay';

function mergeEvents(
  twinEvents: AgentTelemetryEvent[],
  durableActions: AgentTelemetryEvent[]
): AgentTelemetryEvent[] {
  const byId = new Map<string, AgentTelemetryEvent>();
  const fallback: AgentTelemetryEvent[] = [];

  const add = (event: AgentTelemetryEvent) => {
    const id = String(event.event_id || '').trim();
    if (id) {
      if (!byId.has(id)) byId.set(id, event);
      return;
    }
    fallback.push(event);
  };

  for (const event of durableActions) {
    if (isAiAgentActionEvent(event.type)) add(event);
  }
  for (const event of twinEvents) {
    add(event);
  }

  return [...byId.values(), ...fallback].sort((a, b) => {
    const ta = Date.parse(a.ts || '') || 0;
    const tb = Date.parse(b.ts || '') || 0;
    return tb - ta;
  });
}

async function loadMergedEvents(agentId: string): Promise<AgentTelemetryEvent[]> {
  const [twinResult, actionsResult] = await Promise.allSettled([
    // Larger twin window so host process/file events can correlate to turns.
    twinApi.listDeviceEvents(agentId, 200),
    twinApi.listAgentActions(agentId, 200),
  ]);

  const twin =
    twinResult.status === 'fulfilled' ? twinResult.value.items || [] : [];
  const durable =
    actionsResult.status === 'fulfilled' ? actionsResult.value.items || [] : [];
  return mergeEvents(twin, durable);
}

export function useAgentDetail(agentId: string | undefined) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [live, setLive] = useState<ConnectedAgent | null>(null);
  const [events, setEvents] = useState<AgentTelemetryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveMissing, setLiveMissing] = useState(false);

  const refresh = useCallback(async () => {
    if (!agentId) {
      setAgent(null);
      setLive(null);
      setEvents([]);
      setError('Missing agent id');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const registry = await agentsApi.get(agentId);
      setAgent(registry);

      const [liveResult, events] = await Promise.all([
        twinApi.getConnectedAgent(agentId).then(
          (value) => ({ ok: true as const, value }),
          () => ({ ok: false as const })
        ),
        loadMergedEvents(agentId),
      ]);

      if (liveResult.ok) {
        setLive(liveResult.value);
        setLiveMissing(false);
      } else {
        setLive(null);
        setLiveMissing(true);
      }
      setEvents(events);
    } catch (e) {
      setAgent(null);
      setLive(null);
      setEvents([]);
      setError(e instanceof Error ? e.message : 'Failed to load agent');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  const refreshEvents = useCallback(async () => {
    if (!agentId) {
      setEvents([]);
      return;
    }
    try {
      setEvents(await loadMergedEvents(agentId));
    } catch {
      setEvents([]);
    }
  }, [agentId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { agent, live, events, loading, error, liveMissing, refresh, refreshEvents };
}
