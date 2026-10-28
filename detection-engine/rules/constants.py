from typing import Final

# Stable event type values emitted by TrustEdge Agent telemetry.
TYPE_CLIENT_DETAILS: Final = "client_details"
TYPE_NETWORK_SUMMARY: Final = "network_summary"
TYPE_ACTION_SUMMARY: Final = "action_summary"
TYPE_PROCESS_START: Final = "process_start"
TYPE_PROCESS_EXIT: Final = "process_exit"
TYPE_DRIVER_LOAD: Final = "driver_load"
TYPE_SERVICE_INSTALL: Final = "service_install"
TYPE_REGISTRY_PERSISTENCE: Final = "registry_persistence"
TYPE_NETWORK_CONNECTION: Final = "network_connection"
TYPE_FILE_WRITE: Final = "file_write"
TYPE_FILE_OPEN: Final = "file_open"

PRESENCE_ACTIVE: Final = "active"
PRESENCE_IDLE: Final = "idle"

# Alert severity levels (ordered low -> high).
SEVERITY_LOW: Final = "low"
SEVERITY_MEDIUM: Final = "medium"
SEVERITY_HIGH: Final = "high"

# Relative ranking used to keep the most severe alert when deduping.
SEVERITY_RANK: Final[dict[str, int]] = {
    SEVERITY_LOW: 1,
    SEVERITY_MEDIUM: 2,
    SEVERITY_HIGH: 3,
}

# Points added to ProcessState.current_risk_score when a rule matches.
SEVERITY_SCORE: Final[dict[str, int]] = {
    SEVERITY_LOW: 25,
    SEVERITY_MEDIUM: 50,
    SEVERITY_HIGH: 75,
}

# Stable alert type values used by the ingest API and UI.
ALERT_NEW_PUBLIC_IP: Final = "new_public_ip"
ALERT_NETWORK_TYPE_CHANGE: Final = "network_type_change"
ALERT_NETWORK_CHANGE_WHILE_ACTIVE: Final = "network_change_while_active"
ALERT_SIMULTANEOUS_IP_AND_TYPE_CHANGE: Final = "simultaneous_ip_and_type_change"
ALERT_RAPID_PUBLIC_IP_CHANGES: Final = "rapid_public_ip_changes"
ALERT_DOUBLE_IP_CHANGE_10M: Final = "double_ip_change_10m"
ALERT_NETWORK_TYPE_FLAPPING: Final = "network_type_flapping"
ALERT_NETWORK_FLAP_5M: Final = "network_flap_5m"
ALERT_REPEATED_NETWORK_SUMMARY: Final = "repeated_network_summary"
ALERT_ESTABLISHED_COUNT_SPIKE: Final = "established_count_spike"
ALERT_LISTENING_PORT_SPIKE: Final = "listening_port_spike"
ALERT_FOREGROUND_CONNECTIONS_SPIKE: Final = "foreground_connections_spike"
ALERT_HIGH_LISTENING_WHILE_ACTIVE: Final = "high_listening_while_active"
ALERT_IP_CHANGE_WHILE_IDLE: Final = "ip_change_while_idle"
ALERT_ACTIVE_IP_CHURN: Final = "active_ip_churn"
ALERT_STALE_CLIENT_DETAILS: Final = "stale_client_details"
ALERT_MISSING_NETWORK_TELEMETRY: Final = "missing_network_telemetry"
ALERT_IDLE_WITH_NETWORK_ACTIVITY: Final = "idle_with_network_activity"
ALERT_TEMP_PATH_EXECUTION: Final = "temp_path_execution"
ALERT_SHELL_SPAWNS_DOWNLOADER: Final = "shell_spawns_downloader"
ALERT_AI_TOOL_EXECUTION: Final = "ai_tool_execution"
ALERT_SHELL_SPAWNS_AI_TOOL: Final = "shell_spawns_ai_tool"
ALERT_SCRIPT_SPAWNS_SHELL: Final = "script_spawns_shell"
ALERT_BINARY_PATH_MISMATCH: Final = "binary_path_mismatch"
ALERT_NOVEL_PROCESS: Final = "novel_process"
ALERT_AI_NOVEL_CURSOR_TOOL: Final = "ai_novel_cursor_tool"
ALERT_DRIVER_LOAD: Final = "driver_load"
ALERT_SERVICE_INSTALL: Final = "service_install"
ALERT_REGISTRY_PERSISTENCE: Final = "registry_persistence"
ALERT_DROPPER_BEHAVIOR: Final = "dropper_behavior"
ALERT_PERSISTENCE_WITH_NETWORK: Final = "persistence_with_network"
ALERT_ELEVATED_PROCESS_RISK: Final = "elevated_process_risk"
ALERT_PROCESS_NETWORK_ACTIVITY: Final = "process_network_activity"

# Windowed rules use these buckets to suppress repeated alerts.
COOLDOWN_SECONDS: Final[dict[str, int]] = {
    ALERT_RAPID_PUBLIC_IP_CHANGES: 15 * 60,
    ALERT_DOUBLE_IP_CHANGE_10M: 10 * 60,
    ALERT_NETWORK_TYPE_FLAPPING: 10 * 60,
    ALERT_NETWORK_FLAP_5M: 5 * 60,
    ALERT_REPEATED_NETWORK_SUMMARY: 10 * 60,
    ALERT_ESTABLISHED_COUNT_SPIKE: 15 * 60,
    ALERT_LISTENING_PORT_SPIKE: 15 * 60,
    ALERT_FOREGROUND_CONNECTIONS_SPIKE: 15 * 60,
    ALERT_HIGH_LISTENING_WHILE_ACTIVE: 5 * 60,
    ALERT_NETWORK_CHANGE_WHILE_ACTIVE: 5 * 60,
    ALERT_IP_CHANGE_WHILE_IDLE: 5 * 60,
    ALERT_ACTIVE_IP_CHURN: 30 * 60,
    ALERT_STALE_CLIENT_DETAILS: 20 * 60,
    ALERT_MISSING_NETWORK_TELEMETRY: 30 * 60,
    ALERT_IDLE_WITH_NETWORK_ACTIVITY: 15 * 60,
}
