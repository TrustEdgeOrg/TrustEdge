"""Static classification catalogs for AI apps, roles, tools, secrets, domains."""

from __future__ import annotations

from typing import Final

# ---------------------------------------------------------------------------
# AI application roots (basename / comm, lowercased)
# ---------------------------------------------------------------------------

AI_APP_ROOTS: Final[dict[str, str]] = {
    # Cursor
    "cursor": "cursor",
    "cursorui": "cursor",
    "cursor-agent": "cursor",
    # Claude Desktop
    "claude": "claude",
    # VS Code
    "code": "vscode",
    "code-insiders": "vscode",
    # Windsurf
    "windsurf": "windsurf",
    # Continue / Cline host CLIs (extension hosts classified via cmdline)
    "continue": "continue",
    "cline": "cline",
    # OpenAI Codex / related
    "codex": "codex",
    "chatgpt": "chatgpt",
    # Other AI CLIs that can be session roots
    "aider": "aider",
    "goose": "goose",
    "open-interpreter": "open_interpreter",
    "interpreter": "open_interpreter",
    "amp": "amp",
}

# Electron helper prefixes that belong to an AI IDE but are not session roots
# unless no root is present yet (orphaned helper → deferred until root known).
AI_HELPER_NAME_MARKERS: Final[tuple[str, ...]] = (
    "cursor helper",
    "cursor helper (gpu)",
    "cursor helper (plugin)",
    "cursor helper (renderer)",
    "code helper",
    "code helper (gpu)",
    "code helper (plugin)",
    "code helper (renderer)",
    "windsurf helper",
    "claude helper",
)

# Cmdline markers that identify AI-related extension hosts / agents
AI_CMDLINE_MARKERS: Final[tuple[str, ...]] = (
    "extension-host",
    "extensionhost",
    "--type=extensionhost",
    "copilot",
    "continue.dev",
    "continue.",
    "cline",
    "cursor",
    "anthropic",
    "openai",
    "windsurf",
)

# ---------------------------------------------------------------------------
# Process roles within an AI session
# ---------------------------------------------------------------------------

ROLE_ROOT: Final = "root"
ROLE_RENDERER: Final = "renderer"
ROLE_EXTENSION_HOST: Final = "extension_host"
ROLE_PTY_HOST: Final = "pty_host"
ROLE_TERMINAL: Final = "terminal"
ROLE_SHELL: Final = "shell"
ROLE_TOOL: Final = "tool"
ROLE_HELPER: Final = "helper"
ROLE_UNKNOWN: Final = "unknown"

PROCESS_ROLES: Final[frozenset[str]] = frozenset(
    {
        ROLE_ROOT,
        ROLE_RENDERER,
        ROLE_EXTENSION_HOST,
        ROLE_PTY_HOST,
        ROLE_TERMINAL,
        ROLE_SHELL,
        ROLE_TOOL,
        ROLE_HELPER,
        ROLE_UNKNOWN,
    }
)

# ---------------------------------------------------------------------------
# Tool classes (basename → class)
# ---------------------------------------------------------------------------

TOOL_SHELL: Final = "shell"
TOOL_GIT: Final = "git"
TOOL_DOCKER: Final = "docker"
TOOL_SSH: Final = "ssh"
TOOL_AWS: Final = "aws"
TOOL_KUBECTL: Final = "kubectl"
TOOL_NPM: Final = "npm"
TOOL_PIP: Final = "pip"
TOOL_PYTHON: Final = "python"
TOOL_NODE: Final = "node"
TOOL_CURL: Final = "curl"
TOOL_OTHER: Final = "other"

TOOL_BASENAMES: Final[dict[str, str]] = {
    "sh": TOOL_SHELL,
    "bash": TOOL_SHELL,
    "zsh": TOOL_SHELL,
    "fish": TOOL_SHELL,
    "dash": TOOL_SHELL,
    "ksh": TOOL_SHELL,
    "git": TOOL_GIT,
    "docker": TOOL_DOCKER,
    "docker-compose": TOOL_DOCKER,
    "docker-compose.exe": TOOL_DOCKER,
    "podman": TOOL_DOCKER,
    "ssh": TOOL_SSH,
    "scp": TOOL_SSH,
    "sftp": TOOL_SSH,
    "aws": TOOL_AWS,
    "aws.cmd": TOOL_AWS,
    "kubectl": TOOL_KUBECTL,
    "helm": TOOL_KUBECTL,
    "npm": TOOL_NPM,
    "npx": TOOL_NPM,
    "yarn": TOOL_NPM,
    "pnpm": TOOL_NPM,
    "pip": TOOL_PIP,
    "pip3": TOOL_PIP,
    "pipx": TOOL_PIP,
    "uv": TOOL_PIP,
    "python": TOOL_PYTHON,
    "python3": TOOL_PYTHON,
    "python3.11": TOOL_PYTHON,
    "python3.12": TOOL_PYTHON,
    "python3.13": TOOL_PYTHON,
    "node": TOOL_NODE,
    "nodejs": TOOL_NODE,
    "curl": TOOL_CURL,
    "wget": TOOL_CURL,
    "fetch": TOOL_CURL,
}

SHELL_BASENAMES: Final[frozenset[str]] = frozenset(
    {"sh", "bash", "zsh", "fish", "dash", "ksh"}
)

# ---------------------------------------------------------------------------
# Secrets / sensitive path substrings (lowercase)
# ---------------------------------------------------------------------------

SECRET_PATH_MARKERS: Final[tuple[str, ...]] = (
    "/.ssh/",
    "\\.ssh\\",
    "~/.ssh",
    "/.aws/",
    "\\.aws\\",
    "~/.aws",
    "/.kube/",
    "\\.kube\\",
    "~/.kube",
    "/.gnupg/",
    "id_rsa",
    "id_ed25519",
    "id_ecdsa",
    "credentials",
    ".env",
    "secrets.json",
    "secret.yaml",
    "secret.yml",
    "kubeconfig",
    "service_account.json",
    "application_default_credentials",
)

# ---------------------------------------------------------------------------
# Notable external domains / host substrings
# ---------------------------------------------------------------------------

AI_CLOUD_DOMAIN_MARKERS: Final[tuple[str, ...]] = (
    "api.openai.com",
    "api.anthropic.com",
    "claude.ai",
    "cursor.sh",
    "cursor.com",
    "github.com",
    "githubusercontent.com",
    "gitlab.com",
    "amazonaws.com",
    "azure.com",
    "googleapis.com",
    "docker.io",
    "ghcr.io",
    "npmjs.org",
    "pypi.org",
    "files.pythonhosted.org",
)

# ---------------------------------------------------------------------------
# Correlation finding types
# ---------------------------------------------------------------------------

ENGINE_AI_ACTIVITY: Final = "ai_activity"

FINDING_TERMINAL_TOOL_CHAIN: Final = "ai_terminal_tool_chain"
FINDING_SHELL_NETWORK_EXFIL: Final = "ai_shell_network_exfil"
FINDING_SECRETS_ACCESS: Final = "ai_secrets_access"
FINDING_SECRETS_GIT_PUSH: Final = "ai_secrets_git_push"
FINDING_CLOUD_CLI: Final = "ai_cloud_cli_from_agent"
FINDING_CONTAINER_DEPLOY: Final = "ai_container_build_deploy"
FINDING_MULTI_TOOL_BURST: Final = "ai_multi_tool_burst"
FINDING_SENSITIVE_MCP_UNGOVERNED_EGRESS: Final = "ai_sensitive_mcp_ungoverned_egress"

# Session bookkeeping
DEFAULT_MAX_TIMELINE_EVENTS: Final = 500
DEFAULT_MAX_CLOSED_SESSIONS_PER_DEVICE: Final = 50
DEFAULT_MAX_GRAPH_NODES: Final = 200
MULTI_TOOL_BURST_THRESHOLD: Final = 4
MULTI_TOOL_BURST_WINDOW_SECONDS: Final = 300
