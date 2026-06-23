"""remove_legacy_dns_tables

Revision ID: q2r3s4t5u6v7
Revises: p1q2r3s4t5u6
Create Date: 2026-06-09 00:00:00.000000

Drop NetGarde-era tables superseded by the policy pack system:
- blocked_sites (+ NOTIFY trigger/function)
- categories
- rules (pre-blocked_sites legacy table, may still exist on old DBs)
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "q2r3s4t5u6v7"
down_revision: Union[str, Sequence[str], None] = "p1q2r3s4t5u6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = op.get_bind()

    connection.execute(
        text("DROP TRIGGER IF EXISTS tr_blocked_sites_changed_notify ON blocked_sites")
    )
    connection.execute(text("DROP FUNCTION IF EXISTS notify_blocked_sites_changed()"))

    connection.execute(text("DROP TABLE IF EXISTS blocked_sites CASCADE"))
    connection.execute(text("DROP TABLE IF EXISTS categories CASCADE"))
    connection.execute(text("DROP TABLE IF EXISTS rules CASCADE"))


def downgrade() -> None:
    raise NotImplementedError("Downgrade is intentionally unsupported for this cleanup migration.")
