# Network Security Digital Twin — Graph Engine

This document defines the **canonical graph data model** for TrustEdge’s digital twin. The graph is the source of truth for dependency reasoning. UI layout modes (attribution, path, flow) are **projections** of this graph, not its structure.

For product context see [DESIGN.md](DESIGN.md). For current map API see [API.md](API.md).

---

## Problem

Today the network map is built as a flat `nodes[]` + `edges[]` payload, then **rewritten in the frontend** for column layouts:

- `expandToPathView()` injects `tunnel`, `gateway`, `policy` nodes and rewrites DNS edges.
- `expandFlowToPortView()` collapses domains into a gateway and synthesizes `port` hubs.
- `layoutNetworkMap.ts` assigns fixed **X columns** per mode.

That works for visualization but **cannot support**:

| Future capability | Why columns fail |
|-------------------|------------------|
| Impact analysis | Need “what depends on policy pack X?” across all entity types |
| Blast radius | Need multi-hop reachability from any seed node |
| Dependency discovery | Need bidirectional walk without knowing column order |
| Root cause analysis | Need reverse traversal from symptom → enforcing rule |
| Policy simulation | Need overlay graph (desired/simulated layer) on observed graph |

The graph engine separates **topology** (entities + dependencies) from **presentation** (layout + filters).

---

## Design principles

1. **Every entity is a node** — devices, apps, domains, IPs, ports, flows, policy objects, infra components, geo, quarantine state.
2. **Every dependency is an edge** — with explicit relation type and direction; traversable forward and backward via indexes.
3. **Layers, not views** — `observed` (telemetry), `desired` (policy state), `simulated` (what-if overlay) coexist on the same ID space.
4. **Stable IDs** — node IDs are deterministic from entity identity, not layout position or UI mode.
5. **Projections are read-only** — path/flow/attribution views are filters + layout presets over the canonical graph.
6. **Time is first-class** — nodes and edges carry observation windows for recency, staleness, and RCA time bounds.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Graph builders (ingest)                      │
│  DNS ingest · Flow ingest · Policy sync · Device enroll · Geo   │
└────────────────────────────┬────────────────────────────────────┘
                             │ upsert nodes/edges
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              TwinGraph (canonical in-memory / Redis)             │
│  nodes[id] · edges[id] · out_index · in_index · layer_index      │
└────────────────────────────┬────────────────────────────────────┘
                             │ query API
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
  Impact analysis    Blast radius / RCA    Policy simulation
  (forward BFS)      (reverse BFS)           (simulated layer overlay)
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Projection + layout (frontend or API)               │
│  filter by entity/relation/layer → layout algorithm → render     │
└─────────────────────────────────────────────────────────────────┘
```

**Storage strategy (phased):**

| Phase | Store | Scope |
|-------|-------|-------|
| 1 (now) | In-memory snapshot per request | Built from RDS + Redis flows + policy tables |
| 2 | Redis graph snapshot with TTL | Shared across API + WebSocket incremental merge |
| 3 | Optional graph DB (Neo4j / PostgreSQL ltree) | If multi-tenant scale or persistent graph history required |

Phase 1 is sufficient for impact analysis and simulation on a single-tenant EC2 deployment.

---

## Data model

### TwinNode

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Stable global identifier (see ID scheme) |
| `entity_type` | `TwinEntityType` | Semantic type for filtering and icons |
| `layer` | `TwinLayer` | `observed` \| `desired` \| `simulated` |
| `label` | `string` | Human-readable display name |
| `properties` | `object` | Type-specific attributes (see entity catalog) |
| `first_seen_at` | `datetime?` | Earliest observation in window |
| `last_seen_at` | `datetime?` | Latest observation in window |
| `stale` | `bool` | No recent activity in configured window |

### TwinEdge

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Stable edge identifier |
| `source_id` | `string` | Tail of directed dependency |
| `target_id` | `string` | Head of directed dependency |
| `relation` | `TwinRelation` | Semantic dependency type |
| `layer` | `TwinLayer` | Same layer semantics as nodes |
| `weight` | `float` | Default 1.0; used for query counts, bytes, priority |
| `properties` | `object` | Relation-specific metadata |
| `bidirectional` | `bool` | If true, traversal treats edge as undirected for `both` direction |

**Dependency direction convention:** edge `A → B` means **A depends on B** or **A uses B** (traffic/policy flows from source toward target). Examples:

- `device → app` (`runs`): device runs foreground app
- `app → domain` (`queries`): app generated DNS query for domain
- `domain → ip` (`resolves_to`): DNS resolution result
- `flow → ip` (`destinates`): L4 session targets IP
- `policy_rule → domain` (`blocks`): rule blocks domain
- `device → policy_profile` (`assigned`): device receives policy

Reverse traversal answers “what depends on this domain?” or “what policy blocks this?”.

### TwinGraphSnapshot

| Field | Type | Description |
|-------|------|-------------|
| `generated_at` | `datetime` | Snapshot timestamp |
| `window_minutes` | `int` | Observation lookback |
| `nodes` | `TwinNode[]` | All nodes across included layers |
| `edges` | `TwinEdge[]` | All edges across included layers |
| `meta` | `object` | Builder version, layer counts, staleness policy |

### Indexes (required for traversal)

Built when the graph is loaded; not serialized on the wire unless debugging.

```text
out_edges:  node_id → edge_id[]
in_edges:   node_id → edge_id[]
edges:      edge_id → TwinEdge
nodes:      node_id → TwinNode
by_type:    entity_type → node_id[]
by_layer:   layer → node_id[]
```

---

## Entity catalog (node types)

| `entity_type` | ID pattern | Source | Key properties |
|---------------|------------|--------|----------------|
| `device` | `device:{id}` | `devices` | `client_ip`, `hostname`, `mac`, `quarantined` |
| `vpn_peer` | `vpn_peer:{pubkey_hash}` | WireGuard | `public_key`, `allowed_ips` |
| `ip_lease` | `lease:{ip}` | DHCP | `ip`, `mac`, `hostname` |
| `app` | `app:{slug}` | App catalog | `slug`, `display_name`, `bundle_id` |
| `domain` | `domain:{root}` | DNS ingest | `fqdn`, `root_domain`, `blocked` |
| `ip_address` | `ip:{addr}` | DNS resolution / flows | `addr`, `version` (4/6) |
| `l4_service` | `l4:{proto}:{port}` | Flow aggregation | `protocol`, `port` |
| `flow_session` | `flow:{proto}:{dest_ip}:{dest_port}:{client_ip}` | conntrack | `state`, `bytes_sent`, `bytes_recv` |
| `dns_query` | `dnsq:{uuid}` | Optional event node | `domain`, `blocked`, `query_type` |
| `policy_profile` | `policy_profile:{id}` | RDS | `name`, `enabled_pack_slugs` |
| `policy_pack` | `policy_pack:{slug}` | RDS | `slug`, `name`, `enabled_globally` |
| `policy_rule` | `policy_rule:{profile_id}:{domain}` | Derived at sync | `action` (`block`\|`allow`), `source` (`pack`\|`extra`\|`quarantine`) |
| `infra_component` | `infra:{kind}` | Static topology | `kind`: `wireguard`, `dns_resolver`, `firewall`, `nat`, `ec2_gateway` |
| `geo_country` | `geo:{iso_code}` | Geo ingest | `iso_code`, `name` |
| `behavior_signal` | `behavior:{device_id}` | Behavior service | `score`, `threshold`, `auto_block_enabled` |
| `quarantine` | `quarantine:{device_id}` | RDS | `active`, `started_at`, `expires_at` |

**Notes:**

- `dns_query` as a node is optional. Phase 1 can aggregate into edge weights on `queries` edges; promote to event nodes when RCA needs exact timestamps.
- `infra_component` nodes are **desired-layer topology** (always present), not inferred from telemetry.
- `policy_rule` nodes materialize effective block/allow decisions per device profile for simulation and RCA.

---

## Relation catalog (edge types)

| `relation` | Typical `source → target` | Layer | Bidirectional |
|------------|---------------------------|-------|---------------|
| `enrolled_as` | `device → vpn_peer` | desired | no |
| `leased_ip` | `device → ip_lease` | desired | no |
| `runs` | `device → app` | observed | no |
| `queries` | `app → domain` | observed | no |
| `queries_direct` | `device → domain` | observed | no |
| `resolves_to` | `domain → ip_address` | observed | no |
| `opens` | `app → flow_session` | observed | no |
| `opens_direct` | `device → flow_session` | observed | no |
| `uses_service` | `flow_session → l4_service` | observed | no |
| `destinates` | `flow_session → ip_address` | observed | no |
| `correlates` | `domain → flow_session` | observed | yes |
| `routed_via` | `device → infra_component` | desired | no |
| `terminates_at` | `infra_component → infra_component` | desired | no |
| `assigned` | `device → policy_profile` | desired | no |
| `includes` | `policy_profile → policy_pack` | desired | no |
| `defines` | `policy_pack → policy_rule` | desired | no |
| `blocks` | `policy_rule → domain` | desired | no |
| `allows` | `policy_rule → domain` | desired | no |
| `enforces` | `infra_component → policy_profile` | desired | no |
| `quarantined` | `device → quarantine` | desired | no |
| `observed_in` | `device → geo_country` | observed | no |
| `scored_by` | `device → behavior_signal` | observed | no |
| `simulated_block` | `policy_rule → domain` | simulated | no |

**Infra chain (desired layer):**

```text
device ─routed_via→ infra:wireguard ─terminates_at→ infra:ec2_gateway
       ─terminates_at→ infra:dns_resolver ─enforces→ policy_profile:{id}
domain ←path← (reverse of queries + resolves_to + policy evaluation)
```

Path view is a **projection** that selects this chain plus observed DNS/flow edges — not a separate graph.

---

## ID scheme

Rules:

1. Lowercase, colon-separated: `{type}:{key}`.
2. Keys are normalized: domains → punycode root; IPs → canonical form; slugs → lowercase.
3. Simulation overlay uses **same IDs** as desired/observed nodes; simulated edges use layer `simulated`.
4. Edge IDs: `{relation}:{source_id}→{target_id}` (URL-encode `:` in source/target if needed).

Examples:

```text
device:42
app:com.google.chrome
domain:example.com
ip:93.184.216.34
l4:tcp:443
flow:tcp:93.184.216.34:443:10.0.0.12
policy_profile:3
policy_pack:social-media
policy_rule:3:example.com
infra:wireguard
infra:dns_resolver
infra:ec2_gateway
```

---

## Layer model

| Layer | Contents | Mutability |
|-------|----------|------------|
| `observed` | Telemetry-derived nodes/edges (DNS, flows, app usage, geo) | Upserted on ingest; TTL/stale marking |
| `desired` | Policy assignments, infra topology, quarantine, effective rules | Updated on policy/device changes |
| `simulated` | Hypothetical rule toggles, blocks, quarantine | Ephemeral; never written to RDS |

**Simulation overlay:** clone affected `desired` edges into `simulated` layer with modified actions, or add `simulated_block` edges. Traversal APIs accept `layers: ['observed', 'desired', 'simulated']` and resolve conflicts: `simulated` overrides `desired` for matching `(relation, source, target)`.

This unifies:

- Pack toggle simulation (today: `POST /twin/simulate/pack-toggle`)
- Port what-if (today: frontend-only)
- Future quarantine / geo / schedule simulation

---

## Traversal API (query model)

All analytics features compile to these primitives.

### Neighbors

```http
GET /twin/graph/neighbors?node_id=...&direction=out|in|both&relations=...&layers=...
```

### Traverse (BFS/DFS)

```json
POST /twin/graph/traverse
{
  "seed_node_ids": ["device:42"],
  "direction": "out",
  "relations": ["queries", "resolves_to", "destinates"],
  "max_depth": 5,
  "layers": ["observed", "desired"],
  "stop_at_entity_types": ["ip_address", "domain"]
}
```

Returns: `{ nodes, edges, paths: [{ seed, hops: [node_id...] }] }`.

### Subgraph extract

```json
POST /twin/graph/subgraph
{
  "node_ids": ["policy_pack:social-media"],
  "depth": 3,
  "direction": "both",
  "layers": ["observed", "desired"]
}
```

### Feature-specific wrappers

| Feature | Seed | Direction | Relations / stop types |
|---------|------|-----------|------------------------|
| **Impact analysis** | `policy_pack`, `policy_rule`, `policy_profile` | `out` + `in` | `includes`, `assigned`, `blocks`, `queries` |
| **Blast radius** | `device`, `app`, `ip_address` | `out` | `runs`, `queries`, `resolves_to`, `opens`, `destinates` |
| **Dependency discovery** | any | `both` | all except `infra` internals optional |
| **Root cause analysis** | symptom (`domain`, blocked `dns_query`) | `in` | `blocks`, `defines`, `includes`, `assigned`, `enforces` |
| **Policy simulation** | changed rules | overlay | compare `observed` paths against `simulated` blocks |

---

## Mapping from current network map

| Current | Graph engine |
|---------|--------------|
| `NetworkMapNode` type `device` | `TwinNode` `entity_type=device` |
| `app` | `entity_type=app` |
| `domain` | `entity_type=domain` |
| `flow` | `entity_type=flow_session` + edges to `l4_service`, `ip_address` |
| Frontend `port` | `entity_type=l4_service` (always existed; was UI-only) |
| Frontend `tunnel`, `gateway`, `policy` | `entity_type=infra_component` + `policy_profile` |
| Edge `foreground` | `runs` |
| Edge `dns` / `dns_direct` | `queries` / `queries_direct` |
| Edge `dns_to_flow` | `correlates` |
| Edge `flow_session` | `opens` / `opens_direct` |
| Path/flow synthetic edges | `routed_via`, `terminates_at`, `uses_service`, `destinates` |

Migration path:

1. Implement `TwinGraphBuilder` from existing `build_map()` + policy DNS sync + static infra nodes.
2. Add projection functions that replace `expandToPathView` / `expandFlowToPortView` as **filters**, not graph rewrites.
3. Deprecate frontend-only synthetic node injection once API returns full graph.

---

## Visualization (projection layer)

Visualization **must not** define graph structure. It only consumes `TwinGraphSnapshot` or traversal results.

### Layout strategies (by use case)

| Use case | Layout | Data input |
|----------|--------|------------|
| **Exploration** | Force-directed (d3-force / elk layered) | Subgraph from seed + depth |
| **Path explanation** | Left-to-right DAG on infra spine | Filter: `routed_via`, `terminates_at`, `queries`, `resolves_to` |
| **Flow / L4** | Hierarchical: device → app → gateway → l4 → ip | Filter: flow relations only |
| **Impact / blast radius** | Radial from seed | BFS depth → ring radius |
| **RCA** | Reverse DAG highlighting enforcing nodes | Reverse traverse from symptom |

Column layouts (current attribution/path/flow modes) become **named presets**:

```typescript
const PROJECTION_PRESETS = {
  attribution: { entity_types: ['device','app','domain'], relations: ['runs','queries','queries_direct'] },
  path:        { include_infra: true, relations: ['runs','routed_via','terminates_at','enforces','queries','resolves_to'] },
  flow:        { entity_types: ['device','app','l4_service','flow_session','ip_address'], relations: ['opens','uses_service','destinates','correlates'] },
  impact:      { seed_driven: true, direction: 'both', max_depth: 4 },
};
```

Layout assigns `(x, y)` to **already-filtered** nodes. Changing preset must not rebuild topology.

### Visual encoding

| Channel | Encoding |
|---------|----------|
| Node shape | `entity_type` |
| Node color | `layer` (observed=neutral, desired=blue, simulated=amber) + `blocked`/`quarantined` state |
| Node size | `weight` or degree |
| Edge color | `relation` family (telemetry vs policy vs infra) |
| Edge width | `weight` (query count, bytes) |
| Edge: dashed | `stale` or `simulated` layer |

### Interaction

- Click node → `GET /neighbors` or local index → inspector panel (properties, timestamps).
- “Impact” / “Blast radius” / “Why blocked?” → server traverse with preset; highlight returned path set.
- Time slider → rebuild or filter `observed` layer by `last_seen_at` (phase 2).

### Recommended stack

- **Phase 1:** SVG + d3-force (replace fixed columns in `NetworkAttributionMapGraph`).
- **Phase 2:** Canvas for >500 nodes; keep SVG for small subgraphs.
- **Phase 3:** Optional WebGL (e.g. sigma.js) if graph history replay requires thousands of nodes.

---

## Implementation checklist

| Step | Deliverable | Status |
|------|-------------|--------|
| 1 | Pydantic + TypeScript schemas (`TwinNode`, `TwinEdge`, `TwinGraphSnapshot`) | Done |
| 2 | `TwinGraph` in-memory index + `neighbors()`, `traverse()`, `subgraph()` | Done |
| 3 | `TwinGraphBuilder` from attribution + flows + policy | Done |
| 4 | `GET /twin/graph/snapshot` + `POST /twin/graph/traverse` + `GET /twin/graph/neighbors` | Done |
| 5 | Frontend `useTwinGraph` + projection presets + `TwinGraphIndex` | Done (RCA UI pending) |
| 6 | Projection presets replacing expand* in map component | Done |
| 7 | Force-directed layout; column presets as optional | Pending |
| 8 | Wire impact analysis + pack simulation to traverse API | Pending |

---

## Related code (initial scaffold)

| Path | Role |
|------|------|
| `backend/app/features/twin/graph/schemas.py` | Canonical Pydantic types |
| `backend/app/features/twin/graph/builder.py` | Assemble graph from attribution, flows, policy |
| `backend/app/features/twin/services/twin_graph_service.py` | Snapshot + traverse service |
| `backend/app/features/twin/routes/twin_route.py` | Graph API routes |
| `frontend/src/features/twin-graph/types/twinGraph.ts` | Frontend type mirror |

---

## Open questions

1. **Event nodes vs edge weights** — Promote high-value DNS queries to `dns_query` nodes when RCA needs per-query timestamps?
2. **Graph persistence** — Is Redis snapshot enough for multi-admin concurrent simulation?
3. **Multi-site** — Do `infra_component` nodes multiply per site, or single global gateway per deployment?
4. **Client-side graph** — Full snapshot to browser vs server-side traverse only (security vs interactivity).

Default recommendations: edge weights in phase 1; Redis snapshot in phase 2; single infra chain per EC2; hybrid (subgraph from server, local index for highlighting).
