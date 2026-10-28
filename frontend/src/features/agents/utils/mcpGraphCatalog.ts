/** Known MCP tool names for configured servers (policy/catalog hints; not live discovery). */
export const MCP_SERVER_CATALOG: Record<string, string[]> = {
  github: [
    'get_file_contents',
    'search_code',
    'issue_read',
    'list_issues',
    'create_pull_request',
    'create_or_update_file',
    'push_files',
  ],
  slack: [
    'slack_list_channels',
    'slack_get_channel_history',
    'slack_get_thread_replies',
    'slack_get_users',
    'slack_get_user_profile',
    'slack_post_message',
    'slack_reply_to_thread',
    'slack_add_reaction',
  ],
  'customer-db': ['query_customers'],
};

export function catalogToolsForServer(server: string): string[] {
  const key = server.trim().toLowerCase();
  return MCP_SERVER_CATALOG[key] ? [...MCP_SERVER_CATALOG[key]] : [];
}
