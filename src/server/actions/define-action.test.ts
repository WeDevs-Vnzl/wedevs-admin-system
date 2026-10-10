import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);
vi.mock("next/cache", () => cache);

import { makeSessionUser } from "@/mocks/test-helpers";
import { z } from "@/lib/validators/zod";
import type { UserRole } from "@/lib/validators/enums";
import { ServiceError } from "@/server/errors";
import { defineAction, toActionError } from "./define-action";

const schema = z.object({ name: z.string().trim().min(1, "validation.required") });

function signIn(role: UserRole, overrides = {}) {
  session.getMockSessionUser.mockResolvedValue(makeSessionUser(role, overrides));
}

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  cache.revalidatePath.mockReset();
  cache.updateTag.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

function makeAction(overrides: Partial<Parameters<typeof defineAction>[0]> = {}) {
  const handler = vi.fn(async (_ctx: unknown, data: { name: string }) => ({ saved: data.name }));
  const action = defineAction({
    permission: { action: "create", resource: "client" },
    input: schema,
    revalidate: ["/clients"],
    handler,
    ...overrides,
  } as never) as (input: unknown) => Promise<unknown>;
  return { action, handler };
}

describe("defineAction: the fixed sequence", () => {
  it("1. no session → UNAUTHENTICATED, and nothing else runs", async () => {
    session.getMockSessionUser.mockResolvedValue(null);
    const { action, handler } = makeAction();
    expect(await action({ name: "x" })).toEqual({
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "common.errors.UNAUTHENTICATED" },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("2. a Viewer on a write → FORBIDDEN, the handler is not called", async () => {
    signIn("VIEWER");
    const { action, handler } = makeAction();
    expect(await action({ name: "x" })).toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: "common.errors.FORBIDDEN" },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("2. a Member calling a financial action → FORBIDDEN", async () => {
    signIn("MEMBER");
    const { action, handler } = makeAction({
      permission: { action: "create", resource: "invoice" },
    });
    expect(await action({ name: "x" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("2 before 3: the permission is checked before the input, so a Viewer sending junk is FORBIDDEN, not VALIDATION", async () => {
    signIn("VIEWER");
    const { action } = makeAction();
    expect(await action({ name: "" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("3. bad input → VALIDATION with field errors as i18n keys; the handler is not called", async () => {
    signIn("OWNER");
    const { action, handler } = makeAction();
    expect(await action({ name: "   " })).toEqual({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "common.errors.VALIDATION",
        fieldErrors: { name: ["validation.required"] },
      },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("3. input that is not even an object → VALIDATION under _form", async () => {
    signIn("OWNER");
    const { action } = makeAction();
    const result = (await action(undefined)) as {
      ok: false;
      error: { code: string; fieldErrors: Record<string, string[]> };
    };
    expect(result.error.code).toBe("VALIDATION");
    expect(Object.keys(result.error.fieldErrors)).toEqual(["_form"]);
  });

  it("4–6. success → handler gets (ctx, parsed data), revalidate runs after it, result is ok", async () => {
    signIn("ADMIN", { id: "usr_admin" });
    const order: string[] = [];
    const handler = vi.fn(async (_ctx: unknown, data: { name: string }) => {
      order.push("handler");
      return { saved: data.name };
    });
    cache.revalidatePath.mockImplementation(() => order.push("revalidate"));
    const { action } = makeAction({ handler } as never);

    expect(await action({ name: "  Kairos  " })).toEqual({ ok: true, data: { saved: "Kairos" } });
    expect(order).toEqual(["handler", "revalidate"]);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/clients");
    const [ctx, data] = handler.mock.calls[0] as unknown as [
      { user: { id: string }; db: unknown; now: Date },
      unknown,
    ];
    expect(ctx.user.id).toBe("usr_admin");
    expect(ctx.now).toBeInstanceOf(Date);
    expect(data).toEqual({ name: "Kairos" });
  });
});

describe("defineAction: permission rules", () => {
  it('"authenticated" lets every signed-in role through, still requires a session', async () => {
    const { action, handler } = makeAction({ permission: "authenticated" });
    signIn("VIEWER");
    expect(await action({ name: "x" })).toMatchObject({ ok: true });
    session.getMockSessionUser.mockResolvedValue(null);
    expect(await action({ name: "x" })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("a list passes when any entry is granted", async () => {
    const permission = [
      { action: "create", resource: "invoice" },
      { action: "create", resource: "note" },
    ];
    const { action } = makeAction({ permission } as never);
    signIn("MEMBER"); // can create notes, not invoices
    expect(await action({ name: "x" })).toMatchObject({ ok: true });
    signIn("VIEWER");
    expect(await action({ name: "x" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("an empty any-of list never skips can(): defining it throws (C10/C13)", () => {
    expect(() => makeAction({ permission: [] } as never)).toThrow(/empty permission list/);
  });

  it("only \"authenticated\" has no can() check: a one-entry list still denies a Viewer", async () => {
    const { action, handler } = makeAction({
      permission: [{ action: "create", resource: "invoice" }],
    } as never);
    signIn("VIEWER");
    expect(await action({ name: "x" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(handler).not.toHaveBeenCalled();
  });

  describe("own-records-only grants (Member deleting a note)", () => {
    const permission = { action: "delete", resource: "note" } as const;

    it("denies without an ownerOf: the static check cannot know the owner", async () => {
      signIn("MEMBER");
      const { action, handler } = makeAction({ permission } as never);
      expect(await action({ name: "x" })).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it("allows the author, after the input is parsed", async () => {
      signIn("MEMBER", { id: "usr_member" });
      const ownerOf = vi.fn(async () => "usr_member");
      const { action, handler } = makeAction({ permission, ownerOf } as never);
      expect(await action({ name: "x" })).toMatchObject({ ok: true });
      expect(ownerOf).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("denies somebody else's record and does not run the handler", async () => {
      signIn("MEMBER", { id: "usr_member" });
      const { action, handler } = makeAction({
        permission,
        ownerOf: async () => "usr_other",
      } as never);
      expect(await action({ name: "x" })).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it("denies a record with no owner", async () => {
      signIn("MEMBER");
      const { action } = makeAction({ permission, ownerOf: async () => null } as never);
      expect(await action({ name: "x" })).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
    });

    it("does not consult ownerOf for a role that holds the action outright", async () => {
      signIn("ADMIN");
      const ownerOf = vi.fn(async () => "usr_other");
      const { action } = makeAction({ permission, ownerOf } as never);
      expect(await action({ name: "x" })).toMatchObject({ ok: true });
      expect(ownerOf).not.toHaveBeenCalled();
    });

    it("never opens the door for a role with no grant at all (Viewer)", async () => {
      signIn("VIEWER");
      const ownerOf = vi.fn(async () => "usr_test");
      const { action } = makeAction({ permission, ownerOf } as never);
      expect(await action({ name: "x" })).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
      expect(ownerOf).not.toHaveBeenCalled();
    });

    it("an invalid input from the partial grant is a VALIDATION, and ownerOf is not called", async () => {
      signIn("MEMBER");
      const ownerOf = vi.fn(async () => "usr_test");
      const { action } = makeAction({ permission, ownerOf } as never);
      expect(await action({ name: "" })).toMatchObject({
        ok: false,
        error: { code: "VALIDATION" },
      });
      expect(ownerOf).not.toHaveBeenCalled();
    });
  });
});

describe("defineAction: revalidation", () => {
  it("a function target sees the parsed data and the result", async () => {
    signIn("OWNER");
    const revalidate = vi.fn(() => [
      "/a",
      { path: "/b", type: "layout" as const },
      { tag: "graph" },
    ]);
    const { action } = makeAction({ revalidate } as never);
    await action({ name: "k" });
    expect(revalidate).toHaveBeenCalledWith({ name: "k" }, { saved: "k" });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/a");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/b", "layout");
    expect(cache.updateTag).toHaveBeenCalledWith("graph");
  });

  it("an action without revalidate (a read) revalidates nothing", async () => {
    signIn("OWNER");
    const { action } = makeAction({ revalidate: undefined });
    expect(await action({ name: "k" })).toMatchObject({ ok: true });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
    expect(cache.updateTag).not.toHaveBeenCalled();
  });

  it("is skipped when the handler fails", async () => {
    signIn("OWNER");
    const { action } = makeAction({
      handler: async () => {
        throw new ServiceError("CONFLICT");
      },
    });
    expect(await action({ name: "k" })).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("a revalidation failure does not turn a committed change into an error", async () => {
    signIn("OWNER");
    cache.revalidatePath.mockImplementation(() => {
      throw new Error("no store");
    });
    const { action } = makeAction();
    expect(await action({ name: "k" })).toEqual({ ok: true, data: { saved: "k" } });
  });
});

describe("defineAction: it never throws to the client", () => {
  it("maps ServiceError with its code, message key and field errors", async () => {
    signIn("OWNER");
    const { action } = makeAction({
      handler: async () => {
        throw new ServiceError("CONFLICT", {
          message: "clients.errors.taxIdTaken",
          fieldErrors: { taxId: ["clients.validation.taxIdTaken"] },
        });
      },
    });
    expect(await action({ name: "k" })).toEqual({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "clients.errors.taxIdTaken",
        fieldErrors: { taxId: ["clients.validation.taxIdTaken"] },
      },
    });
  });

  it.each(["NOT_FOUND", "INTEGRITY_LOCK", "ACCESS_KEY_INVALID", "ACCESS_KEY_LOCKED"] as const)(
    "maps %s",
    async (code) => {
      signIn("OWNER");
      const { action } = makeAction({
        handler: async () => {
          throw new ServiceError(code);
        },
      });
      expect(await action({ name: "k" })).toEqual({
        ok: false,
        error: { code, message: `common.errors.${code}` },
      });
    },
  );

  it("a ZodError thrown inside the handler is a VALIDATION", async () => {
    signIn("OWNER");
    const { action } = makeAction({
      handler: async () => {
        schema.parse({ name: "" });
      },
    });
    expect(await action({ name: "k" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { name: ["validation.required"] } },
    });
  });

  it("anything else is an INTERNAL that leaks nothing", async () => {
    signIn("OWNER");
    const { action } = makeAction({
      handler: async () => {
        throw new Error("connection string postgres://secret@host/db refused");
      },
    });
    const result = await action({ name: "k" });
    expect(result).toEqual({
      ok: false,
      error: { code: "INTERNAL", message: "common.errors.INTERNAL" },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(console.error).toHaveBeenCalled();
  });

  it("a non-Error throw is an INTERNAL too", async () => {
    signIn("OWNER");
    const { action } = makeAction({
      handler: async () => {
        throw "boom";
      },
    });
    expect(await action({ name: "k" })).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
  });

  it("lets Next.js control-flow errors (redirect, notFound) through", async () => {
    signIn("OWNER");
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/x;307",
    });
    const { action } = makeAction({
      handler: async () => {
        throw redirect;
      },
    });
    await expect(action({ name: "k" })).rejects.toBe(redirect);
  });
});

describe("toActionError", () => {
  it("rethrows dynamic-rendering signals", () => {
    const error = Object.assign(new Error("x"), { digest: "DYNAMIC_SERVER_USAGE" });
    expect(() => toActionError(error)).toThrow(error);
  });

  it("maps an UnauthenticatedError-like error by its code", () => {
    expect(
      toActionError(Object.assign(new Error("UNAUTHENTICATED"), { code: "UNAUTHENTICATED" })),
    ).toEqual({
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "common.errors.UNAUTHENTICATED" },
    });
  });

  it("ignores a code that is not an ErrorCode", () => {
    expect(toActionError(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toMatchObject({
      error: { code: "INTERNAL" },
    });
  });
});
