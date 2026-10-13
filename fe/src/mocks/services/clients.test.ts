// MOCK — tests for the clients service (HU-03, C15, C16, C19).
import { describe, expect, it } from "vitest";
import { ServiceError } from "@/server/errors";
import {
  clientFilterSchema,
  createClientInputSchema,
  updateClientInputSchema,
  type ClientFilterInput,
} from "@/lib/validators/clients";
import type { InvoiceDetailDTO } from "@/lib/validators/invoices";
import type { PaymentDetailDTO } from "@/lib/validators/payments";
import { makeTestContext, FIXED_NOW } from "../test-helpers";
import { makeAllocation, makeInvoice, makePayment, ref, STAMP } from "../finance-test-factories";
import { deriveMockStore } from "../store";
import {
  archiveClient,
  archiveClients,
  createClient,
  getClient,
  getClientFinancials,
  getClientsOverview,
  listClients,
  restoreClient,
  searchClients,
  setClientStatus,
  updateClient,
} from "./clients";
import { archiveContact } from "./contacts";

const KAIROS = "cli_kairos";

function clientInput(overrides: Record<string, unknown> = {}) {
  return createClientInputSchema.parse({
    kind: "EMPRESA",
    tradeName: "Nube Austral",
    legalName: "Nube Austral C.A.",
    taxId: "J-40111222-3",
    country: "VE",
    address: "Av. Principal, Caracas",
    phone: "+584121234567",
    ...overrides,
  });
}

function filter(input: ClientFilterInput = {}) {
  return clientFilterSchema.parse({ pageSize: 100, ...input });
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

/** A live client with contacts and neither active projects nor invoices: archives without confirmation. */
function clientWithContactsOnly(db: ReturnType<typeof makeTestContext>["db"]) {
  return db.clients.find(
    (client) =>
      !client.archivedAt &&
      db.contacts.filter((c) => c.clientId === client.id && !c.archivedAt).length >= 2 &&
      !db.projects.some((p) => p.clients.some((l) => l.clientId === client.id)),
  );
}

describe("createClient", () => {
  it("allocates the next CLI code, defaults to PROSPECTO and logs CREATE", async () => {
    const { ctx, db } = makeTestContext();
    const last = db.sequences.CLI;
    const created = await createClient(ctx, clientInput());
    expect(created.code).toBe(`CLI-${String(last + 1).padStart(4, "0")}`);
    expect(created).toMatchObject({
      status: "PROSPECTO",
      activatedAt: null,
      archivedAt: null,
      tradeName: "Nube Austral",
      contacts: [],
    });
    expect(created.financials).toMatchObject({ totalInvoicedUsd: "0.00", projectCount: 0 });
    const second = await createClient(ctx, clientInput({ taxId: "J-40111222-4" }));
    expect(second.code).toBe(`CLI-${String(last + 2).padStart(4, "0")}`);

    const entry = db.activity.at(-2);
    expect(entry).toMatchObject({
      actorType: "USER",
      actorId: ctx.user.id,
      action: "CREATE",
      entityType: "CLIENT",
      entityId: created.id,
      entityLabel: "Nube Austral",
      createdAt: FIXED_NOW.toISOString(),
    });
  });

  it("stores a PERSONA's legal name as the trade name and the canonical RIF", async () => {
    const { ctx } = makeTestContext();
    const created = await createClient(
      ctx,
      clientInput({ kind: "PERSONA", legalName: undefined, taxId: "v123456789" }),
    );
    expect(created).toMatchObject({ legalName: "Nube Austral", taxId: "V-12345678-9" });
  });

  it("sets activatedAt when created as ACTIVO", async () => {
    const { ctx } = makeTestContext();
    const created = await createClient(ctx, clientInput({ status: "ACTIVO" }));
    expect(created.activatedAt).toBe(FIXED_NOW.toISOString());
  });

  it("answers CONFLICT linking the holder when a live client has the same tax id and country", async () => {
    const { ctx, db } = makeTestContext();
    const before = db.clients.length;
    const sequence = db.sequences.CLI;
    const error = await rejection(
      createClient(ctx, clientInput({ taxId: "j301234567", country: "VE" })),
    );
    expect(error.code).toBe("CONFLICT");
    expect(error.message).toBe("clients.errors.duplicateTaxId");
    expect(error.entity).toMatchObject({ id: KAIROS, type: "CLIENT", label: "Kairos Studio" });
    expect(error.entity?.code).toMatch(/^CLI-\d{4}$/);
    expect(db.clients).toHaveLength(before);
    expect(db.sequences.CLI).toBe(sequence);
  });

  it("allows the same tax id in another country and after the holder is archived", async () => {
    const { ctx } = makeTestContext();
    const abroad = await createClient(ctx, clientInput({ taxId: "J-30123456-7", country: "CO" }));
    expect(abroad.country).toBe("CO");
    // Zafiro Labs has no dependents: archive it, then its tax id is free again.
    const zafiro = await getClient(ctx, { id: "cli_zafiro_labs" });
    await archiveClient(ctx, { id: zafiro.id, confirm: false });
    const reused = await createClient(
      ctx,
      clientInput({ taxId: zafiro.taxId, country: zafiro.country }),
    );
    expect(reused.id).not.toBe(zafiro.id);
  });

  it("rejects an unknown tag id with VALIDATION", async () => {
    const { ctx } = makeTestContext();
    const error = await rejection(createClient(ctx, clientInput({ tagIds: ["tag_nope"] })));
    expect(error.code).toBe("VALIDATION");
    expect(error.fieldErrors).toHaveProperty("tagIds");
  });
});

describe("updateClient", () => {
  function updateInput(id: string, overrides: Record<string, unknown> = {}) {
    return updateClientInputSchema.parse({
      id,
      kind: "EMPRESA",
      tradeName: "Nube Austral",
      legalName: "Nube Austral C.A.",
      taxId: "J-40111222-3",
      country: "VE",
      address: "Av. Principal, Caracas",
      phone: "+584121234567",
      ...overrides,
    });
  }

  it("applies the change and logs an UPDATE with the field diff (long text as 'changed')", async () => {
    const { ctx, db } = makeTestContext();
    const created = await createClient(ctx, clientInput());
    const updated = await updateClient(
      ctx,
      updateInput(created.id, {
        tradeName: "Nube Austral Pro",
        address: "Otra dirección",
        email: "hola@nube.example.com",
      }),
    );
    expect(updated.tradeName).toBe("Nube Austral Pro");
    const entry = db.activity.at(-1);
    expect(entry).toMatchObject({
      action: "UPDATE",
      entityId: created.id,
      entityLabel: "Nube Austral Pro",
    });
    expect(entry?.changes).toEqual({
      tradeName: ["Nube Austral", "Nube Austral Pro"],
      address: "changed",
      email: [null, "hola@nube.example.com"],
    });
  });

  it("does not log anything when nothing changed", async () => {
    const { ctx, db } = makeTestContext();
    const created = await createClient(ctx, clientInput());
    const count = db.activity.length;
    await updateClient(ctx, updateInput(created.id));
    expect(db.activity).toHaveLength(count);
  });

  it("answers CONFLICT with the holder when the new tax id belongs to another live client", async () => {
    const { ctx } = makeTestContext();
    const created = await createClient(ctx, clientInput());
    const error = await rejection(
      updateClient(ctx, updateInput(created.id, { taxId: "J-30123456-7" })),
    );
    expect(error).toMatchObject({ code: "CONFLICT", entity: { id: KAIROS } });
  });

  it("lets a client keep its own tax id", async () => {
    const { ctx } = makeTestContext();
    const kairos = await getClient(ctx, { id: KAIROS });
    const updated = await updateClient(
      ctx,
      updateInput(KAIROS, {
        kind: kairos.kind,
        tradeName: kairos.tradeName,
        legalName: kairos.legalName,
        taxId: kairos.taxId,
        country: kairos.country,
        address: kairos.address,
        phone: kairos.phone,
        website: "https://kairos.example.com",
      }),
    );
    expect(updated.website).toBe("https://kairos.example.com");
  });

  it("answers NOT_FOUND for an unknown or archived client", async () => {
    const { ctx } = makeTestContext();
    expect((await rejection(updateClient(ctx, updateInput("cli_nope")))).code).toBe("NOT_FOUND");
    expect((await rejection(updateClient(ctx, updateInput("cli_veredas_digital")))).code).toBe(
      "NOT_FOUND",
    );
  });
});

describe("setClientStatus", () => {
  it("logs STATUS_CHANGE and sets activatedAt only the first time it becomes ACTIVO", async () => {
    const { ctx, db } = makeTestContext();
    const created = await createClient(ctx, clientInput());
    const active = await setClientStatus(ctx, { id: created.id, status: "ACTIVO" });
    expect(active.activatedAt).toBe(FIXED_NOW.toISOString());
    expect(db.activity.at(-1)).toMatchObject({
      action: "STATUS_CHANGE",
      changes: { status: ["PROSPECTO", "ACTIVO"] },
    });

    await setClientStatus(ctx, { id: created.id, status: "INACTIVO" });
    const row = db.clients.find((c) => c.id === created.id)!;
    row.activatedAt = "2026-01-01T00:00:00.000Z";
    const again = await setClientStatus(ctx, { id: created.id, status: "ACTIVO" });
    expect(again.activatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("is a no-op without an activity entry when the status is the same", async () => {
    const { ctx, db } = makeTestContext();
    const count = db.activity.length;
    await setClientStatus(ctx, { id: KAIROS, status: "ACTIVO" });
    expect(db.activity).toHaveLength(count);
  });
});

describe("archiveClient (C19)", () => {
  it("answers INTEGRITY_LOCK with active projects and confirm: false; nothing changes", async () => {
    const { ctx, db } = makeTestContext();
    const count = db.activity.length;
    const error = await rejection(archiveClient(ctx, { id: KAIROS, confirm: false }));
    expect(error).toMatchObject({
      code: "INTEGRITY_LOCK",
      message: "clients.errors.archiveNeedsConfirm",
    });
    expect(db.clients.find((c) => c.id === KAIROS)?.archivedAt).toBeNull();
    expect(db.activity).toHaveLength(count);
  });

  it("with confirm: true archives the client and its contacts and logs DELETE entries", async () => {
    const { ctx, db } = makeTestContext();
    const live = db.contacts.filter((c) => c.clientId === KAIROS && !c.archivedAt);
    const result = await archiveClient(ctx, { id: KAIROS, confirm: true });
    expect(result).toEqual({
      id: KAIROS,
      archivedAt: FIXED_NOW.toISOString(),
      archivedContacts: live.length,
    });
    const row = db.clients.find((c) => c.id === KAIROS)!;
    expect(row).toMatchObject({ archivedAt: result.archivedAt, deletedById: ctx.user.id });
    expect(
      db.contacts.filter((c) => c.clientId === KAIROS).every((c) => c.archivedAt !== null),
    ).toBe(true);
    const deletes = db.activity.filter(
      (e) => e.action === "DELETE" && e.createdAt === result.archivedAt,
    );
    expect(deletes.filter((e) => e.entityType === "CLIENT")).toHaveLength(1);
    expect(deletes.filter((e) => e.entityType === "CONTACT")).toHaveLength(live.length);
  });

  it("archives without confirmation when there are no active projects or open invoices", async () => {
    const { ctx, db } = makeTestContext();
    const client = clientWithContactsOnly(db)!;
    expect(client).toBeDefined();
    const result = await archiveClient(ctx, { id: client.id, confirm: false });
    expect(result.archivedContacts).toBeGreaterThanOrEqual(2);
  });

  it("locks on an open invoice and ignores drafts, voided and paid ones", async () => {
    const { ctx, db } = makeTestContext();
    const client = clientWithContactsOnly(db)!;
    const clientRef = (id: string) => ref(id, "CLIENT");
    db.invoices.push(
      makeInvoice({ id: "fac_draft", client: clientRef(client.id), isDraft: true }),
      makeInvoice({ id: "fac_void", client: clientRef(client.id), voidedAt: STAMP }),
      makeInvoice({ id: "fac_paid", client: clientRef(client.id) }),
    );
    // Pays fac_paid in full (1000 at 16 % + 200 exempt = 1360).
    db.payments.push(makePayment({ id: "pag_full", amount: "1360.00", igtfAmount: "0.00" }));
    db.paymentAllocations.push(
      makeAllocation({
        id: "alo_full",
        paymentId: "pag_full",
        invoice: ref("fac_paid", "INVOICE"),
        amountPaymentCurrency: "1360.00",
        amountInvoiceCurrency: "1360.00",
        amountUsd: "1360.00",
      }),
    );
    deriveMockStore(db);
    expect(db.invoices.map((row) => row.status)).toEqual(["BORRADOR", "ANULADA", "PAGADA"]);
    await expect(archiveClient(ctx, { id: client.id, confirm: false })).resolves.toBeDefined();

    const { ctx: ctx2, db: db2 } = makeTestContext();
    const other = clientWithContactsOnly(db2)!;
    db2.invoices.push(
      makeInvoice({ id: "fac_open", client: clientRef(other.id), dueDate: "2026-10-01" }),
    );
    deriveMockStore(db2);
    expect(db2.invoices[0]!.status).toBe("VENCIDA");
    expect((await rejection(archiveClient(ctx2, { id: other.id, confirm: false }))).code).toBe(
      "INTEGRITY_LOCK",
    );
  });

  it("answers NOT_FOUND for an archived or unknown client", async () => {
    const { ctx } = makeTestContext();
    expect(
      (await rejection(archiveClient(ctx, { id: "cli_veredas_digital", confirm: true }))).code,
    ).toBe("NOT_FOUND");
    expect((await rejection(archiveClient(ctx, { id: "cli_nope", confirm: true }))).code).toBe(
      "NOT_FOUND",
    );
  });
});

describe("archiveClients", () => {
  it("archives every client of the selection, one result each", async () => {
    const { ctx, db } = makeTestContext();
    const result = await archiveClients(ctx, { ids: [KAIROS, "cli_zafiro_labs"], confirm: true });
    expect(result.archived.map((r) => r.id)).toEqual([KAIROS, "cli_zafiro_labs"]);
    expect(db.clients.find((c) => c.id === "cli_zafiro_labs")?.archivedAt).not.toBeNull();
  });

  it("is all or nothing: one locked client leaves the selection untouched", async () => {
    const { ctx, db } = makeTestContext();
    const error = await rejection(
      archiveClients(ctx, { ids: ["cli_zafiro_labs", KAIROS], confirm: false }),
    );
    expect(error.code).toBe("INTEGRITY_LOCK");
    expect(db.clients.find((c) => c.id === "cli_zafiro_labs")?.archivedAt).toBeNull();
  });
});

describe("restoreClient", () => {
  it("restores the client and exactly the contacts archived by the cascade, logging RESTORE", async () => {
    const { ctx, db } = makeTestContext();
    const client = clientWithContactsOnly(db)!;
    const contacts = db.contacts.filter((c) => c.clientId === client.id && !c.archivedAt);
    // One contact leaves on its own before the client does: it must stay archived after the restore.
    const lone = contacts[0]!;
    await archiveContact(ctx, { id: lone.id });
    ctx.now = new Date(FIXED_NOW.getTime() + 60_000);
    await archiveClient(ctx, { id: client.id, confirm: false });
    ctx.now = new Date(FIXED_NOW.getTime() + 120_000);

    const restored = await restoreClient(ctx, { id: client.id });
    expect(restored.archivedAt).toBeNull();
    expect(restored.contacts.map((c) => c.id).sort()).toEqual(
      contacts
        .slice(1)
        .map((c) => c.id)
        .sort(),
    );
    expect(db.contacts.find((c) => c.id === lone.id)?.archivedAt).not.toBeNull();
    expect(db.clients.find((c) => c.id === client.id)?.deletedById).toBeNull();
    const restoredAt = ctx.now.toISOString();
    const restores = db.activity.filter(
      (e) => e.action === "RESTORE" && e.createdAt === restoredAt,
    );
    expect(
      restores.filter((e) => e.entityType === "CLIENT" && e.entityId === client.id),
    ).toHaveLength(1);
    expect(restores.filter((e) => e.entityType === "CONTACT")).toHaveLength(contacts.length - 1);
  });

  it("restores the archived dataset client with its cascade contacts", async () => {
    const { ctx, db } = makeTestContext();
    const archived = db.clients.find((c) => c.id === "cli_veredas_digital")!;
    const cascade = db.contacts.filter(
      (c) => c.clientId === archived.id && c.archivedAt === archived.archivedAt,
    );
    const restored = await restoreClient(ctx, { id: archived.id });
    expect(restored.contacts).toHaveLength(cascade.length);
  });

  it("answers CONFLICT with the holder when a live client now has the same tax id and country", async () => {
    const { ctx } = makeTestContext();
    const zafiro = await getClient(ctx, { id: "cli_zafiro_labs" });
    await archiveClient(ctx, { id: zafiro.id, confirm: false });
    const holder = await createClient(
      ctx,
      clientInput({ taxId: zafiro.taxId, country: zafiro.country, tradeName: "Zafiro Nuevo" }),
    );
    const error = await rejection(restoreClient(ctx, { id: zafiro.id }));
    expect(error).toMatchObject({
      code: "CONFLICT",
      message: "clients.errors.restoreTaxIdConflict",
      entity: { id: holder.id, type: "CLIENT" },
    });
  });

  it("answers NOT_FOUND for a client that is not archived", async () => {
    const { ctx } = makeTestContext();
    expect((await rejection(restoreClient(ctx, { id: KAIROS }))).code).toBe("NOT_FOUND");
  });
});

describe("listClients", () => {
  it("lists live clients with paging and hides the archived one", async () => {
    const { ctx, db } = makeTestContext();
    const page = await listClients(ctx, filter({ pageSize: 25 }));
    const live = db.clients.filter((c) => !c.archivedAt);
    expect(page.total).toBe(live.length);
    expect(page.items).toHaveLength(25);
    expect(page.items.some((c) => c.archivedAt)).toBe(false);
    expect(page.items[0]).toMatchObject({
      totalInvoicedUsd: "0.00",
      receivableUsd: "0.00",
    });
  });

  it("applies status, kind, country, tag, created range and search filters", async () => {
    const { ctx, db } = makeTestContext();
    const live = db.clients.filter((c) => !c.archivedAt);
    const byStatus = await listClients(ctx, filter({ status: "PROSPECTO" }));
    expect(byStatus.total).toBe(live.filter((c) => c.status === "PROSPECTO").length);
    const multi = await listClients(
      ctx,
      filter({ status: ["PROSPECTO", "INACTIVO"], kind: "EMPRESA" }),
    );
    expect(multi.total).toBe(
      live.filter((c) => c.status !== "ACTIVO" && c.kind === "EMPRESA").length,
    );
    const ve = await listClients(ctx, filter({ country: "VE" }));
    expect(ve.total).toBe(live.filter((c) => c.country === "VE").length);

    const tagged = live.find((c) => c.tagIds.length > 0)!;
    const tag = tagged.tagIds[0]!;
    const byTag = await listClients(ctx, filter({ tagId: tag }));
    expect(byTag.total).toBe(live.filter((c) => c.tagIds.includes(tag)).length);
    expect(byTag.items.find((c) => c.id === tagged.id)?.tags.map((t) => t.id)).toContain(tag);

    const from = tagged.createdAt.slice(0, 10);
    const ranged = await listClients(ctx, filter({ createdFrom: from, createdTo: from }));
    expect(ranged.items.map((c) => c.id)).toContain(tagged.id);
    expect(ranged.total).toBeLessThan(live.length);

    const search = await listClients(ctx, filter({ q: "kairos" }));
    expect(search.items.map((c) => c.id)).toContain(KAIROS);
    const byTaxId = await listClients(ctx, filter({ q: "30123456" }));
    expect(byTaxId.items.map((c) => c.id)).toContain(KAIROS);
  });

  it("filters hasOverdue from the finance collections and sorts", async () => {
    const { ctx, db } = makeTestContext();
    expect((await listClients(ctx, filter({ hasOverdue: true }))).total).toBe(0);
    db.invoices.push({
      id: "fac_1",
      client: { id: KAIROS },
      status: "VENCIDA",
      isDraft: false,
      totals: { totalUsd: "80.00", balanceUsd: "80.00" },
    } as unknown as InvoiceDetailDTO);
    const overdue = await listClients(ctx, filter({ hasOverdue: true }));
    expect(overdue.items.map((c) => c.id)).toEqual([KAIROS]);
    const none = await listClients(ctx, filter({ hasOverdue: false }));
    expect(none.items.map((c) => c.id)).not.toContain(KAIROS);

    const byReceivable = await listClients(ctx, filter({ sort: "receivableUsd:desc" }));
    expect(byReceivable.items[0]?.id).toBe(KAIROS);
    const byName = await listClients(ctx, filter({ sort: "tradeName:asc" }));
    const names = byName.items.map((c) => c.tradeName);
    expect(names).toEqual(
      [...names].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base", numeric: true })),
    );
  });

  it("projectCount counts non-archived project rows and lastActivityAt reads the activity log", async () => {
    const { ctx, db } = makeTestContext();
    const expected = db.projects.filter(
      (p) => !p.archivedAt && p.clients.some((l) => l.clientId === KAIROS),
    ).length;
    const row = (await listClients(ctx, filter({ q: "kairos" }))).items.find(
      (c) => c.id === KAIROS,
    )!;
    expect(row.projectCount).toBe(expected);
    const latest = db.activity
      .filter((e) => e.entityType === "CLIENT" && e.entityId === KAIROS)
      .map((e) => e.createdAt)
      .sort()
      .at(-1);
    expect(row.lastActivityAt! >= (latest ?? "")).toBe(true);

    const empty = (await listClients(ctx, filter({ q: "zafiro" }))).items.find(
      (c) => c.id === "cli_zafiro_labs",
    )!;
    expect(empty.projectCount).toBe(0);
  });

  it("honours includeArchived for Owner and Admin and ignores it for Member and Viewer", async () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      const { ctx } = makeTestContext(role);
      const page = await listClients(ctx, filter({ includeArchived: true }));
      expect(page.items.some((c) => c.id === "cli_veredas_digital" && c.archivedAt)).toBe(true);
    }
    for (const role of ["MEMBER", "VIEWER"] as const) {
      const { ctx, db } = makeTestContext(role);
      const page = await listClients(ctx, filter({ includeArchived: true }));
      expect(page.items.some((c) => c.archivedAt)).toBe(false);
      expect(page.total).toBe(db.clients.filter((c) => !c.archivedAt).length);
    }
  });
});

describe("getClient", () => {
  it("returns the detail with contacts, primary first", async () => {
    const { ctx, db } = makeTestContext();
    const withPrimary = db.clients.find((client) =>
      db.contacts.some((c) => c.clientId === client.id && c.isPrimary && !c.archivedAt),
    )!;
    const detail = await getClient(ctx, { id: withPrimary.id });
    expect(detail.contacts[0]?.isPrimary).toBe(true);
    expect(detail.contacts.every((c) => !c.archivedAt)).toBe(true);
    expect(detail.financials.clientId).toBe(withPrimary.id);
  });

  it("answers NOT_FOUND for an unknown id and for an archived client when the role cannot see archived", async () => {
    const { ctx } = makeTestContext("MEMBER");
    expect((await rejection(getClient(ctx, { id: "cli_nope" }))).code).toBe("NOT_FOUND");
    expect((await rejection(getClient(ctx, { id: "cli_veredas_digital" }))).code).toBe("NOT_FOUND");
    const { ctx: owner } = makeTestContext("OWNER");
    expect((await getClient(owner, { id: "cli_veredas_digital" })).archivedAt).not.toBeNull();
  });
});

describe("USD aggregates (PD-4, C15, C16)", () => {
  it('are "0.00" while the finance collections are empty', async () => {
    const { ctx } = makeTestContext();
    expect(await getClientFinancials(ctx, { id: KAIROS })).toMatchObject({
      clientId: KAIROS,
      totalInvoicedUsd: "0.00",
      totalCollectedUsd: "0.00",
      receivableUsd: "0.00",
      overdueUsd: "0.00",
      creditBalanceUsd: "0.00",
    });
  });

  it("sum the stored snapshots of seeded invoices and payments", async () => {
    const { ctx, db } = makeTestContext();
    const invoice = (id: string, status: string, total: string, balance: string, isDraft = false) =>
      ({
        id,
        client: { id: KAIROS },
        status,
        isDraft,
        totals: { totalUsd: total, balanceUsd: balance },
      }) as unknown as InvoiceDetailDTO;
    db.invoices.push(
      invoice("fac_a", "EMITIDA", "100.10", "100.10"),
      invoice("fac_b", "VENCIDA", "50.20", "20.05"),
      invoice("fac_c", "PAGADA", "10.00", "0.00"),
      invoice("fac_d", "BORRADOR", "999.00", "999.00", true),
      invoice("fac_e", "ANULADA", "888.00", "888.00"),
      { ...invoice("fac_f", "EMITIDA", "7.00", "7.00"), client: { id: "cli_other" } } as never,
    );
    const payment = (
      id: string,
      status: string,
      amountUsd: string,
      unallocated: string,
      date: string,
    ) =>
      ({
        id,
        client: { id: KAIROS },
        status,
        amountUsd,
        unallocated,
        usdRate: "40.00",
        date,
      }) as unknown as PaymentDetailDTO;
    db.payments.push(
      payment("pag_a", "CONFIRMADO", "75.30", "20.00", "2026-09-01"),
      payment("pag_b", "CONFIRMADO", "9.99", "0.00", "2024-01-01"),
      payment("pag_c", "ANULADO", "500.00", "500.00", "2026-09-01"),
    );

    expect(await getClientFinancials(ctx, { id: KAIROS })).toMatchObject({
      totalInvoicedUsd: "160.30",
      totalCollectedUsd: "85.29",
      receivableUsd: "120.15",
      overdueUsd: "20.05",
      creditBalanceUsd: "0.50",
    });
    const detail = await getClient(ctx, { id: KAIROS });
    expect(detail.financials.receivableUsd).toBe("120.15");
    const row = (await listClients(ctx, filter({ q: "kairos" }))).items.find(
      (c) => c.id === KAIROS,
    );
    expect(row).toMatchObject({ totalInvoicedUsd: "160.30", receivableUsd: "120.15" });
  });
});

describe("getClientsOverview", () => {
  it("counts live clients by status and lists the newest; finance lists are empty without data", async () => {
    const { ctx, db } = makeTestContext();
    const live = db.clients.filter((c) => !c.archivedAt);
    const overview = await getClientsOverview(ctx, {});
    expect(overview.countByStatus).toEqual({
      PROSPECTO: live.filter((c) => c.status === "PROSPECTO").length,
      ACTIVO: live.filter((c) => c.status === "ACTIVO").length,
      INACTIVO: live.filter((c) => c.status === "INACTIVO").length,
    });
    expect(overview.topByRevenue).toEqual([]);
    expect(overview.withOverdueBalance).toEqual([]);
    expect(overview.recentlyCreated).toHaveLength(5);
    const dates = overview.recentlyCreated.map(
      (r) => db.clients.find((c) => c.id === r.id)!.createdAt,
    );
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("ranks top clients by collected revenue of the last 12 months and overdue balances", async () => {
    const { ctx, db } = makeTestContext();
    const [a, b, c] = db.clients.filter((x) => !x.archivedAt);
    const pay = (id: string, clientId: string, amountUsd: string, date: string) =>
      ({
        id,
        client: { id: clientId },
        status: "CONFIRMADO",
        amountUsd,
        unallocated: "0.00",
        usdRate: "1",
        date,
      }) as unknown as PaymentDetailDTO;
    db.payments.push(
      pay("pag_1", a!.id, "100.00", "2026-08-01"),
      pay("pag_2", b!.id, "300.00", "2026-05-01"),
      pay("pag_3", c!.id, "900.00", "2024-01-01"),
    );
    db.invoices.push({
      id: "fac_o",
      client: { id: b!.id },
      status: "VENCIDA",
      isDraft: false,
      totals: { totalUsd: "40.00", balanceUsd: "40.00" },
    } as unknown as InvoiceDetailDTO);
    const overview = await getClientsOverview(ctx, {});
    expect(overview.topByRevenue.map((r) => [r.id, r.collectedLast12MonthsUsd])).toEqual([
      [b!.id, "300.00"],
      [a!.id, "100.00"],
    ]);
    expect(overview.withOverdueBalance.map((r) => [r.id, r.overdueUsd])).toEqual([
      [b!.id, "40.00"],
    ]);
  });
});

describe("searchClients", () => {
  it("returns at most the limit of EntityRefs of live clients", async () => {
    const { ctx } = makeTestContext();
    const all = await searchClients(ctx, { limit: 20 });
    expect(all).toHaveLength(20);
    expect(all[0]).toMatchObject({ type: "CLIENT" });
    const found = await searchClients(ctx, { q: "kairos" });
    expect(found).toContainEqual(expect.objectContaining({ id: KAIROS, label: "Kairos Studio" }));
    expect((await searchClients(ctx, { q: "veredas" })).length).toBe(0);
  });
});

describe("tag diff (CR-B4, C1)", () => {
  it("logs sorted tag names joined with ', ', never ids", async () => {
    const { ctx, db } = makeTestContext();
    const created = await createClient(ctx, clientInput());
    const tags = db.tags.slice(0, 2);
    await updateClient(
      ctx,
      updateClientInputSchema.parse({
        id: created.id,
        kind: "EMPRESA",
        tradeName: created.tradeName,
        legalName: created.legalName,
        taxId: created.taxId,
        country: created.country,
        address: created.address,
        phone: created.phone,
        tagIds: tags.map((t) => t.id).reverse(),
      }),
    );
    const changes = db.activity.at(-1)!.changes as Record<string, [string, string]>;
    const expected = tags
      .map((t) => t.name)
      .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }))
      .join(", ");
    expect(changes.tagIds).toEqual(["", expected]);
    expect(JSON.stringify(changes)).not.toMatch(/tag_/);
  });
});
