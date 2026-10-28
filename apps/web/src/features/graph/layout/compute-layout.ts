import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import ELK from "elkjs/lib/elk.bundled.js";

// Pure layout of the graph (DT-12): radial, hierarchical (elkjs "layered") and force (d3-force). Runs in the layout
// Web Worker and, where there is no worker (jsdom, a blocked CSP), on the main thread (A3). Positions are node
// centers in canvas units. Rules shared by the three algorithms:
//   pinned       a pinned node keeps its previous position, in a full layout too (PRD §8.12.4 "Fijar").
//   incremental  with `keepExisting`, every node already placed stays put and only the new ones are placed, on a
//                ring around the node whose expansion brought them (`anchors`).

export type LayoutAlgorithm = "radial" | "hierarchical" | "force";
export const LAYOUT_ALGORITHMS = ["radial", "hierarchical", "force"] as const;

export type Point = { x: number; y: number };
export type Positions = Record<string, Point>;

export interface LayoutRequest {
  algorithm: LayoutAlgorithm;
  /** `group` clusters force-layout nodes (the client halo of the global graph). */
  nodes: { id: string; group?: string }[];
  edges: { source: string; target: string }[];
  rootId: string | null;
  previous: Positions;
  pinned: string[];
  keepExisting: boolean;
  /** New node id → the node it is placed around in an incremental layout. */
  anchors: Record<string, string>;
}

/** Node box used by every algorithm (the canvas renders nodes at this size). */
export const NODE_WIDTH = 184;
export const NODE_HEIGHT = 56;

const RING_STEP = 260;
const ANCHOR_RADIUS = 240;

export async function computeLayout(request: LayoutRequest): Promise<Positions> {
  const placed = request.keepExisting ? incremental(request) : await full(request);
  for (const id of request.pinned) {
    const previous = request.previous[id];
    if (previous && id in placed) placed[id] = { ...previous };
  }
  return placed;
}

async function full(request: LayoutRequest): Promise<Positions> {
  switch (request.algorithm) {
    case "radial":
      return radial(request);
    case "hierarchical":
      return hierarchical(request);
    case "force":
      return force(request);
  }
}

/** Nodes already placed stay; new ones form a ring around their anchor (or around the centroid). */
function incremental(request: LayoutRequest): Positions {
  const positions: Positions = {};
  const pending = new Map<string, string[]>();
  for (const node of request.nodes) {
    const previous = request.previous[node.id];
    if (previous) {
      positions[node.id] = { ...previous };
      continue;
    }
    const anchor = request.anchors[node.id] ?? "";
    pending.set(anchor, [...(pending.get(anchor) ?? []), node.id]);
  }
  const placedPoints = Object.values(positions);
  const centroid: Point = placedPoints.length
    ? {
        x: placedPoints.reduce((sum, point) => sum + point.x, 0) / placedPoints.length,
        y: placedPoints.reduce((sum, point) => sum + point.y, 0) / placedPoints.length,
      }
    : { x: 0, y: 0 };
  for (const [anchor, ids] of pending) {
    const center = positions[anchor] ?? centroid;
    // Outward from the centroid, so new nodes open away from the rest of the graph.
    const outward = Math.atan2(center.y - centroid.y, center.x - centroid.x);
    // A fan of 30° per node around the outward direction, a full circle once it gets crowded.
    const spread = Math.min(Math.PI * 2, (Math.PI / 6) * (ids.length - 1));
    const fullCircle = spread >= Math.PI * 2;
    const step = ids.length === 1 ? 0 : spread / (fullCircle ? ids.length : ids.length - 1);
    const start = outward - (fullCircle ? 0 : spread / 2);
    const radius = ANCHOR_RADIUS + Math.max(0, ids.length - 12) * 6;
    ids.forEach((id, index) => {
      const angle = start + step * index;
      positions[id] = {
        x: Math.round(center.x + radius * Math.cos(angle)),
        y: Math.round(center.y + radius * Math.sin(angle)),
      };
    });
  }
  return positions;
}

/** Breadth-first levels from the root; nodes not reached go to an outer ring. */
function radial(request: LayoutRequest): Positions {
  const ids = request.nodes.map((node) => node.id);
  const adjacency = adjacencyOf(ids, request.edges);
  const root = request.rootId && adjacency.has(request.rootId) ? request.rootId : ids[0];
  const positions: Positions = {};
  if (!root) return positions;

  const level = new Map<string, number>([[root, 0]]);
  const parent = new Map<string, string>();
  const queue = [root];
  while (queue.length) {
    const current = queue.shift() as string;
    for (const next of adjacency.get(current) ?? []) {
      if (level.has(next)) continue;
      level.set(next, (level.get(current) ?? 0) + 1);
      parent.set(next, current);
      queue.push(next);
    }
  }
  const deepest = Math.max(0, ...level.values());
  for (const id of ids) if (!level.has(id)) level.set(id, deepest + 1);

  const rings = new Map<number, string[]>();
  for (const id of ids) {
    const ring = level.get(id) ?? 0;
    rings.set(ring, [...(rings.get(ring) ?? []), id]);
  }
  const angleOf = new Map<string, number>();
  positions[root] = { x: 0, y: 0 };
  angleOf.set(root, 0);
  for (const ring of [...rings.keys()].sort((a, b) => a - b)) {
    if (ring === 0) continue;
    // Children follow their parent's angle, so branches stay together around the circle.
    const members = (rings.get(ring) ?? []).sort(
      (a, b) =>
        (angleOf.get(parent.get(a) ?? "") ?? Infinity) -
          (angleOf.get(parent.get(b) ?? "") ?? Infinity) || a.localeCompare(b),
    );
    const radius = ring * RING_STEP + Math.max(0, members.length - 16) * 8;
    members.forEach((id, index) => {
      const angle = (2 * Math.PI * index) / members.length - Math.PI / 2;
      angleOf.set(id, angle);
      positions[id] = {
        x: Math.round(radius * Math.cos(angle)),
        y: Math.round(radius * Math.sin(angle)),
      };
    });
  }
  return positions;
}

async function hierarchical(request: LayoutRequest): Promise<Positions> {
  const ids = new Set(request.nodes.map((node) => node.id));
  const elk = new ELK();
  const result = await elk.layout({
    id: "graph",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "90",
    },
    children: request.nodes.map((node) => ({
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: request.edges
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      .map((edge, index) => ({ id: `e${index}`, sources: [edge.source], targets: [edge.target] })),
  });
  const positions: Positions = {};
  for (const child of result.children ?? []) {
    positions[child.id] = {
      x: Math.round((child.x ?? 0) + NODE_WIDTH / 2),
      y: Math.round((child.y ?? 0) + NODE_HEIGHT / 2),
    };
  }
  return positions;
}

type ForceNode = SimulationNodeDatum & { id: string; group?: string };

function force(request: LayoutRequest): Positions {
  const ids = new Set(request.nodes.map((node) => node.id));
  const pinned = new Set(request.pinned);
  const nodes: ForceNode[] = request.nodes.map((node) => {
    const previous = request.previous[node.id];
    return {
      id: node.id,
      group: node.group,
      ...(previous ? { x: previous.x, y: previous.y } : {}),
      ...(previous && pinned.has(node.id) ? { fx: previous.x, fy: previous.y } : {}),
    };
  });
  const links: SimulationLinkDatum<ForceNode>[] = request.edges
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target }));

  const simulation = forceSimulation(nodes)
    .force(
      "link",
      forceLink<ForceNode, SimulationLinkDatum<ForceNode>>(links)
        .id((node) => node.id)
        .distance(150),
    )
    .force("charge", forceManyBody().strength(-420))
    .force("center", forceCenter(0, 0))
    .force("collide", forceCollide(NODE_WIDTH / 2))
    .stop();

  // Cluster pull: each group (client) gets a home on a circle; members drift towards it.
  const groups = [...new Set(nodes.map((node) => node.group).filter(Boolean))] as string[];
  if (groups.length > 1) {
    const radius = 140 * Math.sqrt(groups.length) + 200;
    const home = new Map(
      groups.map((group, index) => {
        const angle = (2 * Math.PI * index) / groups.length;
        return [group, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }];
      }),
    );
    simulation
      .force(
        "clusterX",
        forceX<ForceNode>((node) => home.get(node.group ?? "")?.x ?? 0).strength(0.08),
      )
      .force(
        "clusterY",
        forceY<ForceNode>((node) => home.get(node.group ?? "")?.y ?? 0).strength(0.08),
      );
  }

  const ticks = Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay()));
  simulation.tick(ticks);

  const positions: Positions = {};
  for (const node of nodes) {
    positions[node.id] = { x: Math.round(node.x ?? 0), y: Math.round(node.y ?? 0) };
  }
  return positions;
}

function adjacencyOf(ids: string[], edges: LayoutRequest["edges"]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of edges) {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }
  for (const list of adjacency.values()) list.sort();
  return adjacency;
}
