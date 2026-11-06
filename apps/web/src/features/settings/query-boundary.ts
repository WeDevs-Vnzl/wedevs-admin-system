import "server-only";
import { notFound, redirect } from "next/navigation";
import type { ApiActionResult } from "@/lib/api/errors";

/**
 * Server-component read of an API result (`frontend-patterns.md` §16): the data on success; otherwise the
 * boundary the error code maps to. `FORBIDDEN` and `NOT_FOUND` are the in-shell not-found page (the "no
 * permission" state, HU-02 CA1), `UNAUTHENTICATED` goes to sign-in, anything else reaches the error
 * boundary. The BE decides access; this only renders its answer.
 */
export function unwrapOrBoundary<T>(result: ApiActionResult<T>): T {
  if (result.ok) return result.data;
  const { code, message, redirectTo } = result.error;
  if (code === "UNAUTHENTICATED") redirect(redirectTo ?? "/sign-in");
  if (code === "FORBIDDEN" || code === "NOT_FOUND") notFound();
  throw new Error(message);
}
