import { computeLayout, type LayoutRequest } from "./compute-layout";

// Module Web Worker of the graph layout (A3). One message per request: `{ id, request }` in, `{ id, positions }` or
// `{ id, error }` out; `run-layout.ts` falls back to the main thread on an error.

type WorkerScope = {
  onmessage: ((event: MessageEvent<{ id: number; request: LayoutRequest }>) => void) | null;
  postMessage: (message: unknown) => void;
};

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { id, request } = event.data;
  computeLayout(request).then(
    (positions) => scope.postMessage({ id, positions }),
    (error: unknown) => scope.postMessage({ id, error: String(error) }),
  );
};
