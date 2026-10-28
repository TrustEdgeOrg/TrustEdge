from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

from app.shared.config import settings
from app.shared.database import Base

# Import all models so Alembic can detect them
from app.features.agents.models.agent import Agent  # noqa: F401
from app.features.twin.models.security_alert import SecurityAlert  # noqa: F401
from app.features.behaviors.models.device_behavior import DeviceBehavior  # noqa: F401
from app.features.agent_actions.models.ai_agent_action import AiAgentAction  # noqa: F401


config = context.config

# Escape % characters for ConfigParser (used by Alembic)
# ConfigParser interprets % as interpolation syntax, so we need %%
db_url_escaped = settings.DB_URL.replace('%', '%%')
config.set_main_option("sqlalchemy.url", db_url_escaped)


if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
