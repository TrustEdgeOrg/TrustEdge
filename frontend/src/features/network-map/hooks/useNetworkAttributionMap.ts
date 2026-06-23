import { useCallback, useEffect, useRef, useState } from 'react';
import { getDnsQueriesWebSocketUrl } from '../../../shared/config/apiWebSocketUrl';
import { fetchNetworkAttributionMap } from '../config/api';
import { NetworkMapEdge, NetworkMapResponse } from '../types/networkMap';

interface LiveDnsAttributed {
  timestamp: string;
  client_ip: string;
  domain: string;
  blocked: boolean;
  attributed_app_slug?: string | null;
  attributed_app_display_name?: string | null;
}

function mergeLiveQuery(
  graph: NetworkMapResponse,
  query: LiveDnsAttributed,
  ipToDevice: Map<string, { deviceId: number; label: string }>,
): NetworkMapResponse {
  const slug = query.attributed_app_slug?.trim();
  if (!slug) {
    return graph;
  }

  const device = ipToDevice.get(query.client_ip);
  if (!device) {
    return graph;
  }

  const deviceId = `device:${device.deviceId}`;
  const appId = `app:${slug}`;
  const domainId = `domain:${query.domain}`;
  const display = query.attributed_app_display_name || slug.replace(/_/g, ' ');

  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  if (!nodes.has(deviceId)) {
    nodes.set(deviceId, {
      id: deviceId,
      type: 'device',
      label: device.label,
      client_ip: query.client_ip,
      device_id: device.deviceId,
      fresh: true,
    });
  }
  if (!nodes.has(appId)) {
    nodes.set(appId, {
      id: appId,
      type: 'app',
      label: display,
      app_slug: slug,
    });
  }
  const existingDomain = nodes.get(domainId);
  nodes.set(domainId, {
    id: domainId,
    type: 'domain',
    label: query.domain,
    blocked: query.blocked || existingDomain?.blocked || false,
  });

  const edgeKey = (e: NetworkMapEdge) => `${e.source}|${e.target}|${e.kind}`;
  const edges = new Map(graph.edges.map((e) => [edgeKey(e), e]));

  const fgKey = `${deviceId}|${appId}|foreground`;
  if (!edges.has(fgKey)) {
    edges.set(fgKey, { source: deviceId, target: appId, kind: 'foreground', query_count: 1, blocked_count: 0 });
  }

  const dnsKey = `${appId}|${domainId}|dns`;
  const prev = edges.get(dnsKey);
  if (prev) {
    edges.set(dnsKey, {
      ...prev,
      query_count: prev.query_count + 1,
      blocked_count: prev.blocked_count + (query.blocked ? 1 : 0),
    });
  } else {
    edges.set(dnsKey, {
      source: appId,
      target: domainId,
      kind: 'dns',
      query_count: 1,
      blocked_count: query.blocked ? 1 : 0,
    });
  }

  return {
    ...graph,
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  };
}

export function useNetworkAttributionMap(minutes = 15, pollSec = 30) {
  const [data, setData] = useState<NetworkMapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);
  const ipToDeviceRef = useRef(new Map<string, { deviceId: number; label: string }>());

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetchNetworkAttributionMap(minutes);
      const map = new Map<string, { deviceId: number; label: string }>();
      for (const node of response.nodes) {
        if (node.type === 'device' && node.client_ip && node.device_id != null) {
          map.set(node.client_ip, { deviceId: node.device_id, label: node.label });
        }
      }
      ipToDeviceRef.current = map;
      setData(response);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load network map');
    } finally {
      setLoading(false);
    }
  }, [minutes]);

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
          queries?: LiveDnsAttributed[];
        };
        if (payload.type !== 'dns_queries' || !payload.queries?.length) {
          return;
        }
        setData((prev) => {
          if (!prev) {
            return prev;
          }
          return payload.queries!.reduce(
            (graph, query) => mergeLiveQuery(graph, query, ipToDeviceRef.current),
            prev,
          );
        });
      } catch {
        // ignore malformed messages
      }
    };

    return () => ws.close();
  }, []);

  return { data, loading, error, liveConnected, reload: load };
}
