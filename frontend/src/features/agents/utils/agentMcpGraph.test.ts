import { buildAgentMcpGraph } from './agentMcpGraph';
import type { AiSoftwareItem } from '../../twin/types/aiSoftware';

const cursorHost: AiSoftwareItem = {
  id: 'cursor:/applications/cursor.app',
  product_id: 'cursor',
  product_name: 'Cursor',
  vendor: 'Cursor',
  category: 'code_editor',
  confidence: 'LOW',
  installed: true,
  running: true,
  path: '/Applications/Cursor.app',
  version: '1.0',
  bundle_id: '',
  executable: 'Cursor',
  signing_id: '',
  team_id: '',
  mcp_configured: true,
  mcp_servers: ['github'],
  mcp_server_tools: {
    github: ['get_file_contents', 'list_issues', 'search_code'],
  },
};

describe('buildAgentMcpGraph', () => {
  it('maps configured MCP servers and live tools onto host IDE', () => {
    const graph = buildAgentMcpGraph([cursorHost], []);
    expect(graph).toHaveLength(1);
    expect(graph[0].label).toBe('Cursor');
    expect(graph[0].servers).toHaveLength(1);
    expect(graph[0].servers[0].name).toBe('github');
    expect(graph[0].servers[0].configured).toBe(true);
    const listIssues = graph[0].servers[0].tools.find((t) => t.name === 'list_issues');
    expect(listIssues?.live).toBe(true);
  });

  it('falls back to catalog tools when live discovery is missing', () => {
    const host = { ...cursorHost, mcp_server_tools: undefined };
    const graph = buildAgentMcpGraph([host], []);
    const tool = graph[0].servers[0].tools.find((t) => t.name === 'list_issues');
    expect(tool?.catalog).toBe(true);
    expect(tool?.live).toBe(false);
  });

  it('marks observed MCP tools from agent actions', () => {
    const graph = buildAgentMcpGraph([cursorHost], [
      {
        event_id: '1',
        type: 'ai_agent_action',
        ts: '2026-08-28T12:00:00Z',
        payload: {
          channel: 'MCP',
          server: 'github',
          tool: 'list_issues',
          classification: 'read_only',
        },
      },
    ]);
    const tool = graph[0].servers[0].tools.find((t) => t.name === 'list_issues');
    expect(tool?.observed).toBe(true);
    expect(tool?.classification).toBe('read_only');
  });
});
