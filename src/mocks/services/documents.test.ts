// MOCK — tests for the minimal documents service of H1-B2.
import { describe, expect, it } from "vitest";
import {
  documentFilterSchema,
  type CreateDocumentInput,
  type DocumentsService,
} from "@/lib/validators/documents";
import type { MockServiceContext } from "../ctx";
import * as documentsService from "./documents";
import { makeTestContext } from "../test-helpers";
import { ServiceError } from "../ctx";
import {
  createDocument,
  linkDocument,
  listDocuments,
  unlinkDocument,
  uploadVersion,
} from "./documents";

const archivoType = (
  db: ReturnType<typeof makeTestContext>["db"],
  pick?: (t: { requiresSignature: boolean; hasExpiration: boolean }) => boolean,
) =>
  db.documentTypes.find(
    (type) => type.active && type.defaultFormat === "ARCHIVO" && (pick?.(type) ?? true),
  )!;

function draft(
  db: ReturnType<typeof makeTestContext>["db"],
  overrides: Partial<CreateDocumentInput> = {},
): CreateDocumentInput {
  return {
    title: "Acuerdo de confidencialidad",
    typeId: archivoType(db).id,
    summary: undefined,
    alertDaysBefore: 30,
    tagIds: [],
    links: [],
    ...overrides,
  };
}

describe("listDocuments", () => {
  it("lists the documents linked to one client, archived ones left out", async () => {
    const { ctx, db } = makeTestContext();
    const client = db.clients[0]!;
    const linked = db.documentLinks.filter(
      (link) => link.entityType === "CLIENT" && link.entityId === client.id,
    );
    const expected = linked.filter(
      (link) => db.documents.find((doc) => doc.id === link.documentId)?.archivedAt === null,
    );

    const page = await listDocuments(
      ctx,
      documentFilterSchema.parse({ clientId: client.id, pageSize: 100 }),
    );
    expect(page.items.map((row) => row.id).sort()).toEqual(
      expected.map((link) => link.documentId).sort(),
    );
    for (const row of page.items) {
      expect(row.links.some((ref) => ref.id === client.id && ref.type === "CLIENT")).toBe(true);
    }
  });

  it("lists by project, and both facets narrow the result", async () => {
    const { ctx, db } = makeTestContext();
    const project = db.projects.find((row) =>
      db.documentLinks.some((link) => link.entityType === "PROJECT" && link.entityId === row.id),
    )!;
    const page = await listDocuments(
      ctx,
      documentFilterSchema.parse({ projectId: project.id, pageSize: 100 }),
    );
    expect(page.total).toBeGreaterThan(0);
    const both = await listDocuments(
      ctx,
      documentFilterSchema.parse({
        projectId: project.id,
        clientId: "cli_no_such_client",
        pageSize: 100,
      }),
    );
    expect(both.total).toBe(0);
  });

  it("shows the current version, the category and the type of each row", async () => {
    const { ctx, db } = makeTestContext();
    const doc = db.documents.find((row) => row.archivedAt === null && row.currentVersionId)!;
    const link = db.documentLinks.find((item) => item.documentId === doc.id)!;
    const page = await listDocuments(
      ctx,
      documentFilterSchema.parse({
        [link.entityType === "CLIENT" ? "clientId" : "projectId"]: link.entityId,
        pageSize: 100,
      }),
    );
    const row = page.items.find((item) => item.id === doc.id);
    const version = db.documentVersions.find((item) => item.id === doc.currentVersionId)!;
    expect(row).toMatchObject({
      code: doc.code,
      title: doc.title,
      currentVersionNumber: version.versionNumber,
      currentFormat: version.format,
      type: { id: doc.typeId },
    });
    expect(row?.category.id).toBe(db.documentTypes.find((t) => t.id === doc.typeId)!.categoryId);
  });

  it("filters by type and category, and searches code and title with q", async () => {
    const { ctx, db } = makeTestContext();
    const doc = db.documents.find((row) => row.archivedAt === null)!;
    const link = db.documentLinks.find((item) => item.documentId === doc.id)!;
    const facet =
      link.entityType === "CLIENT" ? { clientId: link.entityId } : { projectId: link.entityId };
    const type = db.documentTypes.find((t) => t.id === doc.typeId)!;

    const byType = await listDocuments(
      ctx,
      documentFilterSchema.parse({ ...facet, typeId: doc.typeId, pageSize: 100 }),
    );
    expect(byType.items.every((row) => row.type.id === doc.typeId)).toBe(true);
    expect(byType.items.some((row) => row.id === doc.id)).toBe(true);

    const byCategory = await listDocuments(
      ctx,
      documentFilterSchema.parse({ ...facet, categoryId: type.categoryId, pageSize: 100 }),
    );
    expect(byCategory.items.every((row) => row.category.id === type.categoryId)).toBe(true);

    const byText = await listDocuments(
      ctx,
      documentFilterSchema.parse({ ...facet, q: doc.code, pageSize: 100 }),
    );
    expect(byText.items.map((row) => row.id)).toContain(doc.id);
  });

  it("leaves archived documents out, even when they are linked", async () => {
    const { ctx, db } = makeTestContext();
    const doc = db.documents.find((row) => row.archivedAt === null)!;
    const link = db.documentLinks.find((item) => item.documentId === doc.id)!;
    const facet =
      link.entityType === "CLIENT" ? { clientId: link.entityId } : { projectId: link.entityId };
    doc.archivedAt = "2026-10-01T00:00:00.000Z";
    const page = await listDocuments(ctx, documentFilterSchema.parse({ ...facet, pageSize: 100 }));
    expect(page.items.map((row) => row.id)).not.toContain(doc.id);
  });
});

describe("createDocument", () => {
  it("creates a BORRADOR document with the next DOC code, logs CREATE and links the record", async () => {
    const { ctx, db } = makeTestContext("MEMBER");
    // A signed-in user is always a stored user, so the author resolves: take a fixture user as the caller.
    ctx.user = { ...ctx.user, id: db.users[0]!.id };
    const client = db.clients[0]!;
    const before = db.documents.length;
    const created = await createDocument(
      ctx,
      draft(db, { links: [{ entityType: "CLIENT", entityId: client.id }] }),
    );
    expect(db.documents).toHaveLength(before + 1);
    expect(created).toMatchObject({
      status: "BORRADOR",
      title: "Acuerdo de confidencialidad",
      currentVersion: null,
      versionCount: 0,
      createdBy: { id: db.users[0]!.id },
    });
    expect(created.code).toMatch(/^DOC-\d{4}$/);
    expect(created.links.map((link) => link.entity.id)).toEqual([client.id]);
    expect(
      db.activity.filter((entry) => entry.entityId === created.id).map((entry) => entry.action),
    ).toEqual(["CREATE", "LINK"]);
  });

  it("applies the type rules: a signature date needs a type with signature", async () => {
    const { ctx, db } = makeTestContext();
    const plain = archivoType(db, (t) => !t.requiresSignature);
    await expect(
      createDocument(ctx, draft(db, { typeId: plain.id, signedAt: "2026-10-01" })),
    ).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { signedAt: expect.any(Array) } });
    expect(db.documents.some((doc) => doc.title === "Acuerdo de confidencialidad")).toBe(false);
  });

  it("applies the type rules: an expiry date needs a type with expiration", async () => {
    const { ctx, db } = makeTestContext();
    const plain = archivoType(db, (t) => !t.hasExpiration);
    await expect(
      createDocument(ctx, draft(db, { typeId: plain.id, expiresAt: "2027-01-01" })),
    ).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { expiresAt: expect.any(Array) } });
  });

  it("accepts a signature date on a type that requires one", async () => {
    const { ctx, db } = makeTestContext();
    const signing = archivoType(db, (t) => t.requiresSignature);
    const created = await createDocument(
      ctx,
      draft(db, { typeId: signing.id, signedAt: "2026-10-01" }),
    );
    expect(created.signedAt).toBe("2026-10-01");
  });

  it("refuses types that are not ARCHIVO and inactive types (H1-B4 adds the other formats)", async () => {
    const { ctx, db } = makeTestContext();
    const markdown = db.documentTypes.find((t) => t.defaultFormat !== "ARCHIVO");
    if (markdown) {
      await expect(createDocument(ctx, draft(db, { typeId: markdown.id }))).rejects.toBeInstanceOf(
        ServiceError,
      );
    }
    const inactive = db.documentTypes.find((t) => !t.active);
    if (inactive) {
      await expect(createDocument(ctx, draft(db, { typeId: inactive.id }))).rejects.toMatchObject({
        code: "VALIDATION",
      });
    }
  });

  it("refuses a link to a record that does not exist", async () => {
    const { ctx, db } = makeTestContext();
    await expect(
      createDocument(
        ctx,
        draft(db, { links: [{ entityType: "CLIENT", entityId: "cli_missing" }] }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("uploadVersion", () => {
  it("attaches a READY file as the next version and logs UPLOAD", async () => {
    const { ctx, db } = makeTestContext();
    const created = await createDocument(ctx, draft(db));
    const file = db.files.find((row) => row.status === "READY")!;
    const updated = await uploadVersion(ctx, {
      documentId: created.id,
      format: "ARCHIVO",
      fileId: file.id,
      changelog: undefined,
    });
    expect(updated.currentVersion).toMatchObject({
      versionNumber: 1,
      format: "ARCHIVO",
      isCurrent: true,
    });
    expect(updated.currentVersion?.file?.id).toBe(file.id);
    expect(updated.versionCount).toBe(1);
    expect(db.activity.filter((entry) => entry.entityId === created.id).at(-1)?.action).toBe(
      "UPLOAD",
    );

    const second = await uploadVersion(ctx, {
      documentId: created.id,
      format: "ARCHIVO",
      fileId: file.id,
      changelog: undefined,
    });
    expect(second.currentVersion?.versionNumber).toBe(2);
  });

  it("refuses a file that is not READY, and a FIRMADO document (INTEGRITY_LOCK)", async () => {
    const { ctx, db } = makeTestContext();
    const created = await createDocument(ctx, draft(db));
    const pending = {
      id: "fil_pending_1",
      originalName: "x.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      status: "PENDING" as const,
      uploadedById: ctx.user.id,
      createdAt: ctx.now.toISOString(),
    };
    db.files.push(pending);
    await expect(
      uploadVersion(ctx, {
        documentId: created.id,
        format: "ARCHIVO",
        fileId: pending.id,
        changelog: undefined,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const row = db.documents.find((doc) => doc.id === created.id)!;
    row.status = "FIRMADO";
    const ready = db.files.find((item) => item.status === "READY")!;
    await expect(
      uploadVersion(ctx, {
        documentId: created.id,
        format: "ARCHIVO",
        fileId: ready.id,
        changelog: undefined,
      }),
    ).rejects.toMatchObject({ code: "INTEGRITY_LOCK" });
  });
});

describe("linkDocument and unlinkDocument", () => {
  it("links a second record, and unlinking one keeps the other links", async () => {
    const { ctx, db } = makeTestContext();
    const doc = await createDocument(
      ctx,
      draft(db, { links: [{ entityType: "CLIENT", entityId: db.clients[0]!.id }] }),
    );
    const project = db.projects[0]!;

    const afterLink = await linkDocument(ctx, {
      documentId: doc.id,
      target: { entityType: "PROJECT", entityId: project.id },
    });
    expect(afterLink.map((link) => link.entity.id).sort()).toEqual(
      [db.clients[0]!.id, project.id].sort(),
    );

    const again = await linkDocument(ctx, {
      documentId: doc.id,
      target: { entityType: "PROJECT", entityId: project.id },
    });
    expect(again).toHaveLength(2);

    const afterUnlink = await unlinkDocument(ctx, {
      documentId: doc.id,
      target: { entityType: "PROJECT", entityId: project.id },
    });
    expect(afterUnlink.map((link) => link.entity.id)).toEqual([db.clients[0]!.id]);
    expect(db.documents.find((row) => row.id === doc.id)?.archivedAt).toBeNull();
  });

  it("logs LINK and UNLINK only when something changed", async () => {
    const { ctx, db } = makeTestContext();
    const doc = await createDocument(ctx, draft(db));
    const target = { entityType: "CLIENT" as const, entityId: db.clients[1]!.id };
    const count = (action: string) =>
      db.activity.filter((entry) => entry.entityId === doc.id && entry.action === action).length;
    await linkDocument(ctx, { documentId: doc.id, target });
    await linkDocument(ctx, { documentId: doc.id, target });
    expect(count("LINK")).toBe(1);
    await unlinkDocument(ctx, { documentId: doc.id, target });
    await unlinkDocument(ctx, { documentId: doc.id, target });
    expect(count("UNLINK")).toBe(1);
  });

  it("refuses an unknown document or record", async () => {
    const { ctx, db } = makeTestContext();
    await expect(
      linkDocument(ctx, {
        documentId: "doc_missing",
        target: { entityType: "CLIENT", entityId: db.clients[0]!.id },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const doc = await createDocument(ctx, draft(db));
    await expect(
      linkDocument(ctx, {
        documentId: doc.id,
        target: { entityType: "CLIENT", entityId: "cli_missing" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ───────────────────────────── Wave 2 fix round (package 2.9) ─────────────────────────────

describe("type contract (F12)", () => {
  it("satisfies the five documents functions of H1-B2 over the mock context", () => {
    const service = documentsService satisfies Pick<
      DocumentsService<MockServiceContext>,
      "listDocuments" | "createDocument" | "uploadVersion" | "linkDocument" | "unlinkDocument"
    >;
    expect(typeof service.linkDocument).toBe("function");
  });
});

describe("archived link targets (CR-B1, C14/C19)", () => {
  const ARCHIVED_AT = "2026-10-01T00:00:00.000Z";
  const targets = (db: ReturnType<typeof makeTestContext>["db"]) =>
    [
      ["CLIENT", "cli_kairos", db.clients],
      ["CONTACT", db.contacts[0]!.id, db.contacts],
      ["PROJECT", "pry_kairos_web", db.projects],
    ] as const;

  it.each(["CLIENT", "CONTACT", "PROJECT"] as const)(
    "createDocument and linkDocument refuse an archived %s with NOT_FOUND",
    async (type) => {
      const { ctx, db } = makeTestContext();
      const [, id, rows] = targets(db).find(([t]) => t === type)!;
      const live = await createDocument(ctx, draft(db));
      (rows as { id: string; archivedAt: string | null }[]).find((r) => r.id === id)!.archivedAt =
        ARCHIVED_AT;
      const target = { entityType: type, entityId: id } as const;
      const count = db.documents.length;
      await expect(createDocument(ctx, draft(db, { links: [target] }))).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(db.documents).toHaveLength(count);
      await expect(
        linkDocument(ctx, { documentId: live.id, target }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    },
  );
});

describe("LINK and UNLINK metadata (CR-m7)", () => {
  it("carries the linked entity type and id on create, link and unlink", async () => {
    const { ctx, db } = makeTestContext();
    const created = await createDocument(
      ctx,
      draft(db, { links: [{ entityType: "CLIENT", entityId: "cli_kairos" }] }),
    );
    const target = { entityType: "PROJECT", entityId: "pry_kairos_web" } as const;
    await linkDocument(ctx, { documentId: created.id, target });
    await unlinkDocument(ctx, { documentId: created.id, target });
    const entries = db.activity.filter(
      (entry) =>
        entry.entityType === "DOCUMENT" &&
        entry.entityId === created.id &&
        (entry.action === "LINK" || entry.action === "UNLINK"),
    );
    expect(entries.map((entry) => [entry.action, entry.metadata])).toEqual([
      ["LINK", { entityType: "CLIENT", entityId: "cli_kairos" }],
      ["LINK", { entityType: "PROJECT", entityId: "pry_kairos_web" }],
      ["UNLINK", { entityType: "PROJECT", entityId: "pry_kairos_web" }],
    ]);
  });
});
