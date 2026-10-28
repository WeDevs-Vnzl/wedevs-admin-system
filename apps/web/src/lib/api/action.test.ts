import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => cache);
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));

import { apiAction } from "./action";
import { errorEnvelope, mockApi } from "./testing";

type Client = { id: string; name: string };

function setup(routes: Parameters<typeof mockApi>[0]) {
  const mocked = mockApi(routes);
  return { ...mocked, getApi: async () => mocked.api };
}

describe("apiAction", () => {
  beforeEach(() => {
    cache.revalidatePath.mockReset();
    cache.updateTag.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns ok with the response data and revalidates on success", async () => {
    const { getApi, calls } = setup({
      "POST /api/v1/clients": { status: 201, body: { id: "c1", name: "Acme" } },
    });
    const action = apiAction<{ name: string }, Client>({
      getApi,
      call: (input, api) => api.POST("/api/v1/clients" as never, { body: input } as never) as never,
      revalidate: ["/clients", { path: "/clients/c1", type: "page" }, { tag: "clients" }],
    });
    const result = await action({ name: "Acme" });
    expect(result).toEqual({ ok: true, data: { id: "c1", name: "Acme" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ name: "Acme" });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/clients");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/clients/c1", "page");
    expect(cache.updateTag).toHaveBeenCalledWith("clients");
  });

  it("supports a revalidate function over input and data", async () => {
    const { getApi } = setup({ "POST /api/v1/clients/{id}/archive": { body: { id: "c9" } } });
    const action = apiAction<{ id: string }, { id: string }>({
      getApi,
      call: (input, api) => api.POST(`/api/v1/clients/${input.id}/archive` as never) as never,
      revalidate: (input, data) => [`/clients/${input.id}`, `/trash/${data.id}`],
    });
    await action({ id: "c9" });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/clients/c9");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/trash/c9");
  });

  it("maps an error envelope and does not revalidate", async () => {
    const { getApi } = setup({
      "POST /api/v1/clients": errorEnvelope("CONFLICT", {
        entity: { type: "CLIENT", id: "c1", code: "CLI-1", label: "Acme" },
      }),
    });
    const action = apiAction<object, Client>({
      getApi,
      call: (input, api) => api.POST("/api/v1/clients" as never, { body: input } as never) as never,
      revalidate: ["/clients"],
    });
    const result = await action({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CONFLICT");
      expect(result.error.entity?.id).toBe("c1");
    }
    expect(cache.revalidatePath).not.toHaveBeenCalled();
    expect(cache.updateTag).not.toHaveBeenCalled();
  });

  it("returns INTERNAL (never throws) when the call rejects", async () => {
    const { getApi } = setup({});
    const action = apiAction<object, Client>({
      getApi,
      call: (_input, api) => api.GET("/api/v1/unmapped" as never) as never,
      revalidate: ["/clients"],
    });
    const result = await action({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL");
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps the success result when revalidation throws", async () => {
    cache.revalidatePath.mockImplementation(() => {
      throw new Error("boom");
    });
    const { getApi } = setup({ "POST /api/v1/x": { body: { ok: 1 } } });
    const action = apiAction<object, unknown>({
      getApi,
      call: (_i, api) => api.POST("/api/v1/x" as never) as never,
      revalidate: ["/x"],
    });
    expect((await action({})).ok).toBe(true);
  });

  it("rethrows Next control-flow errors from the call", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/x",
    });
    const action = apiAction<object, unknown>({
      getApi: async () => setup({}).api,
      call: async () => {
        throw redirect;
      },
    });
    await expect(action({})).rejects.toBe(redirect);
  });

  it("rethrows Next control-flow errors from revalidation", async () => {
    const bail = Object.assign(new Error("x"), { digest: "DYNAMIC_SERVER_USAGE" });
    cache.revalidatePath.mockImplementation(() => {
      throw bail;
    });
    const { getApi } = setup({ "POST /api/v1/x": { body: {} } });
    const action = apiAction<object, unknown>({
      getApi,
      call: (_i, api) => api.POST("/api/v1/x" as never) as never,
      revalidate: ["/x"],
    });
    await expect(action({})).rejects.toBe(bail);
  });

  it("signals the sign-in redirect on UNAUTHENTICATED", async () => {
    const { getApi } = setup({ "POST /api/v1/x": errorEnvelope("UNAUTHENTICATED") });
    const action = apiAction<object, unknown>({
      getApi,
      call: (_i, api) => api.POST("/api/v1/x" as never) as never,
    });
    const result = await action({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { redirectTo?: string }).redirectTo).toBe("/sign-in");
  });

  it("surfaces validation.sort.invalid from a 422", async () => {
    const { getApi } = setup({
      "GET /api/v1/clients": errorEnvelope("VALIDATION", {
        fieldErrors: { sort: ["validation.sort.invalid"] },
      }),
    });
    const action = apiAction<object, unknown>({
      getApi,
      call: (_i, api) => api.GET("/api/v1/clients" as never) as never,
    });
    const result = await action({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.fieldErrors).toEqual({ sort: ["validation.sort.invalid"] });
  });
});
