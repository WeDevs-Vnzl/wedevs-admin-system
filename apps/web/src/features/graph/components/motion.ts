/** The user's reduced-motion preference (WCAG 2.3.3, better-ui motion rules). */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Duration of a camera animation (`fitView`, `setCenter`) in ms. Under reduced motion the camera moves at once; the
 * final view is the same.
 */
export function cameraDuration(ms: number, prefersReduced: boolean): number {
  return prefersReduced ? 0 : ms;
}

/**
 * `true` when the user asked for reduced motion. Read when an animation starts, so a changed preference applies to the
 * next move without re-rendering. `false` where there is no window to ask.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}
