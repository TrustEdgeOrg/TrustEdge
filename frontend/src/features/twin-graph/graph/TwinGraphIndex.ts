import {
  TraverseDirection,
  TraverseRequest,
  TraverseResponse,
  TwinEdge,
  TwinEntityType,
  TwinGraphSnapshot,
  TwinLayer,
  TwinNode,
  TwinRelation,
} from '../types/twinGraph';

export class TwinGraphIndex {
  readonly nodes: Map<string, TwinNode>;
  readonly edges: Map<string, TwinEdge>;
  private readonly outEdges: Map<string, string[]>;
  private readonly inEdges: Map<string, string[]>;

  constructor(snapshot: TwinGraphSnapshot) {
    this.nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
    this.edges = new Map();
    this.outEdges = new Map();
    this.inEdges = new Map();

    for (const edge of snapshot.edges) {
      this.edges.set(edge.id, edge);
      this.appendEdge(this.outEdges, edge.source_id, edge.id);
      this.appendEdge(this.inEdges, edge.target_id, edge.id);
      if (edge.bidirectional) {
        this.appendEdge(this.outEdges, edge.target_id, edge.id);
        this.appendEdge(this.inEdges, edge.source_id, edge.id);
      }
    }
  }

  neighbors(
    nodeId: string,
    options: {
      direction?: TraverseDirection;
      relations?: Set<TwinRelation>;
      layers?: Set<TwinLayer>;
    } = {},
  ): TwinEdge[] {
    const direction = options.direction ?? 'both';
    const edgeIds = new Set<string>();
    if (direction === 'out' || direction === 'both') {
      for (const id of this.outEdges.get(nodeId) ?? []) {
        edgeIds.add(id);
      }
    }
    if (direction === 'in' || direction === 'both') {
      for (const id of this.inEdges.get(nodeId) ?? []) {
        edgeIds.add(id);
      }
    }

    const result: TwinEdge[] = [];
    for (const edgeId of edgeIds) {
      const edge = this.edges.get(edgeId);
      if (!edge) {
        continue;
      }
      if (options.relations && !options.relations.has(edge.relation)) {
        continue;
      }
      if (options.layers && !options.layers.has(edge.layer)) {
        continue;
      }
      if (direction === 'out' && edge.source_id !== nodeId && !edge.bidirectional) {
        continue;
      }
      if (direction === 'in' && edge.target_id !== nodeId && !edge.bidirectional) {
        continue;
      }
      result.push(edge);
    }
    return result;
  }

  traverse(request: TraverseRequest): TraverseResponse {
    const layers = new Set(request.layers ?? ['observed', 'desired']);
    const relations = request.relations ? new Set(request.relations) : null;
    const entityTypes = request.entity_types ? new Set(request.entity_types) : null;
    const stopTypes = request.stop_at_entity_types
      ? new Set(request.stop_at_entity_types)
      : null;
    const direction = request.direction ?? 'out';
    const maxDepth = request.max_depth ?? 5;

    const visitedNodes = new Set<string>();
    const visitedEdges = new Set<string>();
    const paths: TraverseResponse['paths'] = [];

    for (const seedId of request.seed_node_ids) {
      if (!this.nodes.has(seedId)) {
        continue;
      }
      const queue: Array<{ id: string; hops: string[]; depth: number }> = [
        { id: seedId, hops: [seedId], depth: 0 },
      ];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.depth > maxDepth) {
          continue;
        }
        visitedNodes.add(current.id);
        if (current.depth === 0) {
          paths.push({ seed_id: seedId, hops: [...current.hops] });
        }

        const node = this.nodes.get(current.id)!;
        if (stopTypes && current.depth > 0 && stopTypes.has(node.entity_type)) {
          continue;
        }

        for (const edge of this.neighbors(current.id, {
          direction,
          relations: relations ?? undefined,
          layers,
        })) {
          visitedEdges.add(edge.id);
          const nextIds = this.nextNodeIds(current.id, edge, direction);
          for (const nextId of nextIds) {
            const nextNode = this.nodes.get(nextId);
            if (!nextNode) {
              continue;
            }
            if (entityTypes && !entityTypes.has(nextNode.entity_type)) {
              continue;
            }
            if (current.hops.includes(nextId)) {
              continue;
            }
            const hops = [...current.hops, nextId];
            paths.push({ seed_id: seedId, hops });
            if (current.depth < maxDepth) {
              queue.push({ id: nextId, hops, depth: current.depth + 1 });
            }
          }
        }
      }
    }

    return {
      nodes: [...visitedNodes]
        .sort()
        .map((id) => this.nodes.get(id)!)
        .filter(Boolean),
      edges: [...visitedEdges]
        .sort()
        .map((id) => this.edges.get(id)!)
        .filter(Boolean),
      paths,
    };
  }

  filter(
    entityTypes?: TwinEntityType[],
    relations?: TwinRelation[],
    layers?: TwinLayer[],
  ): TwinGraphSnapshot {
    const typeSet = entityTypes ? new Set(entityTypes) : null;
    const relationSet = relations ? new Set(relations) : null;
    const layerSet = layers ? new Set(layers) : null;

    const nodes = [...this.nodes.values()].filter((node) => {
      if (typeSet && !typeSet.has(node.entity_type)) {
        return false;
      }
      if (layerSet && !layerSet.has(node.layer)) {
        return false;
      }
      return true;
    });
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = [...this.edges.values()].filter((edge) => {
      if (!nodeIds.has(edge.source_id) || !nodeIds.has(edge.target_id)) {
        return false;
      }
      if (relationSet && !relationSet.has(edge.relation)) {
        return false;
      }
      if (layerSet && !layerSet.has(edge.layer)) {
        return false;
      }
      return true;
    });

    return {
      generated_at: new Date().toISOString(),
      window_minutes: 0,
      nodes,
      edges,
    };
  }

  private nextNodeIds(currentId: string, edge: TwinEdge, direction: TraverseDirection): string[] {
    if (edge.bidirectional) {
      return [edge.source_id, edge.target_id].filter((id) => id !== currentId);
    }
    if (direction === 'in') {
      return edge.target_id === currentId ? [edge.source_id] : [];
    }
    if (direction === 'out') {
      return edge.source_id === currentId ? [edge.target_id] : [];
    }
    if (currentId === edge.source_id) {
      return [edge.target_id];
    }
    if (currentId === edge.target_id) {
      return [edge.source_id];
    }
    return [];
  }

  private appendEdge(index: Map<string, string[]>, nodeId: string, edgeId: string): void {
    const list = index.get(nodeId);
    if (list) {
      list.push(edgeId);
      return;
    }
    index.set(nodeId, [edgeId]);
  }
}
