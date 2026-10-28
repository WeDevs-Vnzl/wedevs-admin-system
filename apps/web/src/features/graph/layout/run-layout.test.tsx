import { afterEach, describe, expect, it, vi } from "vitest";
import type { LayoutRequest } from "./compute-layout";

// A3: the layout runs in a module Web Worker when the browser has one, and on the main thread otherwise. jsdom
// has no `Worker`, so these tests run the fallback path, the same one the component tests rely on.

const nodes = [{ id: "CLIENT:a" }, { id: "PROJECT:b" }, { id: "PROJECT:c" }, { id: "DOCUMENT:d" }];
const edges = [
  { source: "CLIENT:a", target: "PROJECT:b" },
  { source: "CLIENT:a", target: "PROJECT:c" },
  { source: "DOCUMENT:d", target: "PROJECT:b" },
];

function request(overrides: Partial<LayoutRequest> = {}): LayoutRequest {
  return {
    algorithm: "radial",
    nodes,
    edges,
    rootId: "CLIENT:a",
    previous: {},
    pinned: [],
    keepExisting: false,
    anchors: {},
    ...overrides,
  };
}

async function freshModule() {
  vi.resetModules();
  return import("./run-layout");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runLayout", () => {
  it("falls back to the main thread in jsdom (no Worker) and places every node", async () => {
    expect(typeof Worker).toBe("undefined");
    const { runLayout } = await freshModule();

    for (const algorithm of ["radial", "hierarchical", "force"] as const) {
      const positions = await runLayout(request({ algorithm }));
      expect(Object.keys(positions).sort(), algorithm).toEqual(nodes.map((n) => n.id).sort());
      for (const point of Object.values(positions)) {
        expect(Number.isFinite(point.x) && Number.isFinite(point.y), algorithm).toBe(true);
      }
    }
  });

  it("falls back to the main thread when the Worker cannot be created", async () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("blocked by CSP");
        }
      },
    );
    const { runLayout } = await freshModule();
    const positions = await runLayout(request());
    expect(Object.keys(positions)).toHaveLength(nodes.length);
  });

  it("puts the root of the radial layout at the center", async () => {
    const { runLayout } = await freshModule();
    const positions = await runLayout(request());
    expect(positions["CLIENT:a"]).toEqual({ x: 0, y: 0 });
  });

  it("never moves pinned nodes, in a full layout too", async () => {
    const { runLayout } = await freshModule();
    for (const algorithm of ["radial", "hierarchical", "force"] as const) {
      const positions = await runLayout(
        request({
          algorithm,
          previous: { "PROJECT:b": { x: 999, y: -42 } },
          pinned: ["PROJECT:b"],
        }),
      );
      expect(positions["PROJECT:b"], algorithm).toEqual({ x: 999, y: -42 });
    }
  });

  it("keeps placed nodes where they are and rings new ones around their anchor (incremental)", async () => {
    const { runLayout } = await freshModule();
    const previous = {
      "CLIENT:a": { x: 0, y: 0 },
      "PROJECT:b": { x: 300, y: 0 },
      "PROJECT:c": { x: -300, y: 0 },
    };
    const positions = await runLayout(
      request({ previous, keepExisting: true, anchors: { "DOCUMENT:d": "PROJECT:b" } }),
    );

    expect(positions["CLIENT:a"]).toEqual(previous["CLIENT:a"]);
    expect(positions["PROJECT:b"]).toEqual(previous["PROJECT:b"]);
    expect(positions["PROJECT:c"]).toEqual(previous["PROJECT:c"]);
    const added = positions["DOCUMENT:d"];
    expect(added).toBeDefined();
    const distance = Math.hypot((added?.x ?? 0) - 300, added?.y ?? 0);
    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(400);
  });
});
