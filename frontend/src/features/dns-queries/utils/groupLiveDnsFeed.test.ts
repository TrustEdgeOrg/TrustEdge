import { groupLiveDnsByRoot } from './groupLiveDnsFeed';
import type { LiveDnsQuery } from '../hooks/useDnsLiveFeed';

function query(overrides: Partial<LiveDnsQuery> & Pick<LiveDnsQuery, 'domain'>): LiveDnsQuery {
  return {
    timestamp: '2026-06-29T12:00:00Z',
    client_ip: '10.0.0.2',
    query_type: 'A',
    action: 'forwarded',
    blocked: false,
    ...overrides,
  };
}

describe('groupLiveDnsByRoot', () => {
  it('merges subdomains under the same root domain', () => {
    const grouped = groupLiveDnsByRoot([
      query({ domain: 'www.google.com', timestamp: '2026-06-29T12:01:00Z' }),
      query({ domain: 'mail.google.com', timestamp: '2026-06-29T12:00:00Z' }),
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].rootDomain).toBe('google.com');
    expect(grouped[0].queryCount).toBe(2);
    expect(grouped[0].latestTimestamp).toBe('2026-06-29T12:01:00Z');
    expect(grouped[0].sampleDomains).toEqual(['www.google.com', 'mail.google.com']);
  });

  it('keeps separate rows per client IP', () => {
    const grouped = groupLiveDnsByRoot([
      query({ domain: 'example.com', client_ip: '10.0.0.2' }),
      query({ domain: 'www.example.com', client_ip: '10.0.0.3' }),
    ]);

    expect(grouped).toHaveLength(2);
  });

  it('tracks blocked counts', () => {
    const grouped = groupLiveDnsByRoot([
      query({ domain: 'blocked.example.com', blocked: true }),
      query({ domain: 'allowed.example.com', blocked: false }),
    ]);

    expect(grouped[0].rootDomain).toBe('example.com');
    expect(grouped[0].blockedCount).toBe(1);
    expect(grouped[0].queryCount).toBe(2);
  });
});
