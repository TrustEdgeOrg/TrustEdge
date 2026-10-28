import json
from unittest.mock import patch

import fakeredis
import pytest

from app.features.twin.services import trusttwin_store
from app.features.twin.services.connected_agent_service import ConnectedAgentService


@pytest.fixture
def fake_redis():
    client = fakeredis.FakeRedis(decode_responses=True)
    with patch("app.features.twin.services.trusttwin_store.get_redis", return_value=client):
        with patch("app.features.twin.services.trusttwin_store.redis_available", return_value=True):
            yield client


def test_list_ai_software_sorted_from_twin(fake_redis):
    doc = {
        "device_id": "dev_ai",
        "known_ai_apps": {
            "cursor:/applications/cursor.app": {
                "id": "cursor:/applications/cursor.app",
                "product_id": "cursor",
                "product_name": "Cursor",
                "vendor": "Cursor",
                "category": "code_editor",
                "confidence": "VERIFIED",
                "installed": True,
                "running": True,
                "path": "/Applications/Cursor.app",
                "version": "1.2.3",
                "bundle_id": "com.todesktop.230313mzl4w4u92",
                "signature_valid": True,
                            "skills": [
                                {"id": "agents:review", "name": "Review", "source": "agents", "scope": "user"}
                            ],
            },
            "claude:/applications/claude.app": {
                "id": "claude:/applications/claude.app",
                "product_id": "claude",
                "product_name": "Claude",
                "vendor": "Anthropic",
                "category": "chat_client",
                "confidence": "VERIFIED",
                "installed": True,
                "running": False,
                "path": "/Applications/Claude.app",
                "version": "0.9.0",
            },
            "cursor:cursor": {
                "id": "cursor:cursor",
                "product_id": "cursor",
                "product_name": "Cursor",
                "vendor": "Cursor",
                "category": "code_editor",
                "confidence": "LOW",
                "installed": False,
                "running": True,
                "path": "Cursor",
            },
        },
    }
    fake_redis.set(
        trusttwin_store.LATEST_KEY_FMT.format(device_id="dev_ai"),
        json.dumps(doc),
    )

    result = ConnectedAgentService().list_ai_software("dev_ai")
    assert result.device_id == "dev_ai"
    assert result.total == 2
    assert [item.product_name for item in result.items] == ["Claude", "Cursor"]
    assert result.items[1].running is True
    assert result.items[1].version == "1.2.3"
    assert result.items[1].skills == [
        {"id": "agents:review", "name": "Review", "source": "agents", "scope": "user"}
    ]
    assert all(item.installed for item in result.items)


def test_list_ai_software_includes_evidence(fake_redis):
    doc = {
        "device_id": "dev_ai",
        "known_ai_apps": {
            "cursor:/applications/cursor.app": {
                "id": "cursor:/applications/cursor.app",
                "product_id": "cursor",
                "product_name": "Cursor",
                "installed": True,
                "running": True,
                "confidence": "LOW",
                "confidence_reason": "LOW. Recognized mainly by name/path or bundle ID; code-signing evidence is missing; matched: app name; missing: code signing ID.",
                "matched_evidence": ["candidate_name", "bundle_id"],
                "failed_evidence": ["signing_identifier", "signature_valid"],
            },
        },
    }
    fake_redis.set(
        trusttwin_store.LATEST_KEY_FMT.format(device_id="dev_ai"),
        json.dumps(doc),
    )
    result = ConnectedAgentService().list_ai_software("dev_ai")
    assert result.items[0].matched_evidence == ["candidate_name", "bundle_id"]
    assert result.items[0].failed_evidence == ["signing_identifier", "signature_valid"]
    assert "code-signing" in result.items[0].confidence_reason


def test_list_ai_software_includes_cli_agent_fields(fake_redis):
    doc = {
        "device_id": "dev_cli",
        "known_ai_apps": {
            "claude_code:/opt/homebrew/bin/claude": {
                "id": "claude_code:/opt/homebrew/bin/claude",
                "product_id": "claude_code",
                "product_name": "Claude Code",
                "vendor": "Anthropic",
                "category": "cli_agent",
                "confidence": "LOW",
                "confidence_reason": "LOW. Recognized mainly by command name.",
                "installed": True,
                "running": True,
                "path": "/opt/homebrew/Cellar/claude-code/1.0/bin/claude",
                "version": "1.0",
                "executable": "claude",
                "invocation_path": "/opt/homebrew/bin/claude",
                "resolved_path": "/opt/homebrew/Cellar/claude-code/1.0/bin/claude",
                "package_manager": "homebrew",
                "package_identifier": "claude-code",
                "entry_point": "claude",
            },
        },
    }
    fake_redis.set(
        trusttwin_store.LATEST_KEY_FMT.format(device_id="dev_cli"),
        json.dumps(doc),
    )
    result = ConnectedAgentService().list_ai_software("dev_cli")
    assert result.total == 1
    item = result.items[0]
    assert item.category == "cli_agent"
    assert item.product_name == "Claude Code"
    assert item.invocation_path == "/opt/homebrew/bin/claude"
    assert item.package_manager == "homebrew"
    assert item.package_identifier == "claude-code"
    assert item.executable == "claude"
    assert item.running is True


def test_list_ai_software_includes_local_model_runtime_fields(fake_redis):
    doc = {
        "device_id": "dev_runtime",
        "known_ai_apps": {
            "ollama:/opt/homebrew/bin/ollama": {
                "id": "ollama:/opt/homebrew/bin/ollama",
                "product_id": "ollama",
                "product_name": "Ollama",
                "vendor": "Ollama",
                "category": "local_model_runtime",
                "confidence": "LOW",
                "confidence_reason": "LOW. Recognized mainly by runtime command name.",
                "installed": True,
                "running": True,
                "serving": True,
                "exposure": "LOOPBACK_ONLY",
                "path": "/opt/homebrew/bin/ollama",
                "executable": "ollama",
                "listeners": [{"addr": "127.0.0.1", "port": 11434, "protocol": "tcp"}],
                "models_available": 3,
                "model_format": "GGUF",
                "runtime_version": "0.5.0",
                "local_clients": [{"pid": 10, "executable": "Cursor", "product_id": "cursor"}],
            },
        },
    }
    fake_redis.set(
        trusttwin_store.LATEST_KEY_FMT.format(device_id="dev_runtime"),
        json.dumps(doc),
    )
    result = ConnectedAgentService().list_ai_software("dev_runtime")
    assert result.total == 1
    item = result.items[0]
    assert item.category == "local_model_runtime"
    assert item.serving is True
    assert item.exposure == "LOOPBACK_ONLY"
    assert item.listeners == [{"addr": "127.0.0.1", "port": 11434, "protocol": "tcp"}]
    assert item.models_available == 3
    assert item.model_format == "GGUF"
    assert item.runtime_version == "0.5.0"
    assert item.local_clients[0]["product_id"] == "cursor"


def test_list_ai_software_includes_ide_extension_fields(fake_redis):
    doc = {
        "device_id": "dev_ext",
        "known_ai_apps": {
            "cline:/users/x/.cursor/extensions/saoudrizwan.claude-dev-3.8.0": {
                "id": "cline:/users/x/.cursor/extensions/saoudrizwan.claude-dev-3.8.0",
                "product_id": "cline",
                "product_name": "Cline",
                "vendor": "Cline",
                "category": "agentic_ide_extension",
                "confidence": "VERIFIED",
                "installed": True,
                "running": False,
                "path": "/Users/x/.cursor/extensions/saoudrizwan.claude-dev-3.8.0",
                "version": "3.8.0",
                "extension_id": "saoudrizwan.claude-dev",
                "host_ide_product_id": "cursor",
                "host_ide_path": "/Applications/Cursor.app",
                "package_manager": "cursor_extension",
                "package_identifier": "saoudrizwan.claude-dev",
                "enabled": True,
                "mcp_configured": True,
                "mcp_servers": ["github", "customer-db"],
                "local_model_product_id": "ollama",
                "matched_evidence": ["extension_id", "host_ide"],
            },
        },
    }
    fake_redis.set(
        trusttwin_store.LATEST_KEY_FMT.format(device_id="dev_ext"),
        json.dumps(doc),
    )
    result = ConnectedAgentService().list_ai_software("dev_ext")
    assert result.total == 1
    item = result.items[0]
    assert item.category == "agentic_ide_extension"
    assert item.extension_id == "saoudrizwan.claude-dev"
    assert item.host_ide_product_id == "cursor"
    assert item.enabled is True
    assert item.active is None
    assert item.mcp_configured is True
    assert item.mcp_servers == ["github", "customer-db"]
    assert item.local_model_product_id == "ollama"


def test_list_ai_software_empty_when_missing(fake_redis):
    result = ConnectedAgentService().list_ai_software("missing")
    assert result.device_id == "missing"
    assert result.total == 0
    assert result.items == []
