export type AiSoftwareListener = {
  addr?: string;
  port?: number;
  protocol?: string;
};

export type AiSoftwareLocalClient = {
  pid?: number;
  executable?: string;
  product_id?: string;
};

export type AiAgentSkill = {
  id: string;
  name: string;
  source: string;
  scope: string;
};

export type AiSoftwareItem = {
  id: string;
  product_id: string;
  product_name: string;
  vendor: string;
  category: string;
  confidence: string;
  confidence_reason?: string;
  installed: boolean;
  running: boolean;
  path: string;
  version: string;
  bundle_id: string;
  executable: string;
  signing_id: string;
  team_id: string;
  signature_valid?: boolean | null;
  matched_evidence?: string[];
  failed_evidence?: string[];
  /** CLI agent fields (empty for GUI .app inventory). */
  invocation_path?: string;
  resolved_path?: string;
  package_manager?: string;
  package_identifier?: string;
  entry_point?: string;
  interpreter?: string;
  /** Local model runtime fields. */
  serving?: boolean;
  exposure?: string;
  listeners?: AiSoftwareListener[];
  models_available?: number;
  model_format?: string;
  runtime_version?: string;
  local_clients?: AiSoftwareLocalClient[];
  /** IDE extension fields. */
  extension_id?: string;
  host_ide_product_id?: string;
  host_ide_path?: string;
  profile?: string;
  /** null/undefined = unknown */
  enabled?: boolean | null;
  active?: boolean | null;
  mcp_configured?: boolean;
  mcp_servers?: string[];
  mcp_server_tools?: Record<string, string[]>;
  local_model_product_id?: string;
  skills?: AiAgentSkill[];
};

export type AiSoftwareListResponse = {
  device_id: string;
  total: number;
  items: AiSoftwareItem[];
};
