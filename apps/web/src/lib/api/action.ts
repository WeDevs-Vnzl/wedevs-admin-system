import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import type { ActionResult } from "@/lib/validators/common";
import type { ApiClient } from "./client";
import { fromThrown, toActionResult, type ApiResponseLike } from "./errors";
import { getServerApi } from "./server";

/**
 * The thin Server Action proxy (C10): token → one API call → error mapping → revalidate. No `can()`, no
 * business rule, no Zod business checks (the BE decides; forms validate for UX only). Never throws to the
 * client, except for Next control-flow errors (redirect, `notFound`), which must reach the framework.
 */

/** What to refresh after a successful mutation: a path, a path with a type, or a cache tag. */
export type RevalidateTarget =
  string | { path: string; type?: "page" | "layout" } | { tag: string };

export interface ApiActionConfig<TInput, TData> {
  /** Exactly one API call. */
  call: (input: TInput, api: ApiClient) => Promise<ApiResponseLike<TData>>;
  /** Runs only after the call succeeded. */
  revalidate?:
    readonly RevalidateTarget[] | ((input: TInput, data: TData) => readonly RevalidateTarget[]);
  /** Injected in tests; defaults to `getServerApi`. */
  getApi?: () => Promise<ApiClient>;
}

/** Next.js signals redirects, `notFound()` and dynamic rendering by throwing; those must reach the framework. */
function isNextControlFlowError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("digest" in error)) return false;
  const digest = (error as { digest: unknown }).digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_") ||
      digest === "DYNAMIC_SERVER_USAGE" ||
      digest === "BAILOUT_TO_CLIENT_SIDE_RENDERING")
  );
}

function applyRevalidation(targets: readonly RevalidateTarget[]): void {
  for (const target of targets) {
    if (typeof target === "string") revalidatePath(target);
    else if ("tag" in target) updateTag(target.tag);
    else revalidatePath(target.path, target.type);
  }
}

export function apiAction<TInput, TData>(
  config: ApiActionConfig<TInput, TData>,
): (input: TInput) => Promise<ActionResult<TData>> {
  return async function action(input) {
    try {
      const api = await (config.getApi ?? getServerApi)();
      const result = toActionResult(await config.call(input, api));
      if (!result.ok) return result;

      if (config.revalidate) {
        // The change is already made: a revalidation failure must not turn into an error result.
        try {
          const targets =
            typeof config.revalidate === "function"
              ? config.revalidate(input, result.data)
              : config.revalidate;
          applyRevalidation(targets);
        } catch (error) {
          if (isNextControlFlowError(error)) throw error;
          console.error("[apiAction] revalidation failed", error);
        }
      }
      return result;
    } catch (error) {
      if (isNextControlFlowError(error)) throw error;
      return fromThrown(error);
    }
  };
}
