from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Set

from app.features.twin.graph.schemas import (
    TraverseDirection,
    TraversePath,
    TraverseRequest,
    TraverseResponse,
    TwinEdge,
    TwinEntityType,
    TwinGraphSnapshot,
    TwinLayer,
    TwinNode,
    TwinRelation,
)


@dataclass
class TwinGraph:
    nodes: Dict[str, TwinNode] = field(default_factory=dict)
    edges: Dict[str, TwinEdge] = field(default_factory=dict)
    out_edges: Dict[str, List[str]] = field(default_factory=dict)
    in_edges: Dict[str, List[str]] = field(default_factory=dict)

    @classmethod
    def from_snapshot(cls, snapshot: TwinGraphSnapshot) -> TwinGraph:
        graph = cls()
        for node in snapshot.nodes:
            graph.add_node(node)
        for edge in snapshot.edges:
            graph.add_edge(edge)
        return graph

    def add_node(self, node: TwinNode) -> None:
        self.nodes[node.id] = node
        self.out_edges.setdefault(node.id, [])
        self.in_edges.setdefault(node.id, [])

    def add_edge(self, edge: TwinEdge) -> None:
        if edge.source_id not in self.nodes or edge.target_id not in self.nodes:
            raise ValueError(
                f"edge {edge.id} references missing nodes "
                f"({edge.source_id}, {edge.target_id})"
            )
        self.edges[edge.id] = edge
        self.out_edges.setdefault(edge.source_id, []).append(edge.id)
        self.in_edges.setdefault(edge.target_id, []).append(edge.id)
        if edge.bidirectional:
            self.out_edges.setdefault(edge.target_id, []).append(edge.id)
            self.in_edges.setdefault(edge.source_id, []).append(edge.id)

    def to_snapshot(
        self,
        *,
        generated_at,
        window_minutes: int,
        meta: Optional[dict] = None,
    ) -> TwinGraphSnapshot:
        return TwinGraphSnapshot(
            generated_at=generated_at,
            window_minutes=window_minutes,
            nodes=list(self.nodes.values()),
            edges=list(self.edges.values()),
            meta=meta or {},
        )

    def neighbors(
        self,
        node_id: str,
        *,
        direction: TraverseDirection = "both",
        relations: Optional[Iterable[TwinRelation]] = None,
        layers: Optional[Iterable[TwinLayer]] = None,
    ) -> List[TwinEdge]:
        if node_id not in self.nodes:
            return []
        relation_set = set(relations) if relations is not None else None
        layer_set = set(layers) if layers is not None else None
        edge_ids: Set[str] = set()
        if direction in ("out", "both"):
            edge_ids.update(self.out_edges.get(node_id, []))
        if direction in ("in", "both"):
            edge_ids.update(self.in_edges.get(node_id, []))
        result: List[TwinEdge] = []
        for edge_id in edge_ids:
            edge = self.edges[edge_id]
            if relation_set is not None and edge.relation not in relation_set:
                continue
            if layer_set is not None and edge.layer not in layer_set:
                continue
            if direction == "out" and edge.source_id != node_id and not edge.bidirectional:
                continue
            if direction == "in" and edge.target_id != node_id and not edge.bidirectional:
                continue
            result.append(edge)
        return result

    def traverse(self, request: TraverseRequest) -> TraverseResponse:
        relation_set = set(request.relations) if request.relations is not None else None
        entity_type_set = (
            set(request.entity_types) if request.entity_types is not None else None
        )
        layer_set = set(request.layers)
        stop_types = (
            set(request.stop_at_entity_types)
            if request.stop_at_entity_types is not None
            else None
        )

        visited_nodes: Set[str] = set()
        visited_edges: Set[str] = set()
        paths: List[TraversePath] = []

        for seed_id in request.seed_node_ids:
            if seed_id not in self.nodes:
                continue
            queue: deque[tuple[str, List[str], int]] = deque([(seed_id, [seed_id], 0)])
            while queue:
                current_id, hop_path, depth = queue.popleft()
                if depth > request.max_depth:
                    continue
                visited_nodes.add(current_id)
                if depth == 0:
                    paths.append(TraversePath(seed_id=seed_id, hops=list(hop_path)))

                node = self.nodes[current_id]
                if stop_types is not None and depth > 0 and node.entity_type in stop_types:
                    continue

                for edge in self.neighbors(
                    current_id,
                    direction=request.direction,
                    relations=relation_set,
                    layers=layer_set,
                ):
                    visited_edges.add(edge.id)
                    next_ids = self._edge_neighbor_ids(current_id, edge, request.direction)
                    for next_id in next_ids:
                        if next_id not in self.nodes:
                            continue
                        next_node = self.nodes[next_id]
                        if entity_type_set is not None and next_node.entity_type not in entity_type_set:
                            continue
                        if next_id in hop_path:
                            continue
                        new_path = hop_path + [next_id]
                        paths.append(TraversePath(seed_id=seed_id, hops=new_path))
                        if depth < request.max_depth:
                            queue.append((next_id, new_path, depth + 1))

        return TraverseResponse(
            nodes=[self.nodes[nid] for nid in sorted(visited_nodes) if nid in self.nodes],
            edges=[self.edges[eid] for eid in sorted(visited_edges) if eid in self.edges],
            paths=paths,
        )

    def subgraph(
        self,
        node_ids: Iterable[str],
        *,
        depth: int = 1,
        direction: TraverseDirection = "both",
        layers: Optional[List[TwinLayer]] = None,
    ) -> TraverseResponse:
        seeds = [node_id for node_id in node_ids if node_id in self.nodes]
        return self.traverse(
            TraverseRequest(
                seed_node_ids=seeds,
                direction=direction,
                max_depth=depth,
                layers=layers or ["observed", "desired"],
            )
        )

    @staticmethod
    def _edge_neighbor_ids(
        current_id: str,
        edge: TwinEdge,
        direction: TraverseDirection,
    ) -> List[str]:
        if edge.bidirectional:
            return [nid for nid in (edge.source_id, edge.target_id) if nid != current_id]
        if direction == "in":
            return [edge.source_id] if edge.target_id == current_id else []
        if direction == "out":
            return [edge.target_id] if edge.source_id == current_id else []
        if current_id == edge.source_id:
            return [edge.target_id]
        if current_id == edge.target_id:
            return [edge.source_id]
        return []
