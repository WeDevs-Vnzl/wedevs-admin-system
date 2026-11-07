import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api/server", () => server);
vi.mock("next/cache", () => cache);

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import type { ContactViewDto } from "@/lib/api/types/clients";
import type { ActionResult, EntityRef } from "@/lib/validators/common";
import {
  archiveContactAction,
  createContactAction,
  searchContactsAction,
  setPrimaryContactAction,
  updateContactAction,
} from "./actions";
import { listContacts } from "./queries";

const validContact = {
  clientId: "cli_kairos",
  fullName: "Lucía Paredes",
  email: "lucia@example.com",
};

const contact: ContactViewDto = {
  id: "con_lucia",
  clientId: "cli_kairos",
  fullName: "Lucía Paredes",
  position: null,
  email: "lucia@example.com",
  phone: null,
  isPrimary: false,
  tags: [],
  createdAt: "2026-11-01T12:00:00.000Z",
  updatedAt: "2026-11-01T12:00:00.000Z",
  archivedAt: null,
};

function useApi(routes: RouteTable) {
  const mocked = mockApi(routes);
  server.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

beforeEach(() => {
  server.getServerApi.mockReset();
  cache.revalidatePath.mockClear();
});

describe("contact actions", () => {
  it("creates under the client path without a client id in the body, and revalidates /clients", async () => {
    const { calls } = useApi({
      "POST /api/v1/clients/{id}/contacts": { status: 201, body: contact },
    });

    expect(await createContactAction(validContact)).toMatchObject({
      ok: true,
      data: { fullName: "Lucía Paredes", isPrimary: false },
    });
    expect(calls[0]?.path).toBe("/api/v1/clients/cli_kairos/contacts");
    expect(calls[0]?.body).toEqual({
      fullName: "Lucía Paredes",
      email: "lucia@example.com",
      isPrimary: false,
      tagIds: [],
    });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/clients", "layout");
  });

  it("updates by id, sets the primary contact and archives it", async () => {
    const { calls } = useApi({
      "PATCH /api/v1/contacts/{id}": { body: { ...contact, fullName: "Lucía P." } },
      "POST /api/v1/contacts/{id}/primary": { body: { ...contact, isPrimary: true } },
      "POST /api/v1/contacts/{id}/archive": {
        body: { id: "con_lucia", archivedAt: "2026-11-06T12:00:00.000Z" },
      },
    });
    const id = "con_lucia";

    expect(
      await updateContactAction({
        id,
        fullName: "Lucía P.",
        email: "lucia@example.com",
        // The edit form also carries the client id; it must not reach the body.
        ...({ clientId: "cli_kairos" } as object),
      }),
    ).toMatchObject({ ok: true, data: { fullName: "Lucía P." } });
    expect(calls[0]?.path).toBe("/api/v1/contacts/con_lucia");
    expect(calls[0]?.body).not.toHaveProperty("clientId");
    expect(calls[0]?.body).not.toHaveProperty("id");

    expect(await setPrimaryContactAction({ id })).toMatchObject({
      ok: true,
      data: { isPrimary: true },
    });
    expect(await archiveContactAction({ id })).toMatchObject({ ok: true, data: { id } });
    expect(calls.map((call) => call.path)).toEqual([
      "/api/v1/contacts/con_lucia",
      "/api/v1/contacts/con_lucia/primary",
      "/api/v1/contacts/con_lucia/archive",
    ]);
  });

  it("surfaces the BE refusal of every mutation for a role without the grant", async () => {
    useApi({
      "POST /api/v1/clients/{id}/contacts": errorEnvelope("FORBIDDEN"),
      "PATCH /api/v1/contacts/{id}": errorEnvelope("FORBIDDEN"),
      "POST /api/v1/contacts/{id}/primary": errorEnvelope("FORBIDDEN"),
      "POST /api/v1/contacts/{id}/archive": errorEnvelope("FORBIDDEN"),
    });
    for (const result of [
      await createContactAction(validContact),
      await updateContactAction({ id: "con_lucia", fullName: "Otro", email: "a@example.com" }),
      await setPrimaryContactAction({ id: "con_lucia" }),
      await archiveContactAction({ id: "con_lucia" }),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    }
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps VALIDATION field errors and NOT_FOUND for an unknown client", async () => {
    useApi({
      "POST /api/v1/clients/{id}/contacts": (call) =>
        call.path.includes("cli_nope")
          ? errorEnvelope("NOT_FOUND")
          : errorEnvelope("VALIDATION", {
              fieldErrors: { email: ["validation.required"], phone: ["validation.required"] },
            }),
    });

    const invalid = await createContactAction({ clientId: "cli_kairos", fullName: "Sin Medio" });
    expect(invalid).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    if (!invalid.ok) expect(invalid.error.fieldErrors).toHaveProperty("email");
    expect(await createContactAction({ ...validContact, clientId: "cli_nope" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
});

describe("searchContactsAction", () => {
  it("returns EntityRefs (null code → undefined) and passes the client scope", async () => {
    const { calls } = useApi({
      "GET /api/v1/contacts/search": {
        body: [{ type: "CONTACT", id: "con_lucia", code: null, label: "Lucía Paredes" }],
      },
    });

    expect(await searchContactsAction({ q: "lu", clientId: "cli_kairos" })).toEqual({
      ok: true,
      data: [{ type: "CONTACT", id: "con_lucia", code: undefined, label: "Lucía Paredes" }],
    });
    expect(calls[0]?.search.get("q")).toBe("lu");
    expect(calls[0]?.search.get("clientId")).toBe("cli_kairos");
    expect(calls[0]?.search.get("limit")).toBe("20");
  });

  it("maps the error envelope", async () => {
    useApi({ "GET /api/v1/contacts/search": errorEnvelope("UNAUTHENTICATED") });
    expect(await searchContactsAction({})).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });

  // Frozen for W3/W4 (DT-218): the typeahead keeps its input and result types.
  it("keeps its frozen signature", () => {
    expectTypeOf(searchContactsAction)
      .parameter(0)
      .toEqualTypeOf<{ q?: string | undefined; clientId?: string | undefined }>();
    expectTypeOf(searchContactsAction).returns.toEqualTypeOf<Promise<ActionResult<EntityRef[]>>>();
  });
});

describe("listContacts", () => {
  it("lists the contacts of a client through GET /clients/{id}/contacts", async () => {
    const { calls } = useApi({
      "GET /api/v1/clients/{id}/contacts": {
        body: { items: [contact], total: 1, page: 1, pageSize: 100, pageCount: 1 },
      },
    });

    const page = await listContacts({ clientId: "cli_kairos", pageSize: 100 });
    expect(page.items.every((row) => row.clientId === "cli_kairos")).toBe(true);
    expect(calls[0]?.path).toBe("/api/v1/clients/cli_kairos/contacts");
    expect(calls[0]?.search.get("pageSize")).toBe("100");
    expect(calls[0]?.search.get("archived")).toBe("exclude");
  });

  it("requires the clientId", async () => {
    await expect(listContacts({} as never)).rejects.toBeDefined();
  });
});
