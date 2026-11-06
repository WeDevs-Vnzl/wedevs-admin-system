import { beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ api: undefined as unknown }));
const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => nav);
vi.mock("@/lib/api/server", () => ({ getServerApi: async () => holder.api }));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import { getUsers } from "./queries";

function connect(routes: RouteTable) {
  const mocked = mockApi(routes);
  holder.api = mocked.api;
  return mocked;
}

const createdAt = "2026-10-01T12:00:00.000Z";

beforeEach(() => vi.clearAllMocks());

describe("getUsers (first page of Settings → Usuarios)", () => {
  it("returns users and invitations merged", async () => {
    connect({
      "GET /api/v1/users": {
        body: {
          items: [
            {
              id: "u1",
              name: "Ana",
              email: "ana@wedevs.dev",
              imageUrl: null,
              role: "OWNER",
              createdAt,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 25,
          pageCount: 1,
        },
      },
      "GET /api/v1/users/invitations": {
        body: { items: [{ id: "uinv_1", email: "n@wedevs.dev", role: "ADMIN", createdAt }] },
      },
    });
    const page = await getUsers();
    expect(page.total).toBe(2);
    expect(page.items.map((row) => row.status)).toEqual(["INVITED", "ACTIVE"]);
  });

  it("renders the in-shell not-found (no permission) for a Member", async () => {
    connect({
      "GET /api/v1/users": errorEnvelope("FORBIDDEN"),
      "GET /api/v1/users/invitations": errorEnvelope("FORBIDDEN"),
    });
    await expect(getUsers()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("sends an unauthenticated caller to sign-in", async () => {
    connect({
      "GET /api/v1/users": errorEnvelope("UNAUTHENTICATED"),
      "GET /api/v1/users/invitations": errorEnvelope("UNAUTHENTICATED"),
    });
    await expect(getUsers()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
  });

  it("throws on an unexpected error so the error boundary shows it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    connect({
      "GET /api/v1/users": errorEnvelope("INTERNAL"),
      "GET /api/v1/users/invitations": errorEnvelope("INTERNAL"),
    });
    await expect(getUsers()).rejects.toThrow("common.errors.INTERNAL");
  });
});
