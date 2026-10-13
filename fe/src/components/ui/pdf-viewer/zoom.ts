// Page and zoom state for the PdfViewer toolbar (wireframe 4.8). Pure functions so the bounds and
// steps are testable without pdf.js.

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? 1;
export const DEFAULT_ZOOM = 1;

// Pages are 1-based. An empty document (or one not loaded yet) keeps the first page.
export function clampPage(page: number, pageCount: number): number {
  if (pageCount < 1) return 1;
  return Math.min(Math.max(1, page), pageCount);
}

export function canGoPrevious(page: number): boolean {
  return page > 1;
}

export function canGoNext(page: number, pageCount: number): boolean {
  return page < pageCount;
}

export function zoomIn(zoom: number): number {
  return ZOOM_STEPS.find((step) => step > zoom) ?? MAX_ZOOM;
}

export function zoomOut(zoom: number): number {
  const smaller = ZOOM_STEPS.filter((step) => step < zoom);
  return smaller[smaller.length - 1] ?? MIN_ZOOM;
}

export function canZoomIn(zoom: number): boolean {
  return zoom < MAX_ZOOM;
}

export function canZoomOut(zoom: number): boolean {
  return zoom > MIN_ZOOM;
}

export function zoomPercent(zoom: number): number {
  return Math.round(zoom * 100);
}
