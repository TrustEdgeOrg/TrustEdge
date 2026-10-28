import type { AiSoftwareItem } from '../../twin/types/aiSoftware';
import type { AgentTelemetryEvent } from '../../twin/types/connectedAgent';
import { isAiAgentActionEvent } from './agentActionDisplay';
import { catalogToolsForServer } from './mcpGraphCatalog';

export type McpGraphTool = {
  name: string;
  live: boolean;
  observed: boolean;
  catalog: boolean;
  classification?: string;
  lastSeen?: string;
};

export type McpGraphServer = {
  name: string;
  configured: boolean;
  observed: boolean;
  tools: McpGraphTool[];
};

export type McpGraphHost = {
  id: string;
  label: string;
  productId: string;
  category?: string;
  running: boolean;
  servers: McpGraphServer[];
};

const HOST_IDE_LABELS: Record<string, string> = {
  cursor: 'Cursor',
  vscode: 'VS Code',
};

const HOST_PRODUCT_IDS = new Set(['cursor', 'vscode']);

function hostLabel(item: AiSoftwareItem): string {
  return item.product_name || HOST_IDE_LABELS[item.product_id] || item.product_id || 'AI host';
}

function isMcpHostItem(item: AiSoftwareItem): boolean {
  if ((item.mcp_servers && item.mcp_servers.length > 0) || item.mcp_configured) return true;
  if (item.mcp_server_tools && Object.keys(item.mcp_server_tools).length > 0) return true;
  return HOST_PRODUCT_IDS.has(item.product_id);
}

function observedMcpTools(events: AgentTelemetryEvent[]): Map<string, Map<string, { classification?: string; lastSeen?: string }>> {
  const byServer = new Map<string, Map<string, { classification?: string; lastSeen?: string }>>();
  for (const event of events) {
    if (!isAiAgentActionEvent(event.type)) continue;
    const payload = (event.payload || {}) as Record<string, unknown>;
    if (String(payload.channel || '').toUpperCase() !== 'MCP') continue;
    const server = String(payload.server || '').trim();
    const tool = String(payload.tool || '').trim();
    if (!server || !tool) continue;
    if (!byServer.has(server)) byServer.set(server, new Map());
    const tools = byServer.get(server)!;
    const prev = tools.get(tool);
    const ts = event.ts || '';
    if (!prev || (ts && (!prev.lastSeen || ts > prev.lastSeen))) {
      tools.set(tool, {
        classification: String(payload.classification || '') || undefined,
        lastSeen: ts || undefined,
      });
    }
  }
  return byServer;
}

function buildServerNode(
  serverName: string,
  configured: boolean,
  liveTools: string[] | undefined,
  observedTools: Map<string, { classification?: string; lastSeen?: string }> | undefined
): McpGraphServer {
  const toolMap = new Map<string, McpGraphTool>();

  if (liveTools && liveTools.length > 0) {
    for (const name of liveTools) {
      toolMap.set(name, { name, live: true, observed: false, catalog: false });
    }
  } else {
    for (const name of catalogToolsForServer(serverName)) {
      toolMap.set(name, { name, live: false, observed: false, catalog: true });
    }
  }

  if (observedTools) {
    for (const [name, meta] of observedTools.entries()) {
      const existing = toolMap.get(name);
      if (existing) {
        existing.observed = true;
        existing.classification = meta.classification;
        existing.lastSeen = meta.lastSeen;
      } else {
        toolMap.set(name, {
          name,
          live: false,
          observed: true,
          catalog: false,
          classification: meta.classification,
          lastSeen: meta.lastSeen,
        });
      }
    }
  }

  const tools = [...toolMap.values()].sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    if (a.observed !== b.observed) return a.observed ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    name: serverName,
    configured,
    observed: Boolean(observedTools && observedTools.size > 0),
    tools,
  };
}

/** Build IDE → MCP server → tool graph for one agent. */
export function buildAgentMcpGraph(
  software: AiSoftwareItem[],
  events: AgentTelemetryEvent[]
): McpGraphHost[] {
  const observed = observedMcpTools(events);
  const hosts = software.filter(isMcpHostItem);
  if (!hosts.length) {
    if (observed.size === 0) return [];
    return [
      {
        id: 'mcp-observed',
        label: 'Observed MCP activity',
        productId: 'unknown',
        running: false,
        servers: [...observed.keys()]
          .sort()
          .map((name) => buildServerNode(name, false, undefined, observed.get(name))),
      },
    ];
  }

  return hosts
    .map((item) => {
      const configuredServers = [...(item.mcp_servers || [])].sort();
      const serverNames = new Set(configuredServers);
      if (item.mcp_server_tools) {
        for (const serverName of Object.keys(item.mcp_server_tools)) {
          serverNames.add(serverName);
        }
      }
      for (const [serverName] of observed) {
        serverNames.add(serverName);
      }
      const servers = [...serverNames]
        .sort()
        .map((name) =>
          buildServerNode(
            name,
            configuredServers.includes(name),
            item.mcp_server_tools?.[name],
            observed.get(name)
          )
        );
      return {
        id: item.id,
        label: hostLabel(item),
        productId: item.product_id,
        category: item.category,
        running: item.running,
        servers,
      };
    })
    .filter((host) => host.servers.length > 0 || host.productId === 'cursor' || host.productId === 'vscode');
}
