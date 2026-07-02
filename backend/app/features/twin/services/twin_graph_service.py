from __future__ import annotations

from typing import List, Optional

from sqlalchemy.orm import Session

from app.features.twin.graph.builder import TwinGraphBuilder
from app.features.twin.graph.model import TwinGraph
from app.features.twin.graph.schemas import (
    TraverseDirection,
    TraverseRequest,
    TraverseResponse,
    TwinGraphSnapshot,
    TwinLayer,
    TwinRelation,
)


class TwinGraphService:
    def __init__(self, db: Session):
        self.db = db

    def build_snapshot(
        self,
        *,
        minutes: int = 1,
        include_flows: bool = True,
        include_policy: bool = True,
    ) -> TwinGraphSnapshot:
        return TwinGraphBuilder(self.db).build(
            minutes=minutes,
            include_flows=include_flows,
            include_policy=include_policy,
        )

    def traverse(
        self,
        request: TraverseRequest,
        *,
        minutes: int = 1,
        include_flows: bool = True,
        include_policy: bool = True,
    ) -> TraverseResponse:
        snapshot = self.build_snapshot(
            minutes=minutes,
            include_flows=include_flows,
            include_policy=include_policy,
        )
        graph = TwinGraph.from_snapshot(snapshot)
        return graph.traverse(request)

    def neighbors(
        self,
        node_id: str,
        *,
        direction: TraverseDirection = "both",
        relations: Optional[List[TwinRelation]] = None,
        layers: Optional[List[TwinLayer]] = None,
        minutes: int = 1,
        include_flows: bool = True,
        include_policy: bool = True,
    ) -> TraverseResponse:
        snapshot = self.build_snapshot(
            minutes=minutes,
            include_flows=include_flows,
            include_policy=include_policy,
        )
        graph = TwinGraph.from_snapshot(snapshot)
        if node_id not in graph.nodes:
            return TraverseResponse(nodes=[], edges=[], paths=[])
        edge_list = graph.neighbors(
            node_id,
            direction=direction,
            relations=relations,
            layers=layers or ["observed", "desired"],
        )
        neighbor_ids = {node_id}
        for edge in edge_list:
            neighbor_ids.add(edge.source_id)
            neighbor_ids.add(edge.target_id)
        return TraverseResponse(
            nodes=[graph.nodes[nid] for nid in sorted(neighbor_ids) if nid in graph.nodes],
            edges=edge_list,
            paths=[],
        )
