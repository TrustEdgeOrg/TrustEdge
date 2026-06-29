import { NetworkMapEdge, NetworkMapNode } from '../types/networkMap';

export function edgeKey(edge: NetworkMapEdge): string {
  return `${edge.source}|${edge.target}|${edge.kind}`;
}

export interface WhatIfSimulationResult {
  disabledAppIds: Set<string>;
  disabledEdgeKeys: Set<string>;
  simulatedBlockedDomainIds: Set<string>;
  affectedQueryCount: number;
  affectedDomainCount: number;
}

export function computeWhatIfSimulation(
  nodes: NetworkMapNode[],
  edges: NetworkMapEdge[],
  disabledAppIds: Set<string>,
): WhatIfSimulationResult {
  const empty: WhatIfSimulationResult = {
    disabledAppIds,
    disabledEdgeKeys: new Set(),
    simulatedBlockedDomainIds: new Set(),
    affectedQueryCount: 0,
    affectedDomainCount: 0,
  };

  if (disabledAppIds.size === 0 || nodes.length === 0) {
    return empty;
  }

  const disabledEdgeKeys = new Set<string>();
  let affectedQueryCount = 0;

  const domainAppSources = new Map<string, Set<string>>();
  const domainsWithDirect = new Set<string>();

  for (const edge of edges) {
    if (edge.kind === 'dns') {
      const sources = domainAppSources.get(edge.target) ?? new Set<string>();
      sources.add(edge.source);
      domainAppSources.set(edge.target, sources);

      if (disabledAppIds.has(edge.source)) {
        disabledEdgeKeys.add(edgeKey(edge));
        affectedQueryCount += edge.query_count;
      }
    } else if (edge.kind === 'dns_direct') {
      domainsWithDirect.add(edge.target);
    } else if (edge.kind === 'foreground' && disabledAppIds.has(edge.target)) {
      disabledEdgeKeys.add(edgeKey(edge));
    }
  }

  const simulatedBlockedDomainIds = new Set<string>();
  for (const [domainId, appSources] of domainAppSources) {
    const activeSources = [...appSources].filter((appId) => !disabledAppIds.has(appId));
    const touchedByDisabled = [...appSources].some((appId) => disabledAppIds.has(appId));
    if (touchedByDisabled && activeSources.length === 0 && !domainsWithDirect.has(domainId)) {
      simulatedBlockedDomainIds.add(domainId);
    }
  }

  return {
    disabledAppIds,
    disabledEdgeKeys,
    simulatedBlockedDomainIds,
    affectedQueryCount,
    affectedDomainCount: simulatedBlockedDomainIds.size,
  };
}

export function toggleDisabledApp(current: Set<string>, appNodeId: string): Set<string> {
  const next = new Set(current);
  if (next.has(appNodeId)) {
    next.delete(appNodeId);
  } else {
    next.add(appNodeId);
  }
  return next;
}
