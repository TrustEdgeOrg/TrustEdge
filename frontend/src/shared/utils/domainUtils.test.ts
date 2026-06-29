import { extractRootDomain } from './domainUtils';

describe('extractRootDomain', () => {
  it('returns two-label domains unchanged', () => {
    expect(extractRootDomain('google.com')).toBe('google.com');
  });

  it('strips subdomains', () => {
    expect(extractRootDomain('www.ynet.co.il')).toBe('ynet.co.il');
    expect(extractRootDomain('cdn.taboola.com')).toBe('taboola.com');
  });

  it('handles multi-part TLDs', () => {
    expect(extractRootDomain('api.example.co.uk')).toBe('example.co.uk');
  });

  it('collapses Apple CDN hostnames to akadns.net', () => {
    expect(extractRootDomain('gs-loc-new.ls-apple.com.akadns.net')).toBe('akadns.net');
  });
});
