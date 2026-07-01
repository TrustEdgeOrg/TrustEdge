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

  const idMatch = node.id.match(/^flow:([a-z]+):([^:]+):(\d+)$/i);
  if (!idMatch) {
    return null;
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

export function portNodeTooltip(protocol: string, port: number): string {
  const name = WELL_KNOWN_PORTS[port];
  const upper = protocol.toUpperCase();
  if (name) {
    return `${upper} port ${port} (${name})`;
  }
  return `${upper} port ${port}`;
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

export function globalPortNodeId(protocol: string, port: number): string {
  return `port:${protocol.toLowerCase()}:${port}`;
}

/** @deprecated Use globalPortNodeId — ports are network-wide, not per parent. */
export function portNodeId(_parentId: string, protocol: string, port: number): string {
  return globalPortNodeId(protocol, port);
}

export function parsePortNodeId(portId: string): { protocol: string; port: number } | null {
  const match = portId.match(/^port:([a-z]+):(\d+)$/i);
  if (!match) {
    return null;
  }
  const portNum = Number(match[2]);
  if (!Number.isFinite(portNum)) {
    return null;
  }
  return { protocol: match[1].toLowerCase(), port: portNum };
}
