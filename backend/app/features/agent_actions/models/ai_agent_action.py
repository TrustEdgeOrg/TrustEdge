from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Index, Integer, JSON, String, Text, UniqueConstraint

from app.shared.database import Base


class AiAgentAction(Base):
    """Durable AI agent action (prompt + tool) for Asked / Happened UI."""

    __tablename__ = "ai_agent_actions"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(String(128), nullable=False)
    device_id = Column(String(128), nullable=False, index=True)
    ts = Column(DateTime(timezone=True), nullable=False)
    agent_type = Column(String(64), nullable=True)
    session_id = Column(String(128), nullable=True)
    turn_id = Column(String(128), nullable=True)
    channel = Column(String(32), nullable=True)
    tool = Column(String(128), nullable=True)
    server = Column(String(128), nullable=True)
    operation = Column(String(64), nullable=True)
    destination = Column(Text, nullable=True)
    decision = Column(String(32), nullable=True)
    sensitivity = Column(String(32), nullable=True)
    classification = Column(String(64), nullable=True)
    governed = Column(Boolean, nullable=True)
    correlation_id = Column(String(128), nullable=True)
    payload = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        UniqueConstraint("event_id", name="uq_ai_agent_actions_event_id"),
        Index("ix_ai_agent_actions_device_ts", "device_id", "ts"),
        Index("ix_ai_agent_actions_device_session_ts", "device_id", "session_id", "ts"),
    )
