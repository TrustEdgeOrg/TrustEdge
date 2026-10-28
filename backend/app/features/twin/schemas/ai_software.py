"""Schemas for known AI tools inventory from Redis twin."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class AiSoftwareItem(BaseModel):
    model_config = {"protected_namespaces": ()}

    id: str
    product_id: str = ""
    product_name: str = ""
    vendor: str = ""
    category: str = ""
    confidence: str = ""
    confidence_reason: str = ""
    installed: bool = False
    running: bool = False
    path: str = ""
    version: str = ""
    bundle_id: str = ""
    executable: str = ""
    signing_id: str = ""
    team_id: str = ""
    signature_valid: Optional[bool] = None
    matched_evidence: List[str] = Field(default_factory=list)
    failed_evidence: List[str] = Field(default_factory=list)
    # CLI agent fields (empty for GUI .app inventory).
    invocation_path: str = ""
    resolved_path: str = ""
    package_manager: str = ""
    package_identifier: str = ""
    entry_point: str = ""
    interpreter: str = ""
    # Local model runtime fields (empty/false for apps and CLI agents).
    serving: bool = False
    exposure: str = ""
    listeners: List[dict] = Field(default_factory=list)
    models_available: int = 0
    model_format: str = ""
    runtime_version: str = ""
    local_clients: List[dict] = Field(default_factory=list)
    # IDE extension fields (empty for apps / CLI / runtimes).
    extension_id: str = ""
    host_ide_product_id: str = ""
    host_ide_path: str = ""
    profile: str = ""
    enabled: Optional[bool] = None
    active: Optional[bool] = None
    mcp_configured: bool = False
    mcp_servers: List[str] = Field(default_factory=list)
    mcp_server_tools: dict[str, List[str]] = Field(default_factory=dict)
    local_model_product_id: str = ""
    skills: List[dict] = Field(default_factory=list)


class AiSoftwareListResponse(BaseModel):
    device_id: str
    total: int = 0
    items: List[AiSoftwareItem] = Field(default_factory=list)
