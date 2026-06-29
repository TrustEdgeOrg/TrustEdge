import { useCallback, useEffect, useRef, useState } from 'react';
import { getDnsQueriesWebSocketUrl } from '../../../shared/config/apiWebSocketUrl';
import { devicesApi } from '../../devices/config/api';
import {
  DEFAULT_NETWORK_MAP_MINUTES,
  DEFAULT_NETWORK_MAP_POLL_SEC,
  fetchNetworkAttributionMap,
} from '../config/api';
import {
  buildLiveMapFromQueries,
  filterQueriesWithinMinutes,
  LiveDnsAttributed,
} from '../utils/mergeLiveQueryIntoMap';
import { mergeMapSnapshots } from '../utils/mergeMapSnapshots';
import { NetworkMapResponse } from '../types/networkMap';

function emptyMap(minutes: number): NetworkMapResponse {
  return {
    generated_at: new Date().toISOString(),
    minutes,
    nodes: [],
    edges: [],
  };
}

export function useNetworkAttributionMap(
  minutes = DEFAULT_NETWORK_MAP_MINUTES,
  pollSec = DEFAULT_NETWORK_MAP_POLL_SEC,
) {
  const [data, setData] = useState<NetworkMapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);
  const ipToDeviceRef = useRef(new Map<string, { deviceId: number; label: string }>());
  const liveQueriesRef = useRef<LiveDnsAttributed[]>([]);
  const apiSnapshotRef = useRef<NetworkMapResponse | null>(null);
  const minutesRef = useRef(minutes);
  minutesRef.current = minutes;

  const mergeApiAndLive = useCallback((api: NetworkMapResponse) => {
    const windowMinutes = minutesRef.current;
    liveQueriesRef.current = filterQueriesWithinMinutes(liveQueriesRef.current, windowMinutes);
    const liveGraph = buildLiveMapFromQueries(
      liveQueriesRef.current,
      windowMinutes,
      ipToDeviceRef.current,
    );
    return mergeMapSnapshots(api, liveGraph.nodes.length > 0 || liveGraph.edges.length > 0 ? liveGraph : null);
  }, []);

  const loadDeviceIndex = useCallback(async () => {
    try {
      const devices = await devicesApi.list();
      const map = new Map<string, { deviceId: number; label: string }>();
      for (const d of devices) {
        if (d.client_ip) {
          map.set(d.client_ip, {
            deviceId: d.id,
            label: d.hostname || d.client_ip,
          });
        }
      }
      ipToDeviceRef.current = map;
    } catch {
      // keep prior index if refresh fails
    }
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      await loadDeviceIndex();
      const response = await fetchNetworkAttributionMap(minutes);
      for (const node of response.nodes) {
        if (node.type === 'device' && node.client_ip && node.device_id != null) {
          ipToDeviceRef.current.set(node.client_ip, {
            deviceId: node.device_id,
            label: node.label,
          });
        }
      }
      apiSnapshotRef.current = response;
      setData(mergeApiAndLive(response));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load network map');
    } finally {
      setLoading(false);
    }
  }, [minutes, loadDeviceIndex, mergeApiAndLive]);

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
        const api = apiSnapshotRef.current ?? emptyMap(windowMinutes);
        setData(mergeApiAndLive(api));
      } catch {
        // ignore malformed messages
      }
    };

    return () => ws.close();
  }, [minutes, mergeApiAndLive]);

  useEffect(() => {
    loadDeviceIndex();
  }, [loadDeviceIndex]);

  return { data, loading, error, liveConnected, reload: load };
}
