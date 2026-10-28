"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LayoutAlgorithm, LayoutRequest, Point, Positions } from "./compute-layout";
import { runLayout } from "./run-layout";

type UseGraphLayoutInput = {
  algorithm: LayoutAlgorithm;
  nodes: LayoutRequest["nodes"];
  edges: LayoutRequest["edges"];
  rootId: string | null;
  pinned: ReadonlySet<string>;
  /** New node → the node whose expansion brought it. */
  anchors: Record<string, string>;
  /**
   * A full layout runs on the first render and whenever this key changes (layout switch, a new server result);
   * any other change of the node set only places the new nodes (incremental layout, PRD §8.12.4).
   */
  layoutKey: string;
};

/**
 * Node centers for the canvas, computed off the main thread (`runLayout`). Stale results are dropped; `fitNonce`
 * grows after every full layout so the canvas can fit the view; `pin` stores a dragged node's position.
 */
export function useGraphLayout({
  algorithm,
  nodes,
  edges,
  rootId,
  pinned,
  anchors,
  layoutKey,
}: UseGraphLayoutInput) {
  const [positions, setPositions] = useState<Positions>({});
  const [computing, setComputing] = useState(false);
  const [fitNonce, setFitNonce] = useState(0);
  const positionsRef = useRef(positions);
  const lastKey = useRef<string | null>(null);
  const run = useRef(0);

  const nodeKey = nodes.map((node) => `${node.id}|${node.group ?? ""}`).join(",");
  const edgeKey = edges.map((edge) => `${edge.source}>${edge.target}`).join(",");

  useEffect(() => {
    const full = lastKey.current !== layoutKey;
    lastKey.current = layoutKey;
    const current = positionsRef.current;
    if (!full && nodes.every((node) => current[node.id])) {
      // Only removals (collapse): drop the positions of the nodes that left.
      const kept = Object.fromEntries(nodes.map((node) => [node.id, current[node.id] as Point]));
      positionsRef.current = kept;
      setPositions(kept);
      return;
    }
    const id = (run.current += 1);
    setComputing(true);
    void runLayout({
      algorithm,
      nodes,
      edges,
      rootId,
      previous: current,
      pinned: [...pinned],
      keepExisting: !full,
      anchors,
    }).then((next) => {
      if (id !== run.current) return;
      positionsRef.current = next;
      setPositions(next);
      setComputing(false);
      if (full) setFitNonce((value) => value + 1);
    });
    // `nodeKey`/`edgeKey` stand for `nodes`/`edges`; pins and anchors are read at run time only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, nodeKey, edgeKey, algorithm, rootId]);

  const pin = useCallback((id: string, point: Point) => {
    positionsRef.current = { ...positionsRef.current, [id]: point };
    setPositions(positionsRef.current);
  }, []);

  return { positions, computing, fitNonce, pin };
}
