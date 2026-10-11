// MOCK — contacts service of Hito 1 (PRD §8.2 "Contacto", §12 `contacts`; HU-04). Same function names and
// signatures as `ContactsService` (C9): `fn(ctx, input)`, framework-free (C11). Contacts have no global table:
// they live in the client's Contactos tab. A client has at most one primary contact (HU-04 CA2). Contact rows
// carry no `deletedById` and no cascade marker (PRD §10 `Contact`); the client cascade is told by
// `archivedAt` (see `clients.ts`). Mutations append activity on `CONTACT` (C12 form). Replaced by
// `src/server/services/contacts.service.ts` in Hito 2 (C9).
import { diffFields } from "@/lib/activity-diff";
import { can } from "@/server/auth/permissions";
import type { EntityRef, Paginated } from "@/lib/validators/common";
import { VALIDATION_MESSAGES } from "@/lib/validators/common";
import type {
  ArchiveContactInput,
  ContactDetailDTO,
  ContactFilter,
  ContactListRowDTO,
  ContactsService,
  CreateContactInput,
  SetPrimaryContactInput,
  UpdateContactInput,
} from "@/lib/validators/contacts";
import type { ArchivedRecordDTO } from "@/lib/validators/trash";
import type { MockServiceContext } from "../ctx";
import { ServiceError } from "../ctx";
import { nextMockId } from "../ids";
import type { ContactRow, MockStore } from "../store";
import { deriveMockStore } from "../store";
import { logActivity, mockTx } from "./activity";
import { listRows, type ListSpec } from "./list";

const CONTACT_DIFF_FIELDS = ["fullName", "position", "email", "phone", "isPrimary", "tagIds"];

/** Assembles the DTO of a stored contact: resolves the tag chips. Shared with `clients.ts`. */
export function toContactDTO(db: MockStore, row: ContactRow): ContactDetailDTO {
  const { tagIds, ...rest } = row;
  const tags = tagIds.flatMap((tagId) => {
    const tag = db.tags.find((item) => item.id === tagId);
    return tag ? [{ id: tag.id, name: tag.name, color: tag.color }] : [];
  });
  return { ...rest, tags };
}

/** Primary first, then by name: the order of the "highlighted contacts" and of the tab's default view. */
export function sortContacts(rows: readonly ContactRow[]): ContactRow[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) ||
      a.fullName.localeCompare(b.fullName, "es", { sensitivity: "base" }),
  );
}

function assertTagsExist(db: MockStore, tagIds: readonly string[]): void {
  if (tagIds.some((id) => !db.tags.some((tag) => tag.id === id))) {
    throw new ServiceError("VALIDATION", {
      fieldErrors: { tagIds: [VALIDATION_MESSAGES.invalidOption] },
    });
  }
}

/** A client that exists and is not archived: contacts are only managed on live clients. */
function requireLiveClient(db: MockStore, clientId: string) {
  const client = db.clients.find((item) => item.id === clientId && !item.archivedAt);
  if (!client) throw new ServiceError("NOT_FOUND");
  return client;
}

function findLiveContact(db: MockStore, id: string): ContactRow {
  const row = db.contacts.find((item) => item.id === id && !item.archivedAt);
  if (!row) throw new ServiceError("NOT_FOUND");
  return row;
}

/** Makes `keep` the only primary of its client; logs the demotion of the previous one. */
async function demoteOtherPrimaries(ctx: MockServiceContext, keep: ContactRow): Promise<void> {
  const others = ctx.db.contacts.filter(
    (item) => item.clientId === keep.clientId && item.id !== keep.id && item.isPrimary,
  );
  for (const other of others) {
    other.isPrimary = false;
    other.updatedAt = ctx.now.toISOString();
    await logActivity(mockTx(ctx), {
      actorType: "USER",
      actorId: ctx.user.id,
      action: "UPDATE",
      entityType: "CONTACT",
      entityId: other.id,
      entityLabel: other.fullName,
      changes: { isPrimary: [true, false] },
    });
  }
}

export async function createContact(
  ctx: MockServiceContext,
  input: CreateContactInput,
): Promise<ContactDetailDTO> {
  const { db } = ctx;
  requireLiveClient(db, input.clientId);
  assertTagsExist(db, input.tagIds);

  const now = ctx.now.toISOString();
  const row: ContactRow = {
    id: nextMockId(db.idCounters, "con", (id) => db.contacts.some((item) => item.id === id)),
    clientId: input.clientId,
    fullName: input.fullName,
    position: input.position ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    isPrimary: input.isPrimary,
    tagIds: [...input.tagIds],
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  db.contacts.push(row);
  if (row.isPrimary) await demoteOtherPrimaries(ctx, row);
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "CREATE",
    entityType: "CONTACT",
    entityId: row.id,
    entityLabel: row.fullName,
    metadata: { clientId: row.clientId },
  });
  deriveMockStore(db);
  return toContactDTO(db, row);
}

export async function updateContact(
  ctx: MockServiceContext,
  input: UpdateContactInput,
): Promise<ContactDetailDTO> {
  const { db } = ctx;
  const row = findLiveContact(db, input.id);
  assertTagsExist(db, input.tagIds);

  const before = { ...row, tagIds: [...row.tagIds].sort() };
  row.fullName = input.fullName;
  row.position = input.position ?? null;
  row.email = input.email ?? null;
  row.phone = input.phone ?? null;
  row.isPrimary = input.isPrimary;
  row.tagIds = [...input.tagIds];
  const changes = diffFields(
    before,
    { ...row, tagIds: [...row.tagIds].sort() },
    {
      fields: CONTACT_DIFF_FIELDS,
    },
  );
  if (changes) {
    row.updatedAt = ctx.now.toISOString();
    if (row.isPrimary) await demoteOtherPrimaries(ctx, row);
    await logActivity(mockTx(ctx), {
      actorType: "USER",
      actorId: ctx.user.id,
      action: "UPDATE",
      entityType: "CONTACT",
      entityId: row.id,
      entityLabel: row.fullName,
      changes,
    });
  }
  deriveMockStore(db);
  return toContactDTO(db, row);
}

/** Makes the contact the client's only primary one (HU-04 CA2): the previous primary is unset. */
export async function setPrimaryContact(
  ctx: MockServiceContext,
  input: SetPrimaryContactInput,
): Promise<ContactDetailDTO> {
  const { db } = ctx;
  const row = findLiveContact(db, input.id);
  if (!row.isPrimary) {
    row.isPrimary = true;
    row.updatedAt = ctx.now.toISOString();
    await demoteOtherPrimaries(ctx, row);
    await logActivity(mockTx(ctx), {
      actorType: "USER",
      actorId: ctx.user.id,
      action: "UPDATE",
      entityType: "CONTACT",
      entityId: row.id,
      entityLabel: row.fullName,
      changes: { isPrimary: [false, true] },
    });
  }
  deriveMockStore(db);
  return toContactDTO(db, row);
}

/** Soft delete. An archived contact gives up the primary flag, so the client can name another one. */
export async function archiveContact(
  ctx: MockServiceContext,
  input: ArchiveContactInput,
): Promise<ArchivedRecordDTO> {
  const { db } = ctx;
  const row = findLiveContact(db, input.id);
  const wasPrimary = row.isPrimary;
  row.archivedAt = ctx.now.toISOString();
  row.updatedAt = row.archivedAt;
  row.isPrimary = false;
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "DELETE",
    entityType: "CONTACT",
    entityId: row.id,
    entityLabel: row.fullName,
    ...(wasPrimary ? { changes: { isPrimary: [true, false] } } : {}),
    metadata: { clientId: row.clientId },
  });
  deriveMockStore(db);
  return { id: row.id, archivedAt: row.archivedAt };
}

const contactSpec: ListSpec<ContactListRowDTO> = {
  searchText: (row) => [row.fullName, row.position, row.email, row.phone],
  sorters: {
    fullName: (row) => row.fullName,
    position: (row) => row.position,
    email: (row) => row.email,
    isPrimary: (row) => row.isPrimary,
    createdAt: (row) => row.createdAt,
  },
  defaultSort: "isPrimary:desc",
};

/**
 * Contacts of one client, primary first by default. Archived contacts appear only with `includeArchived`,
 * and only for roles that may open the trash (`restore` on `trash`, C19).
 */
export async function listContacts(
  ctx: MockServiceContext,
  input: ContactFilter,
): Promise<Paginated<ContactListRowDTO>> {
  const { db } = ctx;
  if (!db.clients.some((item) => item.id === input.clientId)) throw new ServiceError("NOT_FOUND");
  const showArchived = input.includeArchived && can(ctx.user, "restore", "trash");
  const rows = sortContacts(
    db.contacts.filter(
      (item) => item.clientId === input.clientId && (showArchived || !item.archivedAt),
    ),
  ).map((row) => toContactDTO(db, row));
  return listRows(rows, input, contactSpec);
}

/**
 * Typeahead for pickers (the note link picker): live contacts of live clients matching `q`, optionally of
 * one client, as `EntityRef`s. Not part of `ContactsService`; the search action calls it.
 */
export async function searchContacts(
  ctx: MockServiceContext,
  input: { q?: string | undefined; clientId?: string | undefined; limit?: number },
): Promise<EntityRef[]> {
  const { db } = ctx;
  const liveClients = new Set(db.clients.filter((item) => !item.archivedAt).map((item) => item.id));
  const rows = sortContacts(
    db.contacts.filter(
      (item) =>
        !item.archivedAt &&
        liveClients.has(item.clientId) &&
        (!input.clientId || item.clientId === input.clientId),
    ),
  ).map((row) => toContactDTO(db, row));
  const page = listRows(rows, { page: 1, pageSize: 100, q: input.q }, contactSpec);
  return page.items
    .slice(0, input.limit ?? 20)
    .map((row) => ({ id: row.id, label: row.fullName, type: "CONTACT" as const }));
}

// Compile-time check that the exported functions match the contract (C9).
const _contract = {
  createContact,
  updateContact,
  setPrimaryContact,
  archiveContact,
  listContacts,
} satisfies ContactsService<MockServiceContext>;
void _contract;
