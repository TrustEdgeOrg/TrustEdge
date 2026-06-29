import { extractRootDomain } from '../../../shared/utils/domainUtils';
import { NetworkMapEdge, NetworkMapResponse } from '../types/networkMap';

export interface LiveDnsAttributed {
  timestamp: string;
  client_ip: string;
  domain: string;
  blocked: boolean;
  attributed_app_slug?: string | null;
  attributed_app_display_name?: string | null;
}

type DeviceLookup = { deviceId: number; label: string };

function edgeKey(edge: NetworkMapEdge): string {
  return `${edge.source}|${edge.target}|${edge.kind}`;
}

export function mergeLiveQueryIntoMap(
  graph: NetworkMapResponse,
  query: LiveDnsAttributed,
  ipToDevice: Map<string, DeviceLookup>,
): NetworkMapResponse {
  const mapped = ipToDevice.get(query.client_ip);
  const label = mapped?.label ?? query.client_ip;
  const numericId = mapped?.deviceId ?? 0;
  const deviceNodeId = numericId > 0 ? `device:${numericId}` : `device:ip:${query.client_ip}`;
  const rootDomain = extractRootDomain(query.domain);
  const domainId = `domain:${rootDomain}`;

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
      label: rootDomain,
      blocked: query.blocked || existingDomain?.blocked || false,
    });
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
    label: rootDomain,
    blocked: query.blocked || existingDomain?.blocked || false,
  });

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
