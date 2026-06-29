import { extractRootDomain } from '../../../shared/utils/domainUtils';
import type { LiveDnsQuery } from '../hooks/useDnsLiveFeed';

export interface GroupedLiveDnsEntry {
  rootDomain: string;
  clientIp: string;
  latestTimestamp: string;
  queryCount: number;
  blockedCount: number;
  sampleDomains: string[];
  attributed_app_slug?: string | null;
  attributed_app_display_name?: string | null;
}

const MAX_SAMPLE_DOMAINS = 5;

function groupKey(rootDomain: string, clientIp: string): string {
  return `${rootDomain}|${clientIp}`;
}

/** Collapse subdomain noise into one row per root domain + client IP (feed is newest-first). */
export function groupLiveDnsByRoot(queries: LiveDnsQuery[]): GroupedLiveDnsEntry[] {
  const groups = new Map<string, GroupedLiveDnsEntry>();
  const order: string[] = [];

  for (const query of queries) {
    const rootDomain = extractRootDomain(query.domain);
    const key = groupKey(rootDomain, query.client_ip);
    const domainLower = query.domain.toLowerCase();

    const existing = groups.get(key);
    if (existing) {
      existing.queryCount += 1;
      if (query.blocked) {
        existing.blockedCount += 1;
      }
      if (
        domainLower !== rootDomain
        && !existing.sampleDomains.includes(domainLower)
        && existing.sampleDomains.length < MAX_SAMPLE_DOMAINS
      ) {
        existing.sampleDomains.push(domainLower);
      }
      continue;
    }

    order.push(key);
    groups.set(key, {
      rootDomain,
      clientIp: query.client_ip,
      latestTimestamp: query.timestamp,
      queryCount: 1,
      blockedCount: query.blocked ? 1 : 0,
      sampleDomains: domainLower !== rootDomain ? [domainLower] : [],
      attributed_app_slug: query.attributed_app_slug,
      attributed_app_display_name: query.attributed_app_display_name,
    });
  }

  return order.map((key) => groups.get(key)!);
}
