import { beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ api: undefined as unknown }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => cache);
vi.mock("@/lib/api/server", () => ({ getServerApi: async () => holder.api }));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import {
  changeUserRoleAction,
  inviteUserAction,
  listUsersAction,
  revokeUserInvitationAction,
} from "./actions";

const createdAt = "2026-10-01T12:00:00.000Z";

function connect(routes: RouteTable) {
  const mocked = mockApi(routes);
  holder.api = mocked.api;
  return mocked;
}

beforeEach(() => {
  cache.revalidatePath.mockReset();
});

describe("listUsersAction (HU-02: Owner list with the invitations merged on page 1)", () => {
  const user = (id: string, role = "ADMIN") => ({
    id,
    name: `User ${id}`,
    email: `${id}@wedevs.dev`,
    imageUrl: null,
    role,
    createdAt,
  });
  const invitation = { id: "uinv_1", email: "new@wedevs.dev", role: "MEMBER", createdAt };

  it("puts the invitations on top of page 1 with the INVITED status without counting them in the total", async () => {
    const { calls } = connect({
      "GET /api/v1/users": {
        body: { items: [user("u1", "OWNER")], total: 1, page: 1, pageSize: 25, pageCount: 1 },
      },
      "GET /api/v1/users/invitations": { body: { items: [invitation] } },
    });
    const result = await listUsersAction({});
    expect(result).toMatchObject({ ok: true, data: { total: 1, page: 1, pageCount: 1 } });
    const rows = result.ok ? result.data.items : [];
    expect(rows.map((row) => [row.id, row.status])).toEqual([
      ["uinv_1", "INVITED"],
      ["u1", "ACTIVE"],
    ]);
    expect(rows[0]).toMatchObject({ name: null, email: "new@wedevs.dev", role: "MEMBER" });
    expect(calls.map((call) => call.path)).toEqual(
      expect.arrayContaining(["/api/v1/users", "/api/v1/users/invitations"]),
    );
  });

  it("sends the table query (page, size, sort, q, role) to GET /users", async () => {
    const { calls } = connect({
      "GET /api/v1/users": {
        body: { items: [], total: 0, page: 2, pageSize: 50, pageCount: 1 },
      },
      "GET /api/v1/users/invitations": { body: { items: [invitation] } },
    });
    const result = await listUsersAction({
      page: 2,
      pageSize: 50,
      sort: "email:desc",
      q: "new",
      role: ["OWNER", "MEMBER"],
    });
    const call = calls.find((c) => c.path === "/api/v1/users")!;
    expect(call.search.get("page")).toBe("2");
    expect(call.search.get("pageSize")).toBe("50");
    expect(call.search.get("sort")).toBe("email:desc");
    expect(call.search.get("q")).toBe("new");
    expect(call.search.getAll("role")).toEqual(["OWNER", "MEMBER"]);
    // Invitations only go on page 1.
    expect(result.ok && result.data.items).toEqual([]);
    expect(result.ok && result.data.total).toBe(0);
  });

  it("filters the invitations by role and text, and skips them when only ACTIVE is asked", async () => {
    connect({
      "GET /api/v1/users": {
        body: { items: [], total: 0, page: 1, pageSize: 25, pageCount: 1 },
      },
      "GET /api/v1/users/invitations": { body: { items: [invitation] } },
    });
    const byRole = await listUsersAction({ role: ["ADMIN"] });
    expect(byRole.ok && byRole.data.items).toEqual([]);
    const byText = await listUsersAction({ q: "NEW@" });
    expect(byText.ok && byText.data.items.map((row) => row.id)).toEqual(["uinv_1"]);
    const active = await listUsersAction({ status: ["ACTIVE"] });
    expect(active.ok && active.data.items).toEqual([]);
  });

  it("lists only the invitations (no GET /users) when only INVITED is asked", async () => {
    const { calls } = connect({
      "GET /api/v1/users/invitations": { body: { items: [invitation] } },
    });
    const result = await listUsersAction({ status: ["INVITED"] });
    expect(result).toMatchObject({ ok: true, data: { total: 1 } });
    expect(calls.map((call) => call.path)).toEqual(["/api/v1/users/invitations"]);
  });

  it("maps FORBIDDEN for a non-Owner", async () => {
    connect({
      "GET /api/v1/users": errorEnvelope("FORBIDDEN"),
      "GET /api/v1/users/invitations": errorEnvelope("FORBIDDEN"),
    });
    expect(await listUsersAction({})).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});

describe("inviteUserAction", () => {
  it("POSTs the e-mail and role, then revalidates the page", async () => {
    const { calls } = connect({
      "POST /api/v1/users/invitations": {
        status: 201,
        body: { id: "uinv_9", email: "a@b.co", role: "MEMBER", createdAt },
      },
    });
    const result = await inviteUserAction({ email: "a@b.co", role: "MEMBER" });
    expect(result).toMatchObject({ ok: true, data: { id: "uinv_9" } });
    expect(calls[0]?.body).toEqual({ email: "a@b.co", role: "MEMBER" });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/settings/users");
  });

  it("shows a taken e-mail as CONFLICT on the email field", async () => {
    connect({
      "POST /api/v1/users/invitations": errorEnvelope("CONFLICT", {
        fieldErrors: { email: ["settings.users.errors.emailTaken"] },
      }),
    });
    const result = await inviteUserAction({ email: "a@b.co", role: "ADMIN" });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", fieldErrors: { email: ["settings.users.errors.emailTaken"] } },
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("changeUserRoleAction", () => {
  it("PATCHes the role of the user", async () => {
    const { calls } = connect({
      "PATCH /api/v1/users/{id}": { body: { id: "u1", role: "VIEWER" } },
    });
    const result = await changeUserRoleAction({ userId: "u1", role: "VIEWER" });
    expect(result).toMatchObject({ ok: true });
    expect(calls[0]).toMatchObject({ method: "PATCH", path: "/api/v1/users/u1" });
    expect(calls[0]?.body).toEqual({ role: "VIEWER" });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/settings/users");
  });

  it("surfaces the last-Owner INTEGRITY_LOCK and changes nothing", async () => {
    connect({
      "PATCH /api/v1/users/{id}": errorEnvelope("INTEGRITY_LOCK", {
        message: "settings.users.errors.lastOwner",
      }),
    });
    expect(await changeUserRoleAction({ userId: "u1", role: "ADMIN" })).toMatchObject({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "settings.users.errors.lastOwner" },
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps FORBIDDEN for a Member without revalidating", async () => {
    connect({ "PATCH /api/v1/users/{id}": errorEnvelope("FORBIDDEN") });
    expect(await changeUserRoleAction({ userId: "u1", role: "ADMIN" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("revokeUserInvitationAction", () => {
  it("POSTs to the revoke route of the invitation", async () => {
    const { calls } = connect({
      "POST /api/v1/users/invitations/{id}/revoke": { body: { invitationId: "uinv_1" } },
    });
    const result = await revokeUserInvitationAction({ invitationId: "uinv_1" });
    expect(result).toEqual({ ok: true, data: { invitationId: "uinv_1" } });
    expect(calls[0]?.path).toBe("/api/v1/users/invitations/uinv_1/revoke");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/settings/users");
  });
});
