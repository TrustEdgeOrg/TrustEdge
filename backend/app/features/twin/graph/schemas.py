from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

TwinLayer = Literal["observed", "desired", "simulated"]

TwinEntityType = Literal[
    "device",
    "vpn_peer",
    "ip_lease",
    "app",
    "domain",
    "ip_address",
    "l4_service",
    "flow_session",
    "dns_query",
    "policy_profile",
    "policy_pack",
    "policy_rule",
    "infra_component",
    "geo_country",
    "behavior_signal",
    "quarantine",
]

TwinRelation = Literal[
    "enrolled_as",
    "leased_ip",
    "runs",
    "queries",
    "queries_direct",
    "resolves_to",
    "opens",
    "opens_direct",
    "uses_service",
    "destinates",
    "correlates",
    "routed_via",
    "terminates_at",
    "assigned",
    "includes",
    "defines",
    "blocks",
    "allows",
    "enforces",
    "quarantined",
    "observed_in",
    "scored_by",
    "simulated_block",
]

TraverseDirection = Literal["out", "in", "both"]


class TwinNode(BaseModel):
    id: str = Field(min_length=1)
    entity_type: TwinEntityType
    layer: TwinLayer
    label: str
    properties: Dict[str, Any] = Field(default_factory=dict)
    first_seen_at: Optional[datetime] = None
    last_seen_at: Optional[datetime] = None
    stale: bool = False


class TwinEdge(BaseModel):
    id: str = Field(min_length=1)
    source_id: str = Field(min_length=1)
    target_id: str = Field(min_length=1)
    relation: TwinRelation
    layer: TwinLayer
    weight: float = Field(default=1.0, ge=0)
    properties: Dict[str, Any] = Field(default_factory=dict)
    bidirectional: bool = False


class TwinGraphSnapshot(BaseModel):
    generated_at: datetime
    window_minutes: int = Field(ge=0)
    nodes: List[TwinNode]
    edges: List[TwinEdge]
    meta: Dict[str, Any] = Field(default_factory=dict)


class TraverseRequest(BaseModel):
    seed_node_ids: List[str] = Field(min_length=1)
    direction: TraverseDirection = "out"
    relations: Optional[List[TwinRelation]] = None
    entity_types: Optional[List[TwinEntityType]] = None
    max_depth: int = Field(default=5, ge=0, le=32)
    layers: List[TwinLayer] = Field(default_factory=lambda: ["observed", "desired"])
    stop_at_entity_types: Optional[List[TwinEntityType]] = None


class TraversePath(BaseModel):
    seed_id: str
    hops: List[str]


class TraverseResponse(BaseModel):
    nodes: List[TwinNode]
    edges: List[TwinEdge]
    paths: List[TraversePath]
