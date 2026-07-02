export interface ParsedFlowLabel {
  protocol: string;
  port: number;
  destination: string;
  destinationKind: 'domain' | 'ip';
}

export function parseFlowNode(
  node: { id: string; type: string; label: string },
): ParsedFlowLabel | null {
  if (node.type !== 'flow') {
    return null;
  }

  const labelMatch =
    node.label.match(/^(TCP|UDP|ICMP)\/(\d+)\s+(\S+)$/i) ??
    node.label.match(/^(TCP|UDP|ICMP)\/(\d+)\s*→\s*(.+)$/i);
  if (labelMatch) {
    const [, protocol, portText, destination] = labelMatch;
    const port = Number(portText);
    if (!Number.isFinite(port)) {
      return null;
    }
    return {
      protocol: protocol.toLowerCase(),
      port,
      destination,
      destinationKind: /^\d+\.\d+\.\d+\.\d+$/.test(destination) ? 'ip' : 'domain',
    };
  }

  const idMatch =
    node.id.match(/^flow:([a-z]+):([^:]+):(\d+):(.+)$/i) ??
    node.id.match(/^flow:([a-z]+):([^:]+):(\d+)$/i);
  if (!idMatch) {
    return null;
  }
  if (idMatch.length === 5) {
    const [, protocol, destination, portText] = idMatch;
    const port = Number(portText);
    if (!Number.isFinite(port)) {
      return null;
    }
    return {
      protocol: protocol.toLowerCase(),
      port,
      destination,
      destinationKind: /^\d+\.\d+\.\d+\.\d+$/.test(destination) ? 'ip' : 'domain',
    };
  }
  const [, protocol, destination, portText] = idMatch;
  const port = Number(portText);
  if (!Number.isFinite(port)) {
    return null;
  }
  return {
    protocol: protocol.toLowerCase(),
    port,
    destination,
    destinationKind: /^\d+\.\d+\.\d+\.\d+$/.test(destination) ? 'ip' : 'domain',
  };
}

const WELL_KNOWN_PORTS: Record<number, string> = {
  443: 'HTTPS',
  80: 'HTTP',
  53: 'DNS',
  5222: 'XMPP/chat',
  22: 'SSH',
  3389: 'RDP',
};

export function portNodeTooltip(port: number): string {
  const name = WELL_KNOWN_PORTS[port];
  if (name) {
    return `Port ${port} (${name}) — all traffic on this port`;
  }
  return `Port ${port} — network-wide (TCP + UDP)`;
}

export function formatFlowNodeLabel(raw: string, max = 20): string {
  const parsed = parseFlowNode({ id: '', type: 'flow', label: raw });
  if (parsed) {
    return truncate(parsed.destination, max);
  }
  return truncate(raw, max);
}

export function flowNodeTooltip(raw: string): string {
  const parsed = parseFlowNode({ id: '', type: 'flow', label: raw });
  if (parsed) {
    return `Open ${parsed.protocol.toUpperCase()} connection to ${parsed.destination} on port ${parsed.port}`;
  }
  return `Live connection · ${raw}`;
}

export function flowDestinationTooltip(
  destination: string,
  protocol: string,
  port: number,
): string {
  return `Open ${protocol.toUpperCase()} connection to ${destination} on port ${port}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

/** One hub per port number for the whole VPN (TCP + UDP merged). */
export function globalPortNodeId(_protocol: string, port: number): string {
  return `port:${port}`;
}

/** @deprecated Use globalPortNodeId — ports are network-wide, not per parent. */
export function portNodeId(_parentId: string, protocol: string, port: number): string {
  return globalPortNodeId(protocol, port);
}

export function parsePortNodeId(portId: string): { port: number } | null {
  const match = portId.match(/^port:(\d+)$/);
  if (!match) {
    return null;
  }
  const portNum = Number(match[1]);
  if (!Number.isFinite(portNum)) {
    return null;
  }
  return { port: portNum };
}
