import { computeLayout, type LayoutRequest, type Positions } from "./compute-layout";

// Runs `computeLayout` in a module Web Worker (A3, CSP `worker-src 'self'`) so a 500-node force layout never blocks
// the main thread. Without a worker (jsdom, an old browser, a blocked script) the same function runs on the main
// thread; a worker that fails mid-flight is dropped and its pending requests fall back too.

type Pending = { request: LayoutRequest; resolve: (positions: Positions) => void };
type Reply = { id: number; positions?: Positions; error?: string };

let worker: Worker | null | undefined;
let sequence = 0;
const pending = new Map<number, Pending>();

function fallback(entry: Pending) {
  void computeLayout(entry.request).then(entry.resolve);
}

function dropWorker() {
  worker?.terminate();
  worker = null;
  for (const entry of pending.values()) fallback(entry);
  pending.clear();
}

function layoutWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === "undefined") return (worker = null);
  try {
    const created = new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
    created.onmessage = (event: MessageEvent<Reply>) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      if (event.data.positions) entry.resolve(event.data.positions);
      else fallback(entry);
    };
    created.onerror = dropWorker;
    worker = created;
  } catch {
    worker = null;
  }
  return worker;
}

export function runLayout(request: LayoutRequest): Promise<Positions> {
  const target = layoutWorker();
  if (!target) return computeLayout(request);
  return new Promise((resolve) => {
    sequence += 1;
    pending.set(sequence, { request, resolve });
    target.postMessage({ id: sequence, request });
  });
}
