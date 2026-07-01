/** Human-readable labels for conntrack flow nodes on the network map. */

export function formatFlowNodeLabel(raw: string, max = 20): string {
  const domainMatch = raw.match(/^(TCP|UDP|ICMP)\/(\d+)\s+(\S+)$/i);
  if (domainMatch) {
    const [, , port, host] = domainMatch;
    return truncate(`${host}:${port}`, max);
  }

  const ipMatch = raw.match(/^(TCP|UDP|ICMP)\/(\d+)\s*→\s*(.+)$/i);
  if (ipMatch) {
    const [, , port, ip] = ipMatch;
    return truncate(`${ip}:${port}`, max);
  }

  return truncate(raw, max);
}

export function flowNodeTooltip(raw: string): string {
  const domainMatch = raw.match(/^(TCP|UDP|ICMP)\/(\d+)\s+(\S+)$/i);
  if (domainMatch) {
    const [, proto, port, host] = domainMatch;
    return `Open ${proto.toUpperCase()} connection to ${host} on port ${port}`;
  }

  const ipMatch = raw.match(/^(TCP|UDP|ICMP)\/(\d+)\s*→\s*(.+)$/i);
  if (ipMatch) {
    const [, proto, port, ip] = ipMatch;
    return `Open ${proto.toUpperCase()} connection to ${ip} on port ${port}`;
  }

  return `Live connection · ${raw}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}
