import "server-only";
import { actionError, actionOk, zodFieldErrors, type ActionResult } from "@/lib/validators/common";
import type { z } from "@/lib/validators/zod";
import { toActionError } from "@/server/actions/define-action";
import { getPublicServiceContext, type PublicServiceContext } from "@/server/context";

/**
 * The adapter of the public portal (C10 exception, C22): portal actions (unlock a document with its access
 * key, record a view…) are built only with `definePublicAction`. Its fixed sequence is
 *
 *   resolve the share token → Zod parse → `handler(publicCtx, { shareLink, data })` → `ActionResult`
 *
 * It never reads the session and never grants more than the token's own link: the handler gets the resolved
 * `shareLink` and must use it to scope everything it touches. An unknown, revoked or expired token answers
 * the same generic `NOT_FOUND`, with no reason.
 *
 * Pass the **action** schemas of `shares.ts` as `input` (what a visitor may send), never the service
 * schemas: the server-only metadata (`ipHash`, `userAgent`, unlocked ids) is added by the handler after the
 * parse (C22).
 */

/** The minimum a resolved share link must expose; the shares module owns the full shape. */
export interface ResolvedShareLinkBase {
  id: string;
}

/**
 * Supplied by the shares module: finds the live link behind `token`, or `null` when it is unknown, revoked
 * or expired. It must not tell those cases apart.
 */
export type ShareTokenResolver<TLink extends ResolvedShareLinkBase> = (
  ctx: PublicServiceContext,
  token: string,
) => Promise<TLink | null>;

export interface PublicActionConfig<
  TSchema extends z.ZodType,
  TLink extends ResolvedShareLinkBase,
  TResult,
> {
  /** Action schema of the operation. It must contain the `token` (the share token of the URL). */
  input: TSchema;
  resolveToken: ShareTokenResolver<TLink>;
  handler: (
    ctx: PublicServiceContext,
    args: { shareLink: TLink; data: z.output<TSchema> },
  ) => Promise<TResult>;
}

/** The share token of a raw request, if it carries one. Read before the parse only to resolve the link. */
function tokenOf(rawInput: unknown): string | null {
  if (typeof rawInput !== "object" || rawInput === null) return null;
  const token = (rawInput as { token?: unknown }).token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** Builds a public Server Action: `(input) => Promise<ActionResult<TResult>>`. */
export function definePublicAction<
  TSchema extends z.ZodType,
  TLink extends ResolvedShareLinkBase,
  TResult,
>(
  config: PublicActionConfig<TSchema, TLink, TResult>,
): (input: z.input<TSchema>) => Promise<ActionResult<TResult>> {
  return async function publicAction(rawInput) {
    try {
      const ctx = getPublicServiceContext();

      // 1. Share token → link. Every failure looks the same from outside (generic 404).
      const token = tokenOf(rawInput);
      if (token === null) return actionError("NOT_FOUND");
      let shareLink: TLink | null;
      try {
        shareLink = await config.resolveToken(ctx, token);
      } catch (error) {
        // A domain failure (e.g. a `NOT_FOUND` from the shares service) must not explain itself.
        const mapped = toActionError(error);
        return !mapped.ok && mapped.error.code === "INTERNAL" ? mapped : actionError("NOT_FOUND");
      }
      if (shareLink === null) return actionError("NOT_FOUND");

      // 2. Input.
      const parsed = config.input.safeParse(rawInput);
      if (!parsed.success) {
        return actionError("VALIDATION", undefined, zodFieldErrors(parsed.error));
      }

      // 3. Service.
      const result = await config.handler(ctx, {
        shareLink,
        data: parsed.data as z.output<TSchema>,
      });
      return actionOk(result);
    } catch (error) {
      return toActionError(error);
    }
  };
}
