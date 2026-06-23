"""add network attribution tables

Revision ID: r3s4t5u6v7w8
Revises: q2r3s4t5u6v7
Create Date: 2026-06-22 12:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "r3s4t5u6v7w8"
down_revision: Union[str, Sequence[str], None] = "q2r3s4t5u6v7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "device_app_usage_rollups",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("app_slug", sa.String(length=64), nullable=False),
        sa.Column("app_display_name", sa.String(length=128), nullable=False),
        sa.Column("active_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sample_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("hour_utc", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "device_id",
            "window_start",
            "app_slug",
            name="uq_app_usage_rollup_device_window_app",
        ),
    )
    op.create_index(
        "ix_device_app_usage_rollups_device_id",
        "device_app_usage_rollups",
        ["device_id"],
    )
    op.create_index(
        "ix_device_app_usage_rollups_window_start",
        "device_app_usage_rollups",
        ["window_start"],
    )
    op.create_index(
        "ix_device_app_usage_rollups_app_slug",
        "device_app_usage_rollups",
        ["app_slug"],
    )

    op.create_table(
        "device_network_context",
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("app_slug", sa.String(length=64), nullable=False),
        sa.Column("app_display_name", sa.String(length=128), nullable=False),
        sa.Column("bundle_id", sa.String(length=255), nullable=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("device_id"),
    )

    op.add_column("dns_queries", sa.Column("attributed_app_slug", sa.String(length=64), nullable=True))
    op.add_column(
        "dns_queries",
        sa.Column("attributed_app_display_name", sa.String(length=128), nullable=True),
    )
    op.create_index("ix_dns_queries_attributed_app_slug", "dns_queries", ["attributed_app_slug"])


def downgrade() -> None:
    op.drop_index("ix_dns_queries_attributed_app_slug", table_name="dns_queries")
    op.drop_column("dns_queries", "attributed_app_display_name")
    op.drop_column("dns_queries", "attributed_app_slug")
    op.drop_table("device_network_context")
    op.drop_index("ix_device_app_usage_rollups_app_slug", table_name="device_app_usage_rollups")
    op.drop_index("ix_device_app_usage_rollups_window_start", table_name="device_app_usage_rollups")
    op.drop_index("ix_device_app_usage_rollups_device_id", table_name="device_app_usage_rollups")
    op.drop_table("device_app_usage_rollups")
