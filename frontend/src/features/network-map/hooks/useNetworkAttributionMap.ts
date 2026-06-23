import { useCallback, useEffect, useRef, useState } from 'react';
import { getDnsQueriesWebSocketUrl } from '../../../shared/config/apiWebSocketUrl';
import { devicesApi } from '../../devices/config/api';
import { fetchNetworkAttributionMap } from '../config/api';
import { mergeMapSnapshots } from '../utils/mergeMapSnapshots';
import { NetworkMapEdge, NetworkMapResponse } from '../types/networkMap';

interface LiveDnsAttributed {
  timestamp: string;
  client_ip: string;
  domain: string;
  blocked: boolean;
  attributed_app_slug?: string | null;
  attributed_app_display_name?: string | null;
}

type DeviceLookup = { deviceId: number; label: string };

function emptyMap(minutes: number): NetworkMapResponse {
  return {
    generated_at: new Date().toISOString(),
    minutes,
    nodes: [],
    edges: [],
  };
}

function mergeLiveQuery(
  graph: NetworkMapResponse,
  query: LiveDnsAttributed,
  ipToDevice: Map<string, DeviceLookup>,
): NetworkMapResponse {
  const mapped = ipToDevice.get(query.client_ip);
  const label = mapped?.label ?? query.client_ip;
  const numericId = mapped?.deviceId ?? 0;
  const deviceNodeId = numericId > 0 ? `device:${numericId}` : `device:ip:${query.client_ip}`;
  const domainId = `domain:${query.domain}`;

  const slug = query.attributed_app_slug?.trim();
  if (!slug) {
    const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
    if (!nodes.has(deviceNodeId)) {
      nodes.set(deviceNodeId, {
        id: deviceNodeId,
        type: 'device',
        label,
        client_ip: query.client_ip,
        device_id: numericId > 0 ? numericId : null,
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
    const directKey = `${deviceNodeId}|${domainId}|dns_direct`;
    const prevDirect = edges.get(directKey);
    if (prevDirect) {
      edges.set(directKey, {
        ...prevDirect,
        query_count: prevDirect.query_count + 1,
        blocked_count: prevDirect.blocked_count + (query.blocked ? 1 : 0),
      });
    } else {
      edges.set(directKey, {
        source: deviceNodeId,
        target: domainId,
        kind: 'dns_direct',
        query_count: 1,
        blocked_count: query.blocked ? 1 : 0,
      });
    }
    return { ...graph, nodes: Array.from(nodes.values()), edges: Array.from(edges.values()) };
  }

  const appId = `app:${slug}`;
  const display = query.attributed_app_display_name || slug.replace(/_/g, ' ');

  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  if (!nodes.has(deviceNodeId)) {
    nodes.set(deviceNodeId, {
      id: deviceNodeId,
      type: 'device',
      label,
      client_ip: query.client_ip,
      device_id: numericId > 0 ? numericId : null,
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

  const fgKey = `${deviceNodeId}|${appId}|foreground`;
  if (!edges.has(fgKey)) {
    edges.set(fgKey, { source: deviceNodeId, target: appId, kind: 'foreground', query_count: 1, blocked_count: 0 });
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
  const ipToDeviceRef = useRef(new Map<string, DeviceLookup>());

  const loadDeviceIndex = useCallback(async () => {
    try {
      const devices = await devicesApi.list();
      const map = new Map<string, DeviceLookup>();
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
          queries?: LiveDnsAttributed[];
        };
        if (payload.type !== 'dns_queries' || !payload.queries?.length) {
          return;
        }
        setData((prev) => {
          const base = prev ?? emptyMap(minutes);
          return payload.queries!.reduce(
            (graph, query) => mergeLiveQuery(graph, query, ipToDeviceRef.current),
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
