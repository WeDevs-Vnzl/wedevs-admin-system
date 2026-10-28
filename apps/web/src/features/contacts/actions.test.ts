import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => cache);
vi.mock("@/mocks/session", () => session);

import type { UserRole } from "@/lib/validators/enums";
import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
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

function signInAs(role: UserRole) {
  session.getMockSessionUser.mockResolvedValue(makeSessionUser(role, { id: `usr_${role}` }));
}

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  cache.revalidatePath.mockClear();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("contact actions", () => {
  it("creates, updates, sets primary and archives for Owner/Admin and revalidates /clients", async () => {
    signInAs("ADMIN");
    const created = await createContactAction(validContact);
    expect(created).toMatchObject({
      ok: true,
      data: { fullName: "Lucía Paredes", isPrimary: false },
    });
    if (!created.ok) return;
    const id = created.data.id;
    expect(
      await updateContactAction({ id, fullName: "Lucía P.", email: "lucia@example.com" }),
    ).toMatchObject({ ok: true, data: { fullName: "Lucía P." } });
    expect(await setPrimaryContactAction({ id })).toMatchObject({
      ok: true,
      data: { isPrimary: true },
    });
    expect(await archiveContactAction({ id })).toMatchObject({ ok: true, data: { id } });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/clients", "layout");
  });

  it.each(["MEMBER", "VIEWER"] as const)(
    "refuses a %s on every mutation with FORBIDDEN",
    async (role) => {
      signInAs(role);
      const count = getMockStore().contacts.length;
      const contactId = getMockStore().contacts[0]!.id;
      for (const result of [
        await createContactAction(validContact),
        await updateContactAction({
          id: contactId,
          fullName: "Alguien Más",
          email: "a@example.com",
        }),
        await setPrimaryContactAction({ id: contactId }),
        await archiveContactAction({ id: contactId }),
      ]) {
        expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
      }
      expect(getMockStore().contacts).toHaveLength(count);
    },
  );

  it("answers VALIDATION when no contact method is given and NOT_FOUND for an unknown client", async () => {
    signInAs("OWNER");
    const result = await createContactAction({ clientId: "cli_kairos", fullName: "Sin Medio" });
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    if (!result.ok) expect(result.error.fieldErrors).toHaveProperty("email");
    expect(await createContactAction({ ...validContact, clientId: "cli_nope" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
});

describe("searchContactsAction", () => {
  it("returns EntityRefs for any role that can read contacts and honours clientId", async () => {
    signInAs("VIEWER");
    const all = await searchContactsAction({});
    expect(all.ok && all.data.length).toBeGreaterThan(0);
    const scoped = await searchContactsAction({ clientId: "cli_zafiro_labs" });
    expect(scoped).toEqual({ ok: true, data: [] });
    session.getMockSessionUser.mockResolvedValue(null);
    expect(await searchContactsAction({})).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });
});

describe("contacts queries", () => {
  it("lists the contacts of a client and requires the clientId", async () => {
    signInAs("MEMBER");
    const withContacts = getMockStore().contacts.find((c) => !c.archivedAt)!.clientId;
    const page = await listContacts({ clientId: withContacts });
    expect(page.items.every((c) => c.clientId === withContacts)).toBe(true);
    await expect(listContacts({} as never)).rejects.toBeDefined();
  });
});
