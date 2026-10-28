// MOCK — trash of Hito 1 (PRD §7.7, HU-28; C19). `fn(ctx, input)`, framework-free (C11). The trash is the
// union of the archived rows (`archivedAt` set) of the soft-deletable collections that carry the stamp:
// clients, contacts, projects, invoices, documents and notes. Payments, expenses, accounts, transfers and
// movements are voided or deactivated, never archived, so they never appear here. Owner/Admin only (the
// `trash` row); each type also needs `read` on its resource. There is no purge in the MVP.
//
// Restoring clears `archivedAt` / `deletedById` and nothing else, so the record comes back in the state it
// was archived in (HU-28 CA2), and logs `RESTORE`. A client brings back the contacts archived by the same
// cascade (same `archivedAt`), like `restoreClient`. `CONFLICT` when the record would collide on return: a
// client whose tax id + country a live client now holds, a contact whose client is still archived, an
// invoice whose number a live invoice reused. Replaced by `src/server/services/trash.service.ts` (C9).
import { toDateOnly } from "@/lib/dates";
import type { EntityRef, Paginated } from "@/lib/validators/common";
import type {
  RestoreFromTrashInput,
  RestoredRecordDTO,
  TrashFilter,
  TrashRowDTO,
  TrashableEntityType,
} from "@/lib/validators/trash";
import type { UserRefDTO } from "@/lib/validators/users";
import { can, type PermissionResource } from "@/server/auth/permissions";
import { ServiceError, type MockServiceContext } from "../ctx";
import { resolveEntityRef } from "../entity-refs";
import { deriveMockStore, type MockStore } from "../store";
import { logActivity, mockTx } from "./activity";
import { listRows, type ListSpec } from "./list";

const MESSAGES = {
  taxIdTaken: "trash.errors.taxIdTaken",
  clientArchived: "trash.errors.clientArchived",
  invoiceNumberTaken: "trash.errors.invoiceNumberTaken",
} as const;

type ArchivableType = Extract<
  TrashableEntityType,
  "CLIENT" | "CONTACT" | "PROJECT" | "INVOICE" | "DOCUMENT" | "NOTE"
>;

/** The stamp every archivable row carries; `deletedById` is missing on contacts and invoices. */
interface Archivable {
  id: string;
  archivedAt: string | null;
  updatedAt: string;
  deletedById?: string | null;
}

const RESOURCE: Record<ArchivableType, PermissionResource> = {
  CLIENT: "client",
  CONTACT: "contact",
  PROJECT: "project",
  INVOICE: "invoice",
  DOCUMENT: "document",
  NOTE: "note",
};

function collection(db: MockStore, type: ArchivableType): Archivable[] {
  switch (type) {
    case "CLIENT":
      return db.clients;
    case "CONTACT":
      return db.contacts;
    case "PROJECT":
      return db.projects;
    case "INVOICE":
      return db.invoices;
    case "DOCUMENT":
      return db.documents;
    case "NOTE":
      return db.notes;
  }
}

function isArchivable(type: TrashableEntityType): type is ArchivableType {
  return type in RESOURCE;
}

/** Context under the label: the client of a contact or invoice, the clients of a project, a document's type. */
function contextOf(db: MockStore, type: ArchivableType, id: string): string | null {
  switch (type) {
    case "CONTACT": {
      const clientId = db.contacts.find((row) => row.id === id)?.clientId;
      return db.clients.find((row) => row.id === clientId)?.tradeName ?? null;
    }
    case "PROJECT": {
      const names = (db.projects.find((row) => row.id === id)?.clients ?? []).map(
        (link) => db.clients.find((row) => row.id === link.clientId)?.tradeName,
      );
      return names.filter(Boolean).join(", ") || null;
    }
    case "INVOICE":
      return db.invoices.find((row) => row.id === id)?.client.label ?? null;
    case "DOCUMENT": {
      const typeId = db.documents.find((row) => row.id === id)?.typeId;
      return db.documentTypes.find((row) => row.id === typeId)?.name ?? null;
    }
    default:
      return null;
  }
}

/** Who archived it: the stored `deletedById`, else the actor of the latest `DELETE` entry of the record. */
function archiverOf(db: MockStore, type: ArchivableType, row: Archivable): UserRefDTO | null {
  let userId = row.deletedById ?? null;
  if (!userId) {
    const entry = db.activity.findLast(
      (item) => item.action === "DELETE" && item.entityType === type && item.entityId === row.id,
    );
    userId = entry?.actorType === "USER" ? entry.actorId : null;
  }
  const user = userId ? db.users.find((item) => item.id === userId) : undefined;
  return user ? { id: user.id, name: user.name, imageUrl: user.imageUrl } : null;
}

function trashRef(ref: EntityRef, type: ArchivableType): TrashRowDTO["entity"] {
  return { ...ref, type };
}

const trashSpec: ListSpec<TrashRowDTO> = {
  searchText: (row) => [row.entity.label, row.entity.code, row.context],
  sorters: {
    deletedAt: (row) => row.deletedAt,
    entityType: (row) => row.entity.type,
    label: (row) => row.entity.label,
  },
  defaultSort: "deletedAt:desc",
};

export async function listTrash(
  ctx: MockServiceContext,
  input: TrashFilter,
): Promise<Paginated<TrashRowDTO>> {
  if (!can(ctx.user, "read", "trash")) throw new ServiceError("FORBIDDEN");
  const { db } = ctx;
  const rows: TrashRowDTO[] = [];
  for (const type of Object.keys(RESOURCE) as ArchivableType[]) {
    if (!can(ctx.user, "read", RESOURCE[type])) continue;
    if (input.entityType && !input.entityType.includes(type)) continue;
    for (const row of collection(db, type)) {
      if (!row.archivedAt) continue;
      const ref = resolveEntityRef(db, type, row.id);
      if (!ref) continue;
      const day = toDateOnly(new Date(row.archivedAt));
      if (input.deletedFrom && day < input.deletedFrom) continue;
      if (input.deletedTo && day > input.deletedTo) continue;
      const deletedBy = archiverOf(db, type, row);
      if (input.deletedById && !input.deletedById.includes(deletedBy?.id ?? "")) continue;
      rows.push({
        entity: trashRef(ref, type),
        context: contextOf(db, type, row.id),
        deletedAt: row.archivedAt,
        deletedBy,
      });
    }
  }
  return listRows(rows, input, trashSpec);
}

const normalizeTaxId = (value: string) => value.replace(/[^0-9A-Za-z]/g, "").toUpperCase();

/** The collisions a returning record would cause (`CONFLICT`). */
function assertRestorable(db: MockStore, type: ArchivableType, id: string): void {
  if (type === "CLIENT") {
    const client = db.clients.find((row) => row.id === id)!;
    const holder = db.clients.find(
      (row) =>
        row.id !== id &&
        !row.archivedAt &&
        row.country === client.country &&
        normalizeTaxId(row.taxId) === normalizeTaxId(client.taxId),
    );
    if (holder) {
      throw new ServiceError("CONFLICT", {
        message: MESSAGES.taxIdTaken,
        entity: resolveEntityRef(db, "CLIENT", holder.id) ?? undefined,
      });
    }
  }
  if (type === "CONTACT") {
    const clientId = db.contacts.find((row) => row.id === id)!.clientId;
    if (db.clients.find((row) => row.id === clientId)?.archivedAt) {
      throw new ServiceError("CONFLICT", {
        message: MESSAGES.clientArchived,
        entity: resolveEntityRef(db, "CLIENT", clientId) ?? undefined,
      });
    }
  }
  if (type === "INVOICE") {
    const invoice = db.invoices.find((row) => row.id === id)!;
    const holder = db.invoices.find(
      (row) => row.id !== id && !row.archivedAt && row.invoiceNumber === invoice.invoiceNumber,
    );
    if (holder) {
      throw new ServiceError("CONFLICT", {
        message: MESSAGES.invoiceNumberTaken,
        entity: resolveEntityRef(db, "INVOICE", holder.id) ?? undefined,
      });
    }
  }
}

async function revive(
  ctx: MockServiceContext,
  type: ArchivableType,
  row: Archivable,
  metadata?: Record<string, string | number | boolean>,
): Promise<EntityRef> {
  row.archivedAt = null;
  if ("deletedById" in row) row.deletedById = null;
  row.updatedAt = ctx.now.toISOString();
  const ref = resolveEntityRef(ctx.db, type, row.id)!;
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "RESTORE",
    entityType: type,
    entityId: row.id,
    entityLabel: ref.label,
    ...(metadata && { metadata }),
  });
  return ref;
}

export async function restoreFromTrash(
  ctx: MockServiceContext,
  input: RestoreFromTrashInput,
): Promise<RestoredRecordDTO> {
  const { db } = ctx;
  const type = input.entityType;
  if (!isArchivable(type)) throw new ServiceError("NOT_FOUND");
  if (!can(ctx.user, "restore", RESOURCE[type])) throw new ServiceError("FORBIDDEN");
  const row = collection(db, type).find((item) => item.id === input.entityId);
  if (!row || !row.archivedAt) throw new ServiceError("NOT_FOUND");
  assertRestorable(db, type, row.id);

  const cascadeAt = row.archivedAt;
  const ref = await revive(ctx, type, row);
  if (type === "CLIENT") {
    for (const contact of db.contacts) {
      if (contact.clientId !== row.id || contact.archivedAt !== cascadeAt) continue;
      await revive(ctx, "CONTACT", contact, { clientId: row.id, cascade: true });
    }
  }
  deriveMockStore(db);
  return { entity: trashRef(ref, type), restoredAt: ctx.now.toISOString() };
}
