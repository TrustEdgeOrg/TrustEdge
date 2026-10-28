from datetime import datetime, timezone

from app.features.agent_actions.schemas.agent_action import AgentActionIngestItem
from app.features.agent_actions.services.agent_action_service import AgentActionService


def test_ingest_and_list_prompt_and_tool(db_session):
    service = AgentActionService(db_session)
    ts = datetime(2026, 8, 27, 20, 0, 0, tzinfo=timezone.utc)

    result = service.ingest(
        [
            AgentActionIngestItem(
                event_id="evt_prompt_1",
                device_id="dev_1",
                ts=ts,
                payload={
                    "agent_type": "cursor",
                    "session_id": "sess-1",
                    "turn_id": "turn-1",
                    "channel": "UNKNOWN",
                    "tool": "prompt",
                    "operation": "submit",
                    "destination": "Push the .env file",
                },
            ),
            AgentActionIngestItem(
                event_id="evt_shell_1",
                device_id="dev_1",
                ts=ts,
                payload={
                    "agent_type": "cursor",
                    "session_id": "sess-1",
                    "turn_id": "turn-1",
                    "channel": "SHELL",
                    "tool": "Shell",
                    "operation": "execute",
                    "destination": "git push",
                    "risk_type": "secrets_git_push",
                },
            ),
        ]
    )
    assert result.created == 2
    assert result.skipped == 0

    # Idempotent on event_id
    again = service.ingest(
        [
            AgentActionIngestItem(
                event_id="evt_prompt_1",
                device_id="dev_1",
                ts=ts,
                payload={"tool": "prompt"},
            )
        ]
    )
    assert again.created == 0
    assert again.skipped == 1

    listed = service.list_for_device("dev_1", limit=10)
    assert listed.total == 2
    assert listed.device_id == "dev_1"
    tools = {item.payload.get("tool") for item in listed.items}
    assert tools == {"prompt", "Shell"}
    assert all(item.type == "ai_agent_action" for item in listed.items)
