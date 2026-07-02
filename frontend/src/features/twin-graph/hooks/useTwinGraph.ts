import { useCallback, useEffect, useRef, useState } from 'react';
import { getDnsQueriesWebSocketUrl } from '../../../shared/config/apiWebSocketUrl';
import { devicesApi } from '../../devices/config/api';
import {
  buildLiveMapFromQueries,
  filterQueriesWithinMinutes,
  LiveDnsAttributed,
} from '../../network-map/utils/mergeLiveQueryIntoMap';
import { mergeMapSnapshots } from '../../network-map/utils/mergeMapSnapshots';
import { NetworkMapResponse } from '../../network-map/types/networkMap';
import {
  DEFAULT_TWIN_GRAPH_MINUTES,
  DEFAULT_TWIN_GRAPH_POLL_SEC,
  fetchTwinGraphSnapshot,
} from '../api/twinGraphApi';
import { projectAttributionGraph } from '../projections/projectGraph';
import { TwinGraphSnapshot } from '../types/twinGraph';

function emptySnapshot(minutes: number): TwinGraphSnapshot {
  return {
    generated_at: new Date().toISOString(),
    window_minutes: minutes,
    nodes: [],
    edges: [],
  };
}

export function useTwinGraph(
  minutes = DEFAULT_TWIN_GRAPH_MINUTES,
  pollSec = DEFAULT_TWIN_GRAPH_POLL_SEC,
  includeFlows = false,
) {
  const [snapshot, setSnapshot] = useState<TwinGraphSnapshot | null>(null);
  const [attribution, setAttribution] = useState<NetworkMapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);

  const ipToDeviceRef = useRef(new Map<string, { deviceId: number; label: string }>());
  const liveQueriesRef = useRef<LiveDnsAttributed[]>([]);
  const apiSnapshotRef = useRef<TwinGraphSnapshot | null>(null);
  const minutesRef = useRef(minutes);
  minutesRef.current = minutes;

  const mergeSnapshotAndLive = useCallback((api: TwinGraphSnapshot) => {
    const windowMinutes = minutesRef.current;
    liveQueriesRef.current = filterQueriesWithinMinutes(liveQueriesRef.current, windowMinutes);
    const liveGraph = buildLiveMapFromQueries(
      liveQueriesRef.current,
      windowMinutes,
      ipToDeviceRef.current,
    );
    const baseAttribution = projectAttributionGraph(api);
    const mergedAttribution = mergeMapSnapshots(
      baseAttribution,
      liveGraph.nodes.length > 0 || liveGraph.edges.length > 0 ? liveGraph : null,
    );
    return { snapshot: api, attribution: mergedAttribution };
  }, []);

  const loadDeviceIndex = useCallback(async () => {
    try {
      const devices = await devicesApi.list();
      const map = new Map<string, { deviceId: number; label: string }>();
      for (const device of devices) {
        if (device.client_ip) {
          map.set(device.client_ip, {
            deviceId: device.id,
            label: device.hostname || device.client_ip,
          });
        }
      }
      ipToDeviceRef.current = map;
    } catch {
      // keep prior index
    }
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      await loadDeviceIndex();
      const response = await fetchTwinGraphSnapshot(minutes, includeFlows, true);
      for (const node of response.nodes) {
        if (
          node.entity_type === 'device' &&
          node.properties.client_ip &&
          node.properties.device_id != null
        ) {
          ipToDeviceRef.current.set(String(node.properties.client_ip), {
            deviceId: Number(node.properties.device_id),
            label: node.label,
          });
        }
      }
      apiSnapshotRef.current = response;
      const merged = mergeSnapshotAndLive(response);
      setSnapshot(merged.snapshot);
      setAttribution(merged.attribution);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load twin graph');
    } finally {
      setLoading(false);
    }
  }, [minutes, includeFlows, loadDeviceIndex, mergeSnapshotAndLive]);

  useEffect(() => {
    liveQueriesRef.current = [];
    apiSnapshotRef.current = null;
    load();
    const timer = window.setInterval(load, pollSec * 1000);
    return () => window.clearInterval(timer);
  }, [load, pollSec]);

  useEffect(() => {
    const wsUrl = getDnsQueriesWebSocketUrl();
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => setLiveConnected(true);
    ws.onclose = () => setLiveConnected(false);
    ws.onmessage = (event) => {
      if (event.data === 'pong') {
        return;
      }
      try {
        const payload = JSON.parse(event.data) as {
          type?: string;
          queries?: LiveDnsAttributed[];
        };
        if (payload.type !== 'dns_queries' || !payload.queries?.length) {
          return;
        }
        const windowMinutes = minutesRef.current;
        liveQueriesRef.current = filterQueriesWithinMinutes(
          [...payload.queries, ...liveQueriesRef.current],
          windowMinutes,
        );
        const api = apiSnapshotRef.current ?? emptySnapshot(windowMinutes);
        const merged = mergeSnapshotAndLive(api);
        setSnapshot(merged.snapshot);
        setAttribution(merged.attribution);
      } catch {
        // ignore malformed messages
      }
    };

    return () => ws.close();
  }, [minutes, mergeSnapshotAndLive]);

  useEffect(() => {
    loadDeviceIndex();
  }, [loadDeviceIndex]);

  return { snapshot, attribution, loading, error, liveConnected, reload: load };
}
