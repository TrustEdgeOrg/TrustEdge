"""add_ai_agent_actions

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-08-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e6f7a8b9c0d1"
down_revision: Union[str, Sequence[str], None] = "d5e6f7a8b9c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ai_agent_actions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("event_id", sa.String(length=128), nullable=False),
        sa.Column("device_id", sa.String(length=128), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("agent_type", sa.String(length=64), nullable=True),
        sa.Column("session_id", sa.String(length=128), nullable=True),
        sa.Column("turn_id", sa.String(length=128), nullable=True),
        sa.Column("channel", sa.String(length=32), nullable=True),
        sa.Column("tool", sa.String(length=128), nullable=True),
        sa.Column("server", sa.String(length=128), nullable=True),
        sa.Column("operation", sa.String(length=64), nullable=True),
        sa.Column("destination", sa.Text(), nullable=True),
        sa.Column("decision", sa.String(length=32), nullable=True),
        sa.Column("sensitivity", sa.String(length=32), nullable=True),
        sa.Column("classification", sa.String(length=64), nullable=True),
        sa.Column("governed", sa.Boolean(), nullable=True),
        sa.Column("correlation_id", sa.String(length=128), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", name="uq_ai_agent_actions_event_id"),
    )
    op.create_index("ix_ai_agent_actions_id", "ai_agent_actions", ["id"], unique=False)
    op.create_index("ix_ai_agent_actions_device_id", "ai_agent_actions", ["device_id"], unique=False)
    op.create_index(
        "ix_ai_agent_actions_device_ts",
        "ai_agent_actions",
        ["device_id", "ts"],
        unique=False,
    )
    op.create_index(
        "ix_ai_agent_actions_device_session_ts",
        "ai_agent_actions",
        ["device_id", "session_id", "ts"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_ai_agent_actions_device_session_ts", table_name="ai_agent_actions")
    op.drop_index("ix_ai_agent_actions_device_ts", table_name="ai_agent_actions")
    op.drop_index("ix_ai_agent_actions_device_id", table_name="ai_agent_actions")
    op.drop_index("ix_ai_agent_actions_id", table_name="ai_agent_actions")
    op.drop_table("ai_agent_actions")
