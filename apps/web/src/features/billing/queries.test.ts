import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { errorEnvelope, mockApi } from "@/lib/api/testing";

vi.mock("server-only", () => ({}));
const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api/server", () => server);
const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));
vi.mock("next/navigation", () => nav);

import { getBillingPage } from "./queries";
import type { BillingPageDTO } from "./types";

const page = {
  projectId: "prj_1",
  plan: null,
  installments: [],
  recurringCharges: [],
};

beforeEach(() => {
  nav.notFound.mockClear();
  nav.redirect.mockClear();
});

describe("getBillingPage", () => {
  it("reads the plan, installments and charges through GET /api/v1/projects/{id}/billing", async () => {
    const { api, calls } = mockApi({ "GET /api/v1/projects/{id}/billing": { body: page } });
    server.getServerApi.mockResolvedValue(api);

    await expect(getBillingPage("prj_1")).resolves.toEqual(page);
    expect(calls[0]?.path).toBe("/api/v1/projects/prj_1/billing");
  });

  it("keeps the result shape the three tables read (generated DTO assignable to BillingPageDTO)", async () => {
    const { api } = mockApi({ "GET /api/v1/projects/{id}/billing": { body: page } });
    server.getServerApi.mockResolvedValue(api);

    expectTypeOf(await getBillingPage("prj_1")).toExtend<BillingPageDTO>();
  });

  it("renders the in-shell no-permission state when the BE answers FORBIDDEN (Member, Viewer)", async () => {
    const { api } = mockApi({ "GET /api/v1/projects/{id}/billing": errorEnvelope("FORBIDDEN") });
    server.getServerApi.mockResolvedValue(api);

    await expect(getBillingPage("prj_1")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(nav.notFound).toHaveBeenCalledOnce();
  });

  it("renders not-found for an unknown project", async () => {
    const { api } = mockApi({ "GET /api/v1/projects/{id}/billing": errorEnvelope("NOT_FOUND") });
    server.getServerApi.mockResolvedValue(api);

    await expect(getBillingPage("prj_x")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("sends a signed-out caller to sign-in", async () => {
    const { api } = mockApi({
      "GET /api/v1/projects/{id}/billing": errorEnvelope("UNAUTHENTICATED"),
    });
    server.getServerApi.mockResolvedValue(api);

    await expect(getBillingPage("prj_1")).rejects.toThrow("NEXT_REDIRECT:/sign-in");
  });
});
