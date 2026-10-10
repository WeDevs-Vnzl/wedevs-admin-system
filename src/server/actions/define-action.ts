import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import {
  ERROR_CODE_VALUES,
  actionError,
  actionOk,
  zodFieldErrors,
  type ActionResult,
  type ErrorCode,
} from "@/lib/validators/common";
import { z } from "@/lib/validators/zod";
import { can, type PermissionAction, type PermissionResource } from "@/server/auth/permissions";
import { getServiceContext, type ServiceContext } from "@/server/context";
import { ServiceError } from "@/server/errors";

/**
 * The action adapter (C10, DT-37): every Server Action is built with `defineAction`, which enforces the
 * fixed sequence
 *
 *   session → `can()` → Zod parse → `handler(ctx, data)` → revalidate → `ActionResult`
 *
 * and never throws to the client. Reads (async combobox, search) go through it too. The only exception is
 * the public portal, built with `definePublicAction`.
 */

/** One `can()` check: the action on a resource of the PRD §4.3 matrix (DT-66). */
export interface ActionPermission {
  action: PermissionAction;
  resource: PermissionResource;
}

/**
 * What an action requires: a single check, a list where **any** passes (an upload is allowed to whoever can
 * create something it attaches to), or `"authenticated"` for actions every signed-in user may call
 * (preferences of one's own, reference data, the MOCK "View as role").
 */
export type PermissionRule =
  ActionPermission | readonly [ActionPermission, ...ActionPermission[]] | "authenticated";

/** What to refresh after a mutation: a path (`"/clients"`), a path with a type, or a cache tag. */
export type RevalidateTarget =
  string | { path: string; type?: "page" | "layout" } | { tag: string };

export interface ActionConfig<TSchema extends z.ZodType, TResult> {
  permission: PermissionRule;
  /** The same schema the form uses (PRD §7.4). Parsed after the permission check. */
  input: TSchema;
  /** Runs only after the handler succeeded. Omit for reads. */
  revalidate?:
    | readonly RevalidateTarget[]
    | ((data: z.output<TSchema>, result: TResult) => readonly RevalidateTarget[]);
  /**
   * Resolves the owner of the record the input points at, for "own records only" grants (a Member deleting
   * a note, HU-02). Used only when the static check fails but the role holds the action as own-only; the
   * decision is then taken after the Zod parse, because the input is needed to find the record.
   */
  ownerOf?: (ctx: ServiceContext, data: z.output<TSchema>) => Promise<string | null | undefined>;
  handler: (ctx: ServiceContext, data: z.output<TSchema>) => Promise<TResult>;
}

/**
 * The `can()` checks of a rule. Only `"authenticated"` has none; an empty any-of list (possible only by
 * bypassing the tuple type) must never skip `can()`, so it is rejected when the action is defined (C10/C13).
 */
function asChecks(rule: PermissionRule): readonly ActionPermission[] {
  if (rule === "authenticated") return [];
  if (Array.isArray(rule)) {
    if (rule.length === 0) {
      throw new Error(
        "defineAction: an empty permission list would skip can(); use 'authenticated'.",
      );
    }
    return rule;
  }
  return [rule as ActionPermission];
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

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODE_VALUES as readonly string[]).includes(value);
}

/**
 * Maps anything a service, the session or a handler can throw to an `ActionResult` error. Domain errors
 * (`ServiceError`; `UnauthenticatedError` and anything else carrying a known `code`) keep their code (and, for
 * `ServiceError`, message key, field errors and the linked entity); a stray `ZodError` is a `VALIDATION`; everything else is an `INTERNAL` whose details stay in
 * the server log. Framework control-flow errors are rethrown.
 */
export function toActionError(error: unknown): ActionResult<never> {
  if (isNextControlFlowError(error)) throw error;
  if (error instanceof z.ZodError) {
    return actionError("VALIDATION", undefined, zodFieldErrors(error));
  }
  if (error instanceof ServiceError) {
    return actionError(error.code, error.message, error.fieldErrors, error.entity);
  }
  // `UnauthenticatedError` and any other error that carries a known code, with the default message key.
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
  if (isErrorCode(code)) return actionError(code);
  console.error("[defineAction] unexpected error", error);
  return actionError("INTERNAL");
}

function applyRevalidation(targets: readonly RevalidateTarget[]): void {
  for (const target of targets) {
    if (typeof target === "string") revalidatePath(target);
    else if ("tag" in target) updateTag(target.tag);
    else revalidatePath(target.path, target.type);
  }
}

/** Builds a Server Action: `(input) => Promise<ActionResult<TResult>>`. See the file comment for the sequence. */
export function defineAction<TSchema extends z.ZodType, TResult>(
  config: ActionConfig<TSchema, TResult>,
): (input: z.input<TSchema>) => Promise<ActionResult<TResult>> {
  const { permission } = config;
  const checks = asChecks(permission);

  return async function action(rawInput) {
    try {
      // 1. Session. A missing session throws `UnauthenticatedError`, mapped to UNAUTHENTICATED.
      const ctx = await getServiceContext();
      const { user } = ctx;

      // 2. Permission, before the input is even looked at.
      const allowed =
        permission === "authenticated" || checks.some((c) => can(user, c.action, c.resource));
      const ownOnly =
        !allowed &&
        config.ownerOf !== undefined &&
        checks.some((c) => can(user, c.action, c.resource, { ownerId: user.id }));
      if (!allowed && !ownOnly) return actionError("FORBIDDEN");

      // 3. Input.
      const parsed = config.input.safeParse(rawInput);
      if (!parsed.success) {
        return actionError("VALIDATION", undefined, zodFieldErrors(parsed.error));
      }
      const data = parsed.data as z.output<TSchema>;

      // 3b. Own-records-only grants are decided once the record is known.
      if (ownOnly && config.ownerOf) {
        const ownerId = await config.ownerOf(ctx, data);
        if (!checks.some((c) => can(user, c.action, c.resource, { ownerId }))) {
          return actionError("FORBIDDEN");
        }
      }

      // 4. Service.
      const result = await config.handler(ctx, data);

      // 5. Revalidate. The change is already made, so a failure here must not turn into an error result.
      if (config.revalidate) {
        try {
          const targets =
            typeof config.revalidate === "function"
              ? config.revalidate(data, result)
              : config.revalidate;
          applyRevalidation(targets);
        } catch (error) {
          if (isNextControlFlowError(error)) throw error;
          console.error("[defineAction] revalidation failed", error);
        }
      }

      return actionOk(result);
    } catch (error) {
      return toActionError(error);
    }
  };
}
