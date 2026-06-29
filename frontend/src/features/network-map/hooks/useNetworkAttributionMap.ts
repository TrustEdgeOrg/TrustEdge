import { useCallback, useEffect, useRef, useState } from 'react';
import { getDnsQueriesWebSocketUrl } from '../../../shared/config/apiWebSocketUrl';
import { devicesApi } from '../../devices/config/api';
import { fetchNetworkAttributionMap } from '../config/api';
import { mergeLiveQueryIntoMap } from '../utils/mergeLiveQueryIntoMap';
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

export function useNetworkAttributionMap(minutes = 15, pollSec = 30) {
  const [data, setData] = useState<NetworkMapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);
  const ipToDeviceRef = useRef(new Map<string, { deviceId: number; label: string }>());

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
      setData((prev) => mergeMapSnapshots(response, prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load network map');
    } finally {
      setLoading(false);
    }
  }, [minutes, loadDeviceIndex]);

  useEffect(() => {
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
          queries?: Parameters<typeof mergeLiveQueryIntoMap>[1][];
        };
        if (payload.type !== 'dns_queries' || !payload.queries?.length) {
          return;
        }
        setData((prev) => {
          const base = prev ?? emptyMap(minutes);
          return payload.queries!.reduce(
            (graph, query) => mergeLiveQueryIntoMap(graph, query, ipToDeviceRef.current),
            base,
          );
        });
      } catch {
        // ignore malformed messages
      }
    };

    return () => ws.close();
  }, [minutes]);

  useEffect(() => {
    loadDeviceIndex();
  }, [loadDeviceIndex]);

  return { data, loading, error, liveConnected, reload: load };
}
