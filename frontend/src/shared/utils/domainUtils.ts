/** Known multi-part TLDs — keep in sync with backend domain_utils.py */
const MULTI_PART_TLDS = new Set([
  'co.il', 'co.uk', 'co.jp', 'co.kr', 'co.nz', 'co.za', 'co.in',
  'com.au', 'com.br', 'com.cn', 'com.mx', 'com.tw', 'com.ar',
  'com.tr', 'com.sg', 'com.hk', 'com.my', 'com.ph', 'com.pk',
  'org.uk', 'org.au', 'org.il',
  'net.au', 'net.il', 'net.br',
  'ac.uk', 'ac.il', 'ac.jp',
  'gov.uk', 'gov.au', 'gov.il',
  'edu.au', 'edu.cn',
]);

/** Extract registrable root domain (e.g. www.ynet.co.il → ynet.co.il). */
export function extractRootDomain(domain: string): string {
  const normalized = domain.toLowerCase().replace(/\.$/, '');
  const parts = normalized.split('.');

  if (parts.length <= 2) {
    return normalized;
  }

  const potentialTld = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  if (MULTI_PART_TLDS.has(potentialTld)) {
    return parts.slice(-3).join('.');
  }

  return parts.slice(-2).join('.');
}
