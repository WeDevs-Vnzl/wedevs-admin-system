import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  getMockSessionUser: vi.fn(),
  getSessionUser: vi.fn(),
  requireSessionUser: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => ({ getMockSessionUser: session.getMockSessionUser }));
vi.mock("@/server/auth/session", () => ({
  getSessionUser: session.getSessionUser,
  requireSessionUser: session.requireSessionUser,
}));

import { z } from "@/lib/validators/zod";
import {
  unlockSharedDocumentActionSchema,
  type UnlockSharedDocumentActionInput,
} from "@/lib/validators/shares";
import { ServiceError } from "@/server/errors";
import { definePublicAction } from "./define-public-action";

const TOKEN = "A".repeat(43);
const link = { id: "shr_demo", documentIds: ["doc_1"] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

function build(
  resolveToken = vi.fn(async (_ctx: unknown, token: string) => (token === TOKEN ? link : null)),
) {
  const handler = vi.fn(
    async (
      _ctx: unknown,
      args: { shareLink: typeof link; data: { token: string; documentId: string } },
    ) => ({
      linkId: args.shareLink.id,
      documentId: args.data.documentId,
    }),
  );
  const action = definePublicAction({
    input: z.object({ token: z.string(), documentId: z.string().min(1, "validation.required") }),
    resolveToken,
    handler,
  }) as (input: unknown) => Promise<unknown>;
  return { action, handler, resolveToken };
}

describe("definePublicAction: resolve token → Zod → handler", () => {
  it("runs the handler with the public context and the resolved link", async () => {
    const { action, handler, resolveToken } = build();
    expect(await action({ token: TOKEN, documentId: "doc_1" })).toEqual({
      ok: true,
      data: { linkId: "shr_demo", documentId: "doc_1" },
    });
    expect(resolveToken).toHaveBeenCalledWith(expect.objectContaining({ user: null }), TOKEN);
    const [ctx, args] = handler.mock.calls[0] as unknown as [
      { user: null; db: unknown; now: Date },
      { shareLink: unknown; data: unknown },
    ];
    expect(ctx.user).toBeNull();
    expect(ctx.now).toBeInstanceOf(Date);
    expect(args.shareLink).toBe(link);
    expect(args.data).toEqual({ token: TOKEN, documentId: "doc_1" });
  });

  it("an unknown token → the generic NOT_FOUND, nothing else runs", async () => {
    const { action, handler } = build();
    const result = await action({ token: "B".repeat(43), documentId: "doc_1" });
    expect(result).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "common.errors.NOT_FOUND" },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("resolves the token before parsing: a bad body on an unknown token is NOT_FOUND, not VALIDATION", async () => {
    const { action } = build();
    expect(await action({ token: "B".repeat(43), documentId: "" })).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });

  it("a missing, empty or non-string token → the same generic NOT_FOUND, the resolver is not asked", async () => {
    const { action, resolveToken } = build();
    for (const input of [undefined, null, "x", {}, { token: "" }, { token: 7 }]) {
      expect(await action(input)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    }
    expect(resolveToken).not.toHaveBeenCalled();
  });

  it("a revoked or expired link (resolver says null, or throws a domain error) is indistinguishable from unknown", async () => {
    const unknown = await build().action({ token: "B".repeat(43), documentId: "d" });
    const throwing = build(
      vi.fn(async () => {
        throw new ServiceError("FORBIDDEN");
      }),
    );
    const viaThrow = await throwing.action({ token: TOKEN, documentId: "d" });
    expect(viaThrow).toEqual(unknown);
    expect(throwing.handler).not.toHaveBeenCalled();
  });

  it("an unexpected resolver failure is an INTERNAL, logged and not explained", async () => {
    const { action, handler } = build(
      vi.fn(async () => {
        throw new Error("db down");
      }),
    );
    expect(await action({ token: TOKEN, documentId: "d" })).toEqual({
      ok: false,
      error: { code: "INTERNAL", message: "common.errors.INTERNAL" },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("a valid token with a bad body → VALIDATION and the handler is not called", async () => {
    const { action, handler } = build();
    expect(await action({ token: TOKEN, documentId: "" })).toEqual({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "common.errors.VALIDATION",
        fieldErrors: { documentId: ["validation.required"] },
      },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("maps the portal domain errors (wrong key, lockout) to their codes", async () => {
    for (const code of ["ACCESS_KEY_INVALID", "ACCESS_KEY_LOCKED"] as const) {
      const resolveToken = vi.fn(async () => link);
      const action = definePublicAction({
        input: z.object({ token: z.string() }),
        resolveToken,
        handler: async () => {
          throw new ServiceError(code);
        },
      });
      expect(await action({ token: TOKEN })).toEqual({
        ok: false,
        error: { code, message: `common.errors.${code}` },
      });
    }
  });

  it("strips what a visitor must not send when the action schema is the one of shares.ts (C22)", async () => {
    const seen = vi.fn(
      async (_ctx: unknown, args: { data: UnlockSharedDocumentActionInput }) => args.data,
    );
    const action = definePublicAction({
      input: unlockSharedDocumentActionSchema,
      resolveToken: async () => link,
      handler: seen,
    });
    const result = await action({
      token: TOKEN,
      documentId: "doc_1",
      key: "  long-enough-key  ",
      ipHash: "f".repeat(64),
      unlockedDocumentIds: ["doc_1"],
      ip: "10.0.0.1",
    } as never);
    expect(result).toEqual({
      ok: true,
      data: { token: TOKEN, documentId: "doc_1", key: "long-enough-key" },
    });
  });
});

describe("definePublicAction: it never reads the session (C10 exception)", () => {
  it("does not touch the session on success, on 404 or on failure", async () => {
    const { action } = build();
    await action({ token: TOKEN, documentId: "doc_1" });
    await action({ token: "B".repeat(43), documentId: "doc_1" });
    await action({ token: TOKEN, documentId: "" });
    expect(session.getMockSessionUser).not.toHaveBeenCalled();
    expect(session.getSessionUser).not.toHaveBeenCalled();
    expect(session.requireSessionUser).not.toHaveBeenCalled();
  });

  it("works for an anonymous visitor even when the session would throw", async () => {
    session.requireSessionUser.mockRejectedValue(new Error("must not be called"));
    session.getSessionUser.mockRejectedValue(new Error("must not be called"));
    const { action } = build();
    expect(await action({ token: TOKEN, documentId: "doc_1" })).toMatchObject({ ok: true });
  });
});
