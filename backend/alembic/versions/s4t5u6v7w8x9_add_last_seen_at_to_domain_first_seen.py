"""add last_seen_at to domain_first_seen

Revision ID: s4t5u6v7w8x9
Revises: r3s4t5u6v7w8
Create Date: 2026-06-28 12:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "s4t5u6v7w8x9"
down_revision: Union[str, Sequence[str], None] = "r3s4t5u6v7w8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "domain_first_seen",
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute("UPDATE domain_first_seen SET last_seen_at = first_seen_at WHERE last_seen_at IS NULL")
    op.alter_column("domain_first_seen", "last_seen_at", nullable=False)
    op.create_index(
        "ix_domain_first_seen_client_ip_last_seen_at",
        "domain_first_seen",
        ["client_ip", "last_seen_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_domain_first_seen_client_ip_last_seen_at", table_name="domain_first_seen")
    op.drop_column("domain_first_seen", "last_seen_at")
