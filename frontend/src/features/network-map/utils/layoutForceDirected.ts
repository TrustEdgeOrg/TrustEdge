import {
  NetworkMapEdge,
  NetworkMapLayout,
  NetworkMapLayoutMode,
  NetworkMapNode,
  PositionedNode,
} from '../types/networkMap';

const PAD = 56;
const NODE_PAD = 28;

export interface ForceLayoutOptions {
  width?: number;
  height?: number;
  iterations?: number;
}

interface SimNode {
  id: string;
  node: NetworkMapNode;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Spring-force layout — nodes float by connectivity, not fixed columns. */
export function layoutForceDirected(
  nodes: NetworkMapNode[],
  edges: NetworkMapEdge[],
  mode: NetworkMapLayoutMode = 'attribution',
  options: ForceLayoutOptions = {},
): NetworkMapLayout {
  const canvasW = options.width ?? 720;
  const canvasH = options.height ?? 480;
  const iterations = options.iterations ?? 140;

  if (nodes.length === 0) {
    return {
      nodes: [],
      edges,
      width: canvasW,
      height: canvasH,
      mode,
      layoutStyle: 'force',
      columnGuides: {},
    };
  }

  const simNodes: SimNode[] = nodes.map((node, index) => {
    const angle = (2 * Math.PI * index) / nodes.length;
    const radius = Math.min(canvasW, canvasH) * 0.28;
    return {
      id: node.id,
      node,
      x: canvasW / 2 + Math.cos(angle) * radius,
      y: canvasH / 2 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    };
  });
  const byId = new Map(simNodes.map((sim) => [sim.id, sim]));

  const links = edges
    .map((edge) => ({
      source: byId.get(edge.source),
      target: byId.get(edge.target),
    }))
    .filter((link): link is { source: SimNode; target: SimNode } => Boolean(link.source && link.target));

  const repulsion = 4200;
  const linkStrength = 0.055;
  const idealLinkLength = 90;
  const centerPull = 0.012;
  const damping = 0.82;

  for (let step = 0; step < iterations; step += 1) {
    const cooling = 1 - step / iterations;

    for (let i = 0; i < simNodes.length; i += 1) {
      for (let j = i + 1; j < simNodes.length; j += 1) {
        const a = simNodes[i];
        const b = simNodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const force = (repulsion / (dist * dist)) * cooling;
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        a.vx += dx;
        a.vy += dy;
        b.vx -= dx;
        b.vy -= dy;
      }
    }

    for (const link of links) {
      const dx = link.target.x - link.source.x;
      const dy = link.target.y - link.source.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const displacement = dist - idealLinkLength;
      const force = displacement * linkStrength * cooling;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      link.source.vx += fx;
      link.source.vy += fy;
      link.target.vx -= fx;
      link.target.vy -= fy;
    }

    for (const sim of simNodes) {
      sim.vx += (canvasW / 2 - sim.x) * centerPull;
      sim.vy += (canvasH / 2 - sim.y) * centerPull;
      sim.x += sim.vx;
      sim.y += sim.vy;
      sim.vx *= damping;
      sim.vy *= damping;
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const sim of simNodes) {
    minX = Math.min(minX, sim.x);
    minY = Math.min(minY, sim.y);
    maxX = Math.max(maxX, sim.x);
    maxY = Math.max(maxY, sim.y);
  }

  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const targetW = Math.max(560, canvasW);
  const targetH = Math.max(320, canvasH);
  const scale = Math.min((targetW - PAD * 2) / spanX, (targetH - PAD * 2) / spanY);

  const positioned: PositionedNode[] = simNodes.map((sim) => ({
    ...sim.node,
    x: PAD + (sim.x - minX) * scale,
    y: PAD + (sim.y - minY) * scale,
  }));

  const width = Math.max(
    targetW,
    ...positioned.map((node) => node.x + NODE_PAD),
  );
  const height = Math.max(
    targetH,
    ...positioned.map((node) => node.y + NODE_PAD),
  );

  return {
    nodes: positioned,
    edges,
    width,
    height,
    mode,
    layoutStyle: 'force',
    columnGuides: {},
  };
}
