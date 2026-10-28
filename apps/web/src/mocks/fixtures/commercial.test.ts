// MOCK — the commercial dataset (clients, contacts, projects, notes, documents, activity) must assemble into
// DTOs that parse with their contracts, resolve every reference and cover the cases the specs rely on.
import { describe, expect, it } from "vitest";
import { addDays, daysBetween } from "@/lib/dates";
import { activityEntrySchema } from "@/lib/validators/activity";
import { clientDetailSchema, isValidTaxIdFor, isValidVeRif } from "@/lib/validators/clients";
import { contactDetailSchema } from "@/lib/validators/contacts";
import { documentTypeRefSchema, documentCategoryRefSchema } from "@/lib/validators/document-types";
import {
  documentDetailSchema,
  documentTypeRuleIssues,
  documentVersionDetailSchema,
  type DocumentDetailDTO,
} from "@/lib/validators/documents";
import {
  ACTIVITY_ACTION_VALUES,
  CLIENT_KIND_VALUES,
  CLIENT_STATUS_VALUES,
  DOCUMENT_FORMAT_VALUES,
  PROJECT_LINK_GROUP_VALUES,
  PROJECT_STATUS_VALUES,
} from "@/lib/validators/enums";
import { fileDtoSchema } from "@/lib/validators/files";
import { noteDetailSchema, richTextDocSchema } from "@/lib/validators/notes";
import { projectDetailSchema } from "@/lib/validators/projects";
import { tagChipSchema } from "@/lib/validators/tags";
import { technologyChipSchema } from "@/lib/validators/technologies";
import { resolveEntityRef, richTextToPlainText } from "../entity-refs";
import { toActivityEntryDTO } from "../services/activity";
import { buildMockStore, type MockStore } from "../store";
import { FIXED_NOW, FIXED_TODAY } from "../test-helpers";

const db = buildMockStore(FIXED_NOW);

const ZERO = "0.00";

// ───────────────────────────── Assemblers (what the W2 services do) ─────────────────────────────

function ref(entityType: Parameters<typeof resolveEntityRef>[1], id: string) {
  const found = resolveEntityRef(db, entityType, id);
  if (!found) throw new Error(`Dangling reference ${entityType} ${id}`);
  return found;
}

function chips(tagIds: readonly string[]) {
  return tagIds.map((id) => {
    const tag = db.tags.find((row) => row.id === id);
    if (!tag) throw new Error(`Unknown tag ${id}`);
    return tagChipSchema.parse({ id: tag.id, name: tag.name, color: tag.color });
  });
}

function userRef(id: string) {
  const user = db.users.find((row) => row.id === id);
  if (!user) throw new Error(`Unknown user ${id}`);
  return { id: user.id, name: user.name, imageUrl: user.imageUrl };
}

function fileOf(id: string) {
  const file = db.files.find((row) => row.id === id);
  if (!file) throw new Error(`Unknown file ${id}`);
  return fileDtoSchema.parse(file);
}

function contactDTO(row: MockStore["contacts"][number]) {
  const { tagIds, ...rest } = row;
  return contactDetailSchema.parse({ ...rest, tags: chips(tagIds) });
}

function clientDTO(row: MockStore["clients"][number]) {
  const { tagIds, deletedById, ...rest } = row;
  void deletedById;
  const contacts = db.contacts.filter((contact) => contact.clientId === row.id);
  return clientDetailSchema.parse({
    ...rest,
    tags: chips(tagIds),
    contacts: contacts.map(contactDTO),
    financials: {
      clientId: row.id,
      totalInvoicedUsd: ZERO,
      totalCollectedUsd: ZERO,
      receivableUsd: ZERO,
      overdueUsd: ZERO,
      creditBalanceUsd: ZERO,
      projectCount: db.projects.filter((p) => p.clients.some((c) => c.clientId === row.id)).length,
    },
  });
}

function projectDTO(row: MockStore["projects"][number]) {
  const { clients, technologyIds, tagIds, deletedById, ...rest } = row;
  void deletedById;
  return projectDetailSchema.parse({
    ...rest,
    clients: clients.map((item) => ({ client: ref("CLIENT", item.clientId), role: item.role })),
    stack: technologyIds.map((id) => {
      const tech = db.technologies.find((row) => row.id === id);
      if (!tech) throw new Error(`Unknown technology ${id}`);
      const { active, ...chip } = tech;
      void active;
      return technologyChipSchema.parse(chip);
    }),
    tags: chips(tagIds),
    contractedValueUsd: ZERO,
    invoicedUsd: ZERO,
    collectedUsd: ZERO,
    toInvoiceUsd: ZERO,
    hasBillingPlan: false,
  });
}

function noteDTO(row: MockStore["notes"][number]) {
  const { authorId, tagIds, links, attachmentFileIds, deletedById, ...rest } = row;
  void deletedById;
  return noteDetailSchema.parse({
    ...rest,
    contentText: richTextToPlainText(row.content),
    author: userRef(authorId),
    tags: chips(tagIds),
    links: links.map((link) => ref(link.entityType, link.entityId)),
    attachments: attachmentFileIds.map(fileOf),
  });
}

function versionDTO(row: MockStore["documentVersions"][number], currentId: string | null) {
  const { fileId, createdById, ...rest } = row;
  return documentVersionDetailSchema.parse({
    ...rest,
    file: fileId ? fileOf(fileId) : null,
    createdBy: userRef(createdById),
    isCurrent: row.id === currentId,
  });
}

function documentDTO(row: MockStore["documents"][number]): DocumentDetailDTO {
  const { typeId, currentVersionId, tagIds, createdById, deletedById, ...rest } = row;
  void deletedById;
  const type = db.documentTypes.find((item) => item.id === typeId);
  const category = db.documentCategories.find((item) => item.id === type?.categoryId);
  if (!type || !category) throw new Error(`Unknown type of ${row.id}`);
  const versions = db.documentVersions.filter((version) => version.documentId === row.id);
  const current = versions.find((version) => version.id === currentVersionId);
  return documentDetailSchema.parse({
    ...rest,
    type: documentTypeRefSchema.parse(type),
    category: documentCategoryRefSchema.parse(category),
    currentVersion: current ? versionDTO(current, currentVersionId) : null,
    versionCount: versions.length,
    links: db.documentLinks
      .filter((link) => link.documentId === row.id)
      .map((link) => ({
        id: link.id,
        entity: ref(link.entityType, link.entityId),
        createdAt: link.createdAt,
      })),
    tags: chips(tagIds),
    isShared: false,
    createdBy: createdById ? userRef(createdById) : null,
  });
}

const activeClients = db.clients.filter((c) => !c.archivedAt);
const activeProjects = db.projects.filter((p) => !p.archivedAt);

// ───────────────────────────── Clients and contacts ─────────────────────────────

describe("clients", () => {
  it("assemble into valid ClientDetailDTOs with unique ids and codes", () => {
    for (const row of db.clients) clientDTO(row);
    expect(new Set(db.clients.map((c) => c.id)).size).toBe(db.clients.length);
    expect(new Set(db.clients.map((c) => c.code)).size).toBe(db.clients.length);
    for (const c of db.clients) expect(c.code).toMatch(/^CLI-\d{4}$/);
  });

  it("has at least 60 clients of both kinds, every status and several countries", () => {
    expect(db.clients.length).toBeGreaterThanOrEqual(60);
    for (const kind of CLIENT_KIND_VALUES)
      expect(db.clients.some((c) => c.kind === kind)).toBe(true);
    for (const status of CLIENT_STATUS_VALUES) {
      expect(db.clients.some((c) => c.status === status)).toBe(true);
    }
    expect(db.clients.filter((c) => c.status === "PROSPECTO").length).toBeGreaterThanOrEqual(3);
    expect(new Set(db.clients.map((c) => c.country)).size).toBeGreaterThanOrEqual(5);
    expect(db.clients.some((c) => c.tagIds.length > 0)).toBe(true);
  });

  it("gives VE clients a valid RIF and every other client a non-empty tax id", () => {
    for (const c of db.clients) {
      expect(isValidTaxIdFor(c.country, c.taxId)).toBe(true);
      if (c.country === "VE") expect(isValidVeRif(c.taxId)).toBe(true);
    }
  });

  it("keeps (tax id + country) unique among non-archived clients (HU-03 CA3) and documents one", () => {
    const keys = activeClients.map((c) => `${c.country}:${c.taxId}`);
    expect(new Set(keys).size).toBe(keys.length);
    const kairos = db.clients.find((c) => c.id === "cli_kairos");
    expect(kairos).toMatchObject({
      taxId: "J-30123456-7",
      country: "VE",
      status: "ACTIVO",
      archivedAt: null,
    });
  });

  it("covers the archive cases: one archived client, one with active projects, one empty", () => {
    expect(db.clients.filter((c) => c.archivedAt)).toHaveLength(1);
    const archived = db.clients.find((c) => c.archivedAt)!;
    expect(archived.deletedById).not.toBeNull();
    expect(db.contacts.filter((c) => c.clientId === archived.id).every((c) => c.archivedAt)).toBe(
      true,
    );

    expect(
      activeProjects.filter((p) => p.clients.some((c) => c.clientId === "cli_kairos")).length,
    ).toBeGreaterThanOrEqual(2);

    const empty = db.clients.find((c) => c.id === "cli_zafiro_labs")!;
    expect(empty.archivedAt).toBeNull();
    expect(db.projects.some((p) => p.clients.some((c) => c.clientId === empty.id))).toBe(false);
    expect(db.contacts.some((c) => c.clientId === empty.id)).toBe(false);
  });

  it("sets activatedAt only for clients that were active", () => {
    for (const c of db.clients) {
      expect(c.activatedAt === null).toBe(c.status === "PROSPECTO");
    }
  });
});

describe("contacts", () => {
  it("assemble into valid ContactDetailDTOs that belong to a client", () => {
    for (const row of db.contacts) {
      contactDTO(row);
      expect(db.clients.some((c) => c.id === row.clientId)).toBe(true);
    }
  });

  it("covers clients with 0, 1 and 3 contacts and at most one primary each", () => {
    const counts = db.clients.map((c) => db.contacts.filter((x) => x.clientId === c.id).length);
    for (const wanted of [0, 1, 3]) expect(counts).toContain(wanted);
    for (const client of db.clients) {
      const primaries = db.contacts.filter((c) => c.clientId === client.id && c.isPrimary);
      expect(primaries.length).toBeLessThanOrEqual(1);
    }
    const threeNoPrimary = db.clients.filter((c) => {
      const own = db.contacts.filter((x) => x.clientId === c.id);
      return own.length === 3 && !own.some((x) => x.isPrimary);
    });
    expect(threeNoPrimary.length).toBeGreaterThanOrEqual(1);
  });

  it("gives every contact an email or a phone, with unique ids", () => {
    for (const c of db.contacts) expect(c.email !== null || c.phone !== null).toBe(true);
    expect(new Set(db.contacts.map((c) => c.id)).size).toBe(db.contacts.length);
    expect(
      db.contacts.some(
        (c) => c.archivedAt && !db.clients.find((x) => x.id === c.clientId)?.archivedAt,
      ),
    ).toBe(true);
  });
});

// ───────────────────────────── Projects ─────────────────────────────

describe("projects", () => {
  it("assemble into valid ProjectDetailDTOs (descriptions are allowlisted Tiptap)", () => {
    for (const row of db.projects) {
      projectDTO(row);
      if (row.description) expect(richTextDocSchema.safeParse(row.description).success).toBe(true);
    }
    expect(new Set(db.projects.map((p) => p.code)).size).toBe(db.projects.length);
  });

  it("has about 25 projects covering every status", () => {
    expect(db.projects.length).toBeGreaterThanOrEqual(22);
    expect(db.projects.length).toBeLessThanOrEqual(30);
    for (const status of PROJECT_STATUS_VALUES) {
      expect(db.projects.some((p) => p.status === status)).toBe(true);
    }
  });

  it("has projects with two or three clients and roles", () => {
    const multi = db.projects.filter((p) => p.clients.length >= 2 && p.clients.length <= 3);
    expect(multi.length).toBeGreaterThanOrEqual(5);
    for (const p of multi) expect(p.clients.every((c) => c.role)).toBe(true);
  });

  it("uses Next.js in at least two projects and leaves an active technology unused (HU-06)", () => {
    const nextId = db.technologies.find((t) => t.name === "Next.js")!.id;
    expect(
      db.projects.filter((p) => p.technologyIds.includes(nextId)).length,
    ).toBeGreaterThanOrEqual(2);
    const used = new Set(db.projects.flatMap((p) => p.technologyIds));
    expect(db.technologies.some((t) => t.active && !used.has(t.id))).toBe(true);
    for (const id of used) expect(db.technologies.some((t) => t.id === id)).toBe(true);
  });

  it("has links in at least four groups and a project with two repository links (HU-07)", () => {
    const groups = new Set(db.projects.flatMap((p) => p.links.map((l) => l.group)));
    expect(groups.size).toBeGreaterThanOrEqual(4);
    for (const group of groups) expect(PROJECT_LINK_GROUP_VALUES).toContain(group);
    expect(
      db.projects.some((p) => p.links.filter((l) => l.group === "REPOSITORIO").length >= 2),
    ).toBe(true);
    for (const p of db.projects) {
      const orders = p.links.map((l) => `${l.group}:${l.order}`);
      expect(new Set(orders).size).toBe(orders.length);
    }
  });

  it("keeps statuses and dates coherent, with a late project and one due within 14 days", () => {
    for (const p of db.projects) {
      if (p.status === "EN_CURSO") expect(p.startDate).not.toBeNull();
      if (p.status === "ENTREGADO") expect(p.endDate).not.toBeNull();
      if (p.startDate && p.targetEndDate) expect(p.targetEndDate >= p.startDate).toBe(true);
    }
    expect(db.projects.some((p) => p.status === "EN_CURSO" && p.targetEndDate! < FIXED_TODAY)).toBe(
      true,
    );
    expect(
      db.projects.some(
        (p) =>
          p.status === "EN_CURSO" &&
          p.targetEndDate! >= FIXED_TODAY &&
          daysBetween(FIXED_TODAY, p.targetEndDate!) <= 14,
      ),
    ).toBe(true);
  });

  it("gives every active project at least one non-archived client", () => {
    for (const p of activeProjects) {
      expect(p.clients.length).toBeGreaterThanOrEqual(1);
      expect(p.clients.some((c) => activeClients.some((client) => client.id === c.clientId))).toBe(
        true,
      );
    }
    expect(db.projects.filter((p) => p.archivedAt)).toHaveLength(1);
  });
});

// ───────────────────────────── Notes ─────────────────────────────

describe("notes", () => {
  it("assemble into valid NoteDetailDTOs with a resolvable link each", () => {
    expect(db.notes.length).toBeGreaterThanOrEqual(35);
    expect(db.notes.length).toBeLessThanOrEqual(45);
    for (const row of db.notes) {
      const dto = noteDTO(row);
      expect(dto.links.length).toBeGreaterThanOrEqual(1);
      expect(dto.contentText.length).toBeGreaterThan(0);
    }
    expect(new Set(db.notes.map((n) => n.id)).size).toBe(db.notes.length);
  });

  it("covers pinned and unpinned notes, attachments and archived rows", () => {
    expect(db.notes.some((n) => n.pinned)).toBe(true);
    expect(db.notes.some((n) => !n.pinned)).toBe(true);
    expect(db.notes.some((n) => n.attachmentFileIds.length > 0)).toBe(true);
    expect(db.notes.filter((n) => n.archivedAt)).toHaveLength(1);
    expect(db.notes.some((n) => n.title === null)).toBe(true);
  });

  it("has a note linked to a client and a project at once (HU-23 CA2)", () => {
    expect(
      db.notes.some(
        (n) =>
          n.links.some((l) => l.entityType === "CLIENT") &&
          n.links.some((l) => l.entityType === "PROJECT"),
      ),
    ).toBe(true);
  });

  it("has notes by the default mock user, by other users and by the Member", () => {
    expect(db.notes.some((n) => n.authorId === "usr_andres_molina")).toBe(true);
    expect(db.notes.some((n) => n.authorId !== "usr_andres_molina")).toBe(true);
    const member = db.users.find((u) => u.role === "MEMBER")!;
    expect(db.notes.filter((n) => n.authorId === member.id).length).toBeGreaterThanOrEqual(3);
  });
});

// ───────────────────────────── Documents and files ─────────────────────────────

describe("documents", () => {
  it("assemble into valid DocumentDetailDTOs that respect their type rules", () => {
    expect(db.documents.length).toBeGreaterThanOrEqual(8);
    expect(db.documents.length).toBeLessThanOrEqual(14);
    for (const row of db.documents) {
      const dto = documentDTO(row);
      expect(
        documentTypeRuleIssues(dto.type, {
          status: dto.status,
          signedAt: dto.signedAt ?? undefined,
          expiresAt: dto.expiresAt ?? undefined,
        }),
      ).toEqual([]);
      if (dto.status === "FIRMADO") expect(dto.signedAt).not.toBeNull();
    }
    expect(new Set(db.documents.map((d) => d.code)).size).toBe(db.documents.length);
  });

  it("covers each format, with the files and the content each version needs", () => {
    const formats = new Set(db.documentVersions.map((v) => v.format));
    for (const format of DOCUMENT_FORMAT_VALUES) expect(formats).toContain(format);
    for (const v of db.documentVersions) {
      if (v.format === "ARCHIVO") expect(v.fileId).not.toBeNull();
      if (v.format === "MARKDOWN") expect(v.content).not.toBeNull();
      if (v.format === "ENLACE") expect(v.url).toMatch(/^https:\/\//);
    }
    expect(db.documents.some((d) => d.currentVersionId === null)).toBe(true);
    expect(db.documentVersions.some((v) => v.versionNumber > 1)).toBe(true);
  });

  it("has a document linked to a client and two projects (HU-20)", () => {
    expect(
      db.documents.some((d) => {
        const links = db.documentLinks.filter((l) => l.documentId === d.id);
        return (
          links.filter((l) => l.entityType === "CLIENT").length === 1 &&
          links.filter((l) => l.entityType === "PROJECT").length === 2
        );
      }),
    ).toBe(true);
  });

  it("has one document expiring within 30 days and one VENCIDO (alerts)", () => {
    const expiring = db.documents.filter(
      (d) => d.expiresAt && d.expiresAt >= FIXED_TODAY && d.expiresAt <= addDays(FIXED_TODAY, 30),
    );
    expect(expiring.length).toBeGreaterThanOrEqual(1);
    const expired = db.documents.filter((d) => d.status === "VENCIDO");
    expect(expired.length).toBeGreaterThanOrEqual(1);
    for (const d of expired) expect(d.expiresAt! < FIXED_TODAY).toBe(true);
  });

  it("owns the file fixtures, all READY and valid", () => {
    expect(db.files.length).toBeGreaterThanOrEqual(8);
    for (const f of db.files) {
      expect(fileDtoSchema.safeParse(f).success).toBe(true);
      expect(f.status).toBe("READY");
      expect(db.users.some((u) => u.id === f.uploadedById)).toBe(true);
    }
    expect(new Set(db.files.map((f) => f.id)).size).toBe(db.files.length);
  });
});

// ───────────────────────────── Activity ─────────────────────────────

describe("activity", () => {
  const entries = db.activity;
  const IP = /^(192\.0\.2|198\.51\.100)\.\d{1,3}$/;

  it("assembles into valid ActivityEntryDTOs with unique ids, oldest first", () => {
    for (const row of entries) activityEntrySchema.parse(toActivityEntryDTO(db, row));
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    const times = entries.map((e) => Date.parse(e.createdAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("has about 150 entries over the last ~60 days", () => {
    expect(entries.length).toBeGreaterThanOrEqual(130);
    expect(entries.length).toBeLessThanOrEqual(170);
    const oldest = Date.parse(entries[0]!.createdAt);
    expect(FIXED_NOW.getTime() - oldest).toBeLessThanOrEqual(61 * 86_400_000);
    expect(Date.parse(entries.at(-1)!.createdAt)).toBeLessThanOrEqual(FIXED_NOW.getTime());
  });

  it("covers USER, SYSTEM and PUBLIC actors and the required actions", () => {
    for (const type of ["USER", "SYSTEM", "PUBLIC"] as const) {
      expect(entries.some((e) => e.actorType === type)).toBe(true);
    }
    for (const action of [
      "CREATE",
      "UPDATE",
      "DELETE",
      "RESTORE",
      "STATUS_CHANGE",
      "LINK",
      "UNLINK",
      "UPLOAD",
      "LOGIN",
      "SYSTEM_JOB",
      "PORTAL_ACCESS",
    ] as const) {
      expect(ACTIVITY_ACTION_VALUES).toContain(action);
      expect(entries.some((e) => e.action === action)).toBe(true);
    }
    for (const e of entries) {
      expect(e.actorType === "USER").toBe(e.actorId !== null);
      if (e.actorId) expect(db.users.some((u) => u.id === e.actorId)).toBe(true);
    }
  });

  it("points every entry at an entity that resolves", () => {
    for (const e of entries) {
      expect(
        resolveEntityRef(db, e.entityType, e.entityId),
        `${e.id} ${e.entityType}`,
      ).not.toBeNull();
    }
  });

  it("uses documentation IPs only (C5), on user actions only", () => {
    for (const e of entries) {
      if (e.ip !== null) {
        expect(e.ip).toMatch(IP);
        expect(e.actorType).toBe("USER");
      }
    }
    expect(entries.some((e) => e.ip !== null)).toBe(true);
  });

  it("has UPDATE diffs, the long-text marker and no sensitive field", () => {
    const updates = entries.filter((e) => e.action === "UPDATE" && e.changes);
    expect(updates.length).toBeGreaterThan(5);
    expect(entries.some((e) => e.changes && Object.values(e.changes).includes("changed"))).toBe(
      true,
    );
    const forbidden = /tax|password|secret|token|key|iban|account/i;
    for (const e of entries) {
      for (const field of Object.keys(e.changes ?? {})) expect(field).not.toMatch(forbidden);
    }
  });
});

describe("store integration", () => {
  it("syncs the code sequences with the dataset", () => {
    expect(db.sequences.CLI).toBe(db.clients.length);
    expect(db.sequences.PRY).toBe(db.projects.length);
    expect(db.sequences.DOC).toBe(db.documents.length);
  });

  it("references only catalog tags, users and technologies", () => {
    const tagIds = new Set(db.tags.map((t) => t.id));
    const rows = [...db.clients, ...db.contacts, ...db.projects, ...db.notes, ...db.documents];
    for (const row of rows) for (const id of row.tagIds) expect(tagIds.has(id)).toBe(true);
    for (const doc of db.documents) {
      expect(db.documentTypes.some((t) => t.id === doc.typeId)).toBe(true);
    }
  });
});
