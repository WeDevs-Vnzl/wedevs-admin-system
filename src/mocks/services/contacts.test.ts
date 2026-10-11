// MOCK — tests for the contacts service (HU-04).
import { describe, expect, it } from "vitest";
import { ServiceError } from "@/server/errors";
import {
  contactFilterSchema,
  createContactInputSchema,
  updateContactInputSchema,
} from "@/lib/validators/contacts";
import { FIXED_NOW, makeTestContext } from "../test-helpers";
import {
  archiveContact,
  createContact,
  listContacts,
  searchContacts,
  setPrimaryContact,
  updateContact,
} from "./contacts";

const KAIROS = "cli_kairos";

function contactInput(clientId: string, overrides: Record<string, unknown> = {}) {
  return createContactInputSchema.parse({
    clientId,
    fullName: "Lucía Paredes",
    email: "lucia@example.com",
    ...overrides,
  });
}

function filter(clientId: string, extra: Record<string, unknown> = {}) {
  return contactFilterSchema.parse({ clientId, pageSize: 100, ...extra });
}

async function rejection(promise: Promise<unknown>): Promise<ServiceError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ServiceError) return error;
    throw error;
  }
  throw new Error("expected a ServiceError");
}

const primaries = (db: ReturnType<typeof makeTestContext>["db"], clientId: string) =>
  db.contacts.filter((c) => c.clientId === clientId && c.isPrimary && !c.archivedAt);

describe("createContact", () => {
  it("creates the contact on a live client and logs CREATE on CONTACT", async () => {
    const { ctx, db } = makeTestContext();
    const created = await createContact(ctx, contactInput(KAIROS, { position: "Compras" }));
    expect(created).toMatchObject({
      clientId: KAIROS,
      fullName: "Lucía Paredes",
      position: "Compras",
      phone: null,
      isPrimary: false,
      archivedAt: null,
      createdAt: FIXED_NOW.toISOString(),
    });
    expect(db.activity.at(-1)).toMatchObject({
      action: "CREATE",
      entityType: "CONTACT",
      entityId: created.id,
      entityLabel: "Lucía Paredes",
      actorId: ctx.user.id,
    });
  });

  it("a new primary contact demotes the previous one, which is logged (HU-04 CA2)", async () => {
    const { ctx, db } = makeTestContext();
    const before = primaries(db, KAIROS);
    expect(before.length).toBeLessThanOrEqual(1);
    const created = await createContact(ctx, contactInput(KAIROS, { isPrimary: true }));
    expect(primaries(db, KAIROS).map((c) => c.id)).toEqual([created.id]);
    if (before[0]) {
      expect(
        db.activity.some(
          (e) =>
            e.entityId === before[0]!.id &&
            e.action === "UPDATE" &&
            e.createdAt === FIXED_NOW.toISOString(),
        ),
      ).toBe(true);
    }
  });

  it("answers NOT_FOUND on an unknown or archived client and VALIDATION on an unknown tag", async () => {
    const { ctx } = makeTestContext();
    expect((await rejection(createContact(ctx, contactInput("cli_nope")))).code).toBe("NOT_FOUND");
    expect((await rejection(createContact(ctx, contactInput("cli_veredas_digital")))).code).toBe(
      "NOT_FOUND",
    );
    expect(
      (await rejection(createContact(ctx, contactInput(KAIROS, { tagIds: ["tag_nope"] })))).code,
    ).toBe("VALIDATION");
  });
});

describe("updateContact", () => {
  it("applies the change and logs the UPDATE diff", async () => {
    const { ctx, db } = makeTestContext();
    const created = await createContact(ctx, contactInput(KAIROS));
    const updated = await updateContact(
      ctx,
      updateContactInputSchema.parse({
        id: created.id,
        fullName: "Lucía Paredes",
        email: "lucia@example.com",
        phone: "+584121112233",
        position: "Dirección",
      }),
    );
    expect(updated).toMatchObject({ phone: "+584121112233", position: "Dirección" });
    expect(db.activity.at(-1)?.changes).toEqual({
      position: [null, "Dirección"],
      phone: [null, "+584121112233"],
    });
  });

  it("setting isPrimary through update keeps a single primary", async () => {
    const { ctx, db } = makeTestContext();
    const first = await createContact(ctx, contactInput(KAIROS, { isPrimary: true }));
    const second = await createContact(ctx, contactInput(KAIROS, { fullName: "Otro Contacto" }));
    await updateContact(
      ctx,
      updateContactInputSchema.parse({
        id: second.id,
        fullName: "Otro Contacto",
        email: "lucia@example.com",
        isPrimary: true,
      }),
    );
    expect(primaries(db, KAIROS).map((c) => c.id)).toEqual([second.id]);
    expect(db.contacts.find((c) => c.id === first.id)?.isPrimary).toBe(false);
  });

  it("answers NOT_FOUND for an archived contact", async () => {
    const { ctx } = makeTestContext();
    const created = await createContact(ctx, contactInput(KAIROS));
    await archiveContact(ctx, { id: created.id });
    expect(
      (
        await rejection(
          updateContact(
            ctx,
            updateContactInputSchema.parse({
              id: created.id,
              fullName: "X Y",
              email: "x@example.com",
            }),
          ),
        )
      ).code,
    ).toBe("NOT_FOUND");
  });
});

describe("setPrimaryContact", () => {
  it("unsets the previous primary so a client has at most one (HU-04 CA2)", async () => {
    const { ctx, db } = makeTestContext();
    const a = await createContact(ctx, contactInput(KAIROS, { isPrimary: true }));
    const b = await createContact(ctx, contactInput(KAIROS, { fullName: "Segundo Contacto" }));
    const result = await setPrimaryContact(ctx, { id: b.id });
    expect(result.isPrimary).toBe(true);
    expect(primaries(db, KAIROS).map((c) => c.id)).toEqual([b.id]);
    expect(db.contacts.find((c) => c.id === a.id)?.isPrimary).toBe(false);
    const updates = db.activity.filter((e) => e.action === "UPDATE" && e.entityType === "CONTACT");
    expect(updates.at(-1)).toMatchObject({ entityId: b.id, changes: { isPrimary: [false, true] } });
    expect(updates.at(-2)).toMatchObject({ entityId: a.id, changes: { isPrimary: [true, false] } });
  });

  it("is a no-op for the current primary", async () => {
    const { ctx, db } = makeTestContext();
    const a = await createContact(ctx, contactInput(KAIROS, { isPrimary: true }));
    const count = db.activity.length;
    await setPrimaryContact(ctx, { id: a.id });
    expect(db.activity).toHaveLength(count);
  });
});

describe("archiveContact", () => {
  it("soft-deletes, releases the primary flag and logs DELETE", async () => {
    const { ctx, db } = makeTestContext();
    const a = await createContact(ctx, contactInput(KAIROS, { isPrimary: true }));
    const result = await archiveContact(ctx, { id: a.id });
    expect(result).toEqual({ id: a.id, archivedAt: FIXED_NOW.toISOString() });
    expect(db.contacts.find((c) => c.id === a.id)).toMatchObject({ isPrimary: false });
    expect(db.activity.at(-1)).toMatchObject({
      action: "DELETE",
      entityType: "CONTACT",
      entityId: a.id,
    });
    expect((await rejection(archiveContact(ctx, { id: a.id }))).code).toBe("NOT_FOUND");
  });
});

describe("listContacts", () => {
  it("lists the live contacts of the client, primary first", async () => {
    const { ctx, db } = makeTestContext();
    const withMany = db.clients.find(
      (client) => db.contacts.filter((c) => c.clientId === client.id && !c.archivedAt).length >= 3,
    )!;
    await setPrimaryContact(ctx, {
      id: db.contacts.filter((c) => c.clientId === withMany.id && !c.archivedAt).at(-1)!.id,
    });
    const page = await listContacts(ctx, filter(withMany.id));
    expect(page.total).toBe(
      db.contacts.filter((c) => c.clientId === withMany.id && !c.archivedAt).length,
    );
    expect(page.items[0]?.isPrimary).toBe(true);
    expect(page.items.every((c) => c.clientId === withMany.id)).toBe(true);
  });

  it("searches, sorts and returns an empty page for a client without contacts", async () => {
    const { ctx } = makeTestContext();
    expect((await listContacts(ctx, filter("cli_zafiro_labs"))).total).toBe(0);
    const created = await createContact(ctx, contactInput(KAIROS, { fullName: "Zoila Quintero" }));
    const found = await listContacts(ctx, filter(KAIROS, { q: "quintero" }));
    expect(found.items.map((c) => c.id)).toEqual([created.id]);
    const sorted = await listContacts(ctx, filter(KAIROS, { sort: "fullName:desc" }));
    expect(sorted.items[0]?.fullName).toBe("Zoila Quintero");
  });

  it("shows archived contacts only with includeArchived and the trash grant", async () => {
    const { ctx: owner, db } = makeTestContext("OWNER");
    const archivedClient = db.clients.find((c) => c.archivedAt)!;
    const archivedContacts = db.contacts.filter((c) => c.clientId === archivedClient.id);
    expect(archivedContacts.length).toBeGreaterThan(0);
    expect((await listContacts(owner, filter(archivedClient.id))).total).toBe(0);
    expect(
      (await listContacts(owner, filter(archivedClient.id, { includeArchived: true }))).total,
    ).toBe(archivedContacts.length);
    const { ctx: member } = makeTestContext("MEMBER");
    expect(
      (await listContacts(member, filter(archivedClient.id, { includeArchived: true }))).total,
    ).toBe(0);
  });

  it("answers NOT_FOUND for an unknown client", async () => {
    const { ctx } = makeTestContext();
    expect((await rejection(listContacts(ctx, filter("cli_nope")))).code).toBe("NOT_FOUND");
  });
});

describe("searchContacts", () => {
  it("returns EntityRefs of live contacts of live clients, optionally of one client", async () => {
    const { ctx, db } = makeTestContext();
    const all = await searchContacts(ctx, {});
    expect(all.length).toBeGreaterThan(0);
    expect(all.length).toBeLessThanOrEqual(20);
    expect(all.every((ref) => ref.type === "CONTACT")).toBe(true);
    const archivedClient = db.clients.find((c) => c.archivedAt)!;
    const archivedIds = new Set(
      db.contacts.filter((c) => c.clientId === archivedClient.id).map((c) => c.id),
    );
    expect(all.some((ref) => archivedIds.has(ref.id))).toBe(false);

    const created = await createContact(ctx, contactInput(KAIROS, { fullName: "Zoila Quintero" }));
    expect(await searchContacts(ctx, { q: "quintero", clientId: KAIROS })).toEqual([
      { id: created.id, label: "Zoila Quintero", type: "CONTACT" },
    ]);
    expect(await searchContacts(ctx, { q: "quintero", clientId: "cli_zafiro_labs" })).toEqual([]);
  });
});
