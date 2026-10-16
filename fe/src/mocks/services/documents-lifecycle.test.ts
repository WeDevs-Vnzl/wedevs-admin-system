// MOCK — tests for the H1-B4 documents service: versions (S5), statuses (S6), reads, overview (S7), atomic create
// and full-set category facets (S11 3005). The H1-B2 behaviour stays pinned in `documents.test.ts`.
import { describe, expect, it } from "vitest";
import {
  documentFilterSchema,
  type CreateDocumentInput,
  type DocumentsService,
} from "@/lib/validators/documents";
import type { ShareLinkDetailDTO } from "@/lib/validators/shares";
import type { MockServiceContext } from "../ctx";
import { FIXED_NOW, makeTestContext } from "../test-helpers";
import * as documentsService from "./documents";
import {
  archiveDocument,
  archiveDocuments,
  countDocumentsByCategory,
  createDocument,
  getDocument,
  getDocumentVersion,
  getDocumentsOverview,
  listDocuments,
  listDocumentVersions,
  publishVersion,
  restoreVersion,
  saveDraft,
  setDocumentStatus,
  updateDocumentMeta,
  uploadVersion,
} from "./documents";

type Db = ReturnType<typeof makeTestContext>["db"];

const NOW = FIXED_NOW.toISOString();
const doc = (db: Db, key: string) => db.documents.find((row) => row.id === `doc_${key}`)!;
const versionsOf = (db: Db, id: string) => db.documentVersions.filter((v) => v.documentId === id);
const entriesOf = (db: Db, id: string) => db.activity.filter((entry) => entry.entityId === id);
const typeWhere = (db: Db, pick: (t: Db["documentTypes"][number]) => boolean) =>
  db.documentTypes.find((t) => t.active && pick(t))!;

function draft(db: Db, overrides: Partial<CreateDocumentInput> = {}): CreateDocumentInput {
  return {
    title: "Contrato de soporte",
    typeId: typeWhere(db, (t) => t.defaultFormat === "ARCHIVO").id,
    summary: undefined,
    alertDaysBefore: 30,
    tagIds: [],
    links: [],
    ...overrides,
  };
}

describe("type contract", () => {
  it("implements every DocumentsService function over the mock context", () => {
    const service = documentsService satisfies DocumentsService<MockServiceContext>;
    expect(typeof service.getDocumentsOverview).toBe("function");
  });
});

describe("saveDraft (S5: autosave creates no version)", () => {
  it("stores the draft and its time, creates no version and logs nothing", async () => {
    const { ctx, db } = makeTestContext();
    const row = doc(db, "tsd_andina");
    const versions = versionsOf(db, row.id).length;
    const activity = db.activity.length;

    const result = await saveDraft(ctx, { documentId: row.id, content: "# TSD\n\nNuevo texto" });

    expect(result).toEqual({ documentId: row.id, draftUpdatedAt: NOW });
    expect(row.draftContent).toBe("# TSD\n\nNuevo texto");
    expect(row.draftUpdatedAt).toBe(NOW);
    expect(versionsOf(db, row.id)).toHaveLength(versions);
    expect(db.activity).toHaveLength(activity);
  });

  it("refuses a FIRMADO document (INTEGRITY_LOCK) and an unknown one (NOT_FOUND)", async () => {
    const { ctx, db } = makeTestContext();
    const signed = doc(db, "contrato_kairos");
    await expect(saveDraft(ctx, { documentId: signed.id, content: "x" })).rejects.toMatchObject({
      code: "INTEGRITY_LOCK",
    });
    expect(signed.draftContent).toBeNull();
    await expect(saveDraft(ctx, { documentId: "doc_missing", content: "x" })).rejects.toMatchObject(
      {
        code: "NOT_FOUND",
      },
    );
  });
});

describe("publishVersion (S5: immutable N+1, current, optional changelog)", () => {
  it("freezes the stored draft as version N+1, makes it current and clears the draft", async () => {
    const { ctx, db } = makeTestContext();
    const row = doc(db, "tsd_andina");
    const before = structuredClone(versionsOf(db, row.id));
    const draftText = row.draftContent;

    const detail = await publishVersion(ctx, { documentId: row.id, changelog: "Reintentos" });

    expect(detail.currentVersion).toMatchObject({
      versionNumber: before.length + 1,
      format: "MARKDOWN",
      content: draftText,
      changelog: "Reintentos",
      isCurrent: true,
    });
    expect(detail.versionCount).toBe(before.length + 1);
    expect(detail.draftContent).toBeNull();
    expect(row.currentVersionId).toBe(detail.currentVersion!.id);
    expect(row.draftContent).toBeNull();
    expect(row.draftUpdatedAt).toBeNull();
    expect(row.updatedAt).toBe(NOW);
    // Earlier versions are never rewritten.
    expect(versionsOf(db, row.id).slice(0, before.length)).toEqual(before);
    expect(entriesOf(db, row.id).at(-1)).toMatchObject({
      action: "VERSION_PUBLISH",
      metadata: { versionNumber: before.length + 1 },
    });
  });

  it("publishes the content the editor sends, without a changelog", async () => {
    const { ctx, db } = makeTestContext();
    const row = doc(db, "prd_kairos_web");
    const detail = await publishVersion(ctx, {
      documentId: row.id,
      content: "# PRD v4",
      changelog: undefined,
    });
    expect(detail.currentVersion).toMatchObject({
      versionNumber: 4,
      content: "# PRD v4",
      changelog: null,
    });
  });

  it("refuses an empty draft (VALIDATION) and a FIRMADO document (INTEGRITY_LOCK)", async () => {
    const { ctx, db } = makeTestContext();
    const row = doc(db, "roadmap_harbor");
    const count = db.documentVersions.length;
    await expect(
      publishVersion(ctx, { documentId: row.id, changelog: undefined }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { content: expect.any(Array) },
    });
    row.status = "FIRMADO";
    await expect(
      publishVersion(ctx, { documentId: row.id, content: "# x", changelog: undefined }),
    ).rejects.toMatchObject({ code: "INTEGRITY_LOCK" });
    expect(db.documentVersions).toHaveLength(count);
  });
});

describe("restoreVersion (S5: restoring copies the chosen version)", () => {
  it("creates a new current version copying the chosen one; history is untouched", async () => {
    const { ctx, db } = makeTestContext();
    const row = doc(db, "prd_kairos_web");
    const first = structuredClone(versionsOf(db, row.id).find((v) => v.versionNumber === 1)!);

    const detail = await restoreVersion(ctx, {
      documentId: row.id,
      versionId: first.id,
      changelog: undefined,
    });

    expect(detail.currentVersion).toMatchObject({
      versionNumber: 4,
      format: "MARKDOWN",
      content: first.content,
      isCurrent: true,
    });
    expect(versionsOf(db, row.id)).toHaveLength(4);
    expect(versionsOf(db, row.id).find((v) => v.id === first.id)).toEqual(first);
    expect(entriesOf(db, row.id).at(-1)).toMatchObject({
      action: "VERSION_PUBLISH",
      metadata: { versionNumber: 4, restoredFrom: 1 },
    });
  });

  it("copies the file of an ARCHIVO version", async () => {
    const { ctx, db } = makeTestContext();
    const row = doc(db, "cotizacion_tornillo");
    const only = versionsOf(db, row.id)[0]!;
    const detail = await restoreVersion(ctx, {
      documentId: row.id,
      versionId: only.id,
      changelog: "Reenvío",
    });
    expect(detail.currentVersion).toMatchObject({ versionNumber: 2, changelog: "Reenvío" });
    expect(detail.currentVersion?.file?.id).toBe(only.fileId);
  });

  it("refuses a version of another document (NOT_FOUND) and a FIRMADO document", async () => {
    const { ctx, db } = makeTestContext();
    const other = versionsOf(db, doc(db, "tsd_andina").id)[0]!;
    await expect(
      restoreVersion(ctx, {
        documentId: doc(db, "prd_kairos_web").id,
        versionId: other.id,
        changelog: undefined,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const signed = doc(db, "contrato_kairos");
    await expect(
      restoreVersion(ctx, {
        documentId: signed.id,
        versionId: versionsOf(db, signed.id)[0]!.id,
        changelog: undefined,
      }),
    ).rejects.toMatchObject({ code: "INTEGRITY_LOCK" });
    expect(versionsOf(db, signed.id)).toHaveLength(2);
  });
});

describe("uploadVersion (S5: update link)", () => {
  it("adds an ENLACE version with the new URL", async () => {
    const { ctx, db } = makeTestContext();
    const row = doc(db, "credenciales_kairos");
    const detail = await uploadVersion(ctx, {
      format: "ENLACE",
      documentId: row.id,
      url: "https://vault.example.com/shared/kairos-staging-2",
      changelog: "Nuevo ítem",
    });
    expect(detail.currentVersion).toMatchObject({
      versionNumber: 2,
      format: "ENLACE",
      url: "https://vault.example.com/shared/kairos-staging-2",
      file: null,
      changelog: "Nuevo ítem",
    });
    expect(entriesOf(db, row.id).at(-1)).toMatchObject({
      action: "VERSION_PUBLISH",
      metadata: { versionNumber: 2 },
    });
  });

  it("refuses a URL that is not http(s)", async () => {
    const { ctx, db } = makeTestContext();
    const row = doc(db, "credenciales_kairos");
    await expect(
      uploadVersion(ctx, {
        format: "ENLACE",
        documentId: row.id,
        url: "javascript:alert(1)",
        changelog: undefined,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { url: expect.any(Array) } });
    expect(versionsOf(db, row.id)).toHaveLength(1);
  });
});

describe("setDocumentStatus (S6)", () => {
  it("follows an allowed transition and logs STATUS_CHANGE", async () => {
    const { ctx, db } = makeTestContext();
    const row = doc(db, "minuta_solaris");
    const detail = await setDocumentStatus(ctx, { id: row.id, status: "EN_REVISION" });
    expect(detail.status).toBe("EN_REVISION");
    expect(row.status).toBe("EN_REVISION");
    expect(row.updatedAt).toBe(NOW);
    expect(entriesOf(db, row.id).at(-1)).toMatchObject({
      action: "STATUS_CHANGE",
      changes: { status: ["BORRADOR", "EN_REVISION"] },
    });
  });

  it("refuses a transition the table does not allow, and VENCIDO", async () => {
    const { ctx, db } = makeTestContext();
    const row = doc(db, "minuta_solaris");
    const activity = db.activity.length;
    await expect(setDocumentStatus(ctx, { id: row.id, status: "APROBADO" })).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { status: expect.any(Array) },
    });
    await expect(
      setDocumentStatus(ctx, { id: row.id, status: "VENCIDO" as "ANULADO" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(row.status).toBe("BORRADOR");
    expect(db.activity).toHaveLength(activity);
  });

  it("FIRMADO needs a signature type and the signature date, which it stores", async () => {
    const { ctx, db } = makeTestContext();
    const sent = doc(db, "cotizacion_tornillo"); // ENVIADO, type without signature
    await expect(
      setDocumentStatus(ctx, { id: sent.id, status: "FIRMADO", signedAt: "2026-10-08" }),
    ).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { status: expect.any(Array) } });

    const contract = await createDocument(
      ctx,
      draft(db, { typeId: "dtyp_contrato_servicios", title: "Contrato a firmar" }),
    );
    const row = db.documents.find((item) => item.id === contract.id)!;
    row.status = "ENVIADO";
    await expect(setDocumentStatus(ctx, { id: row.id, status: "FIRMADO" })).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { signedAt: expect.any(Array) },
    });

    const signed = await setDocumentStatus(ctx, {
      id: row.id,
      status: "FIRMADO",
      signedAt: "2026-10-08",
    });
    expect(signed).toMatchObject({ status: "FIRMADO", signedAt: "2026-10-08" });
    expect(row.signedAt).toBe("2026-10-08");
    expect(entriesOf(db, row.id).at(-1)).toMatchObject({
      action: "STATUS_CHANGE",
      changes: { status: ["ENVIADO", "FIRMADO"], signedAt: [null, "2026-10-08"] },
    });
  });
});

describe("updateDocumentMeta", () => {
  it("updates the metadata and logs UPDATE with the changed fields", async () => {
    const { ctx, db } = makeTestContext();
    const row = doc(db, "cotizacion_tornillo");
    const detail = await updateDocumentMeta(ctx, {
      id: row.id,
      title: "Cotización revisada — El Tornillo",
      typeId: row.typeId,
      summary: row.summary ?? undefined,
      effectiveDate: row.effectiveDate ?? undefined,
      expiresAt: row.expiresAt ?? undefined,
      alertDaysBefore: 10,
      tagIds: [],
    });
    expect(detail).toMatchObject({
      title: "Cotización revisada — El Tornillo",
      alertDaysBefore: 10,
    });
    expect(row.updatedAt).toBe(NOW);
    expect(entriesOf(db, row.id).at(-1)).toMatchObject({
      action: "UPDATE",
      changes: {
        title: ["Cotización — Tienda El Tornillo", "Cotización revisada — El Tornillo"],
        alertDaysBefore: ["15", "10"],
      },
    });
  });

  it("applies the type rules, including the current FIRMADO status", async () => {
    const { ctx, db } = makeTestContext();
    const plain = doc(db, "roadmap_harbor");
    const base = {
      id: plain.id,
      title: plain.title,
      typeId: plain.typeId,
      summary: undefined,
      alertDaysBefore: 30,
      tagIds: [],
    };
    await expect(
      updateDocumentMeta(ctx, { ...base, expiresAt: "2027-01-01" }),
    ).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { expiresAt: expect.any(Array) } });

    const signed = doc(db, "acta_entrega_aurora");
    await expect(
      updateDocumentMeta(ctx, {
        ...base,
        id: signed.id,
        title: signed.title,
        typeId: "dtyp_minuta",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { status: expect.any(Array) } });
    expect(signed.typeId).toBe("dtyp_acta_entrega");
  });
});

describe("archiveDocument and archiveDocuments", () => {
  it("archives a document, logs DELETE and drops it from the list", async () => {
    const { ctx, db } = makeTestContext();
    const row = doc(db, "minuta_solaris");
    expect(await archiveDocument(ctx, { id: row.id })).toEqual({ id: row.id, archivedAt: NOW });
    expect(row).toMatchObject({ archivedAt: NOW, deletedById: ctx.user.id });
    expect(entriesOf(db, row.id).at(-1)?.action).toBe("DELETE");
    const page = await listDocuments(ctx, documentFilterSchema.parse({ pageSize: 100 }));
    expect(page.items.map((item) => item.id)).not.toContain(row.id);
    await expect(archiveDocument(ctx, { id: row.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("archives a selection all or nothing", async () => {
    const { ctx, db } = makeTestContext();
    const a = doc(db, "minuta_solaris");
    const b = doc(db, "roadmap_harbor");
    await expect(archiveDocuments(ctx, { ids: [a.id, "doc_missing"] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(a.archivedAt).toBeNull();
    const result = await archiveDocuments(ctx, { ids: [a.id, b.id] });
    expect(result.archived).toEqual([
      { id: a.id, archivedAt: NOW },
      { id: b.id, archivedAt: NOW },
    ]);
    expect(b.archivedAt).toBe(NOW);
  });
});

describe("getDocument, listDocumentVersions and getDocumentVersion", () => {
  it("reads the detail; archived ones only for roles that open the trash", async () => {
    const { ctx, db } = makeTestContext("MEMBER");
    const row = doc(db, "prd_kairos_web");
    expect(await getDocument(ctx, { id: row.id })).toMatchObject({ id: row.id, versionCount: 3 });
    await expect(getDocument(ctx, { id: "doc_missing" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    row.archivedAt = NOW;
    await expect(getDocument(ctx, { id: row.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const owner = makeTestContext("OWNER");
    doc(owner.db, "prd_kairos_web").archivedAt = NOW;
    expect(await getDocument(owner.ctx, { id: row.id })).toMatchObject({ archivedAt: NOW });
  });

  it("lists versions newest first without content, flagging the current one", async () => {
    const { ctx, db } = makeTestContext();
    const row = doc(db, "prd_kairos_web");
    const versions = await listDocumentVersions(ctx, { documentId: row.id });
    expect(versions.map((v) => [v.versionNumber, v.isCurrent])).toEqual([
      [3, true],
      [2, false],
      [1, false],
    ]);
    expect(versions[0]).not.toHaveProperty("content");
    expect(versions[0]?.createdBy.name).toBeTruthy();
  });

  it("reads one version with its content; a version of another document is NOT_FOUND", async () => {
    const { ctx, db } = makeTestContext();
    const row = doc(db, "prd_kairos_web");
    const first = versionsOf(db, row.id)[0]!;
    expect(
      await getDocumentVersion(ctx, { documentId: row.id, versionId: first.id }),
    ).toMatchObject({ versionNumber: 1, content: first.content, isCurrent: false });
    await expect(
      getDocumentVersion(ctx, { documentId: doc(db, "tsd_andina").id, versionId: first.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("getDocumentsOverview (S7)", () => {
  it("counts by category and status, expiring windows, recent and stale drafts", async () => {
    const { ctx, db } = makeTestContext();
    const overview = await getDocumentsOverview(ctx);

    const legal = overview.byCategoryAndStatus.find((item) => item.category.id === "dcat_legal");
    expect(legal?.countByStatus).toEqual({ FIRMADO: 3 });
    const total = overview.byCategoryAndStatus
      .flatMap((item) => Object.values(item.countByStatus))
      .reduce((sum, n) => sum + n, 0);
    expect(total).toBe(db.documents.filter((row) => row.archivedAt === null).length);

    expect(overview.expiringCounts).toEqual({ days30: 1, days60: 2, days90: 3 });
    expect(overview.expiringSoon.map((row) => row.id)).toEqual([
      "doc_nda_tamanaco",
      "doc_propuesta_aurora",
      "doc_cotizacion_tornillo",
    ]);
    expect(overview.staleDrafts.map((row) => row.id)).toEqual(["doc_arquitectura_tamanaco"]);
    expect(overview.recent.length).toBeLessThanOrEqual(5);
    const times = overview.recent.map((row) => row.updatedAt);
    expect(times).toEqual([...times].sort().reverse());
    expect(overview.recent[0]?.id).toBe("doc_minuta_solaris");
  });
});

describe("createDocument (H1-B4 formats and the atomic first version, S11 3005)", () => {
  it("leaves nothing behind when the first file is not usable", async () => {
    const { ctx, db } = makeTestContext();
    const sizes = [db.documents.length, db.documentLinks.length, db.activity.length];
    const sequence = db.sequences.DOC;
    await expect(
      createDocument(
        ctx,
        draft(db, { links: [{ entityType: "CLIENT", entityId: "cli_kairos" }] }),
        { format: "ARCHIVO", fileId: "fil_missing" },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect([db.documents.length, db.documentLinks.length, db.activity.length]).toEqual(sizes);
    expect(db.sequences.DOC).toBe(sequence);
  });

  it("creates the document with its file as version 1 in one call", async () => {
    const { ctx, db } = makeTestContext();
    const file = db.files.find((row) => row.status === "READY")!;
    const created = await createDocument(
      ctx,
      draft(db, { links: [{ entityType: "CLIENT", entityId: "cli_kairos" }] }),
      { format: "ARCHIVO", fileId: file.id },
    );
    expect(created.currentVersion).toMatchObject({ versionNumber: 1, format: "ARCHIVO" });
    expect(created.currentVersion?.file?.id).toBe(file.id);
    expect(created.versionCount).toBe(1);
    expect(entriesOf(db, created.id).map((entry) => entry.action)).toEqual([
      "CREATE",
      "LINK",
      "UPLOAD",
    ]);
  });

  it("creates MARKDOWN documents with no version and ENLACE documents with their URL", async () => {
    const { ctx, db } = makeTestContext();
    const markdown = await createDocument(ctx, draft(db, { typeId: "dtyp_prd" }));
    expect(markdown).toMatchObject({ status: "BORRADOR", currentVersion: null, versionCount: 0 });
    const link = await createDocument(ctx, draft(db, { typeId: "dtyp_credenciales" }), {
      format: "ENLACE",
      url: "https://vault.example.com/shared/new",
    });
    expect(link.currentVersion).toMatchObject({
      format: "ENLACE",
      url: "https://vault.example.com/shared/new",
    });
  });
});

describe("listDocuments facets over the full set (S7, S11 3005)", () => {
  it("filters and counts categories over every document, not one page of 100", async () => {
    const { ctx, db } = makeTestContext();
    for (let i = 0; i < 101; i += 1) {
      await createDocument(ctx, draft(db, { typeId: "dtyp_prd", title: `PRD ${i}` }));
    }
    const technical = db.documents.filter((row) =>
      ["dtyp_prd", "dtyp_tsd", "dtyp_roadmap", "dtyp_arquitectura", "dtyp_manual_usuario"].includes(
        row.typeId,
      ),
    ).length;

    const page = await listDocuments(
      ctx,
      documentFilterSchema.parse({ categoryId: "dcat_tecnico", pageSize: 25 }),
    );
    expect(page.total).toBe(technical);
    expect(page.items).toHaveLength(25);

    const counts = await countDocumentsByCategory(
      ctx,
      documentFilterSchema.parse({ categoryId: "dcat_legal", pageSize: 25 }),
    );
    expect(counts.dcat_tecnico).toBe(technical);
    expect(counts.dcat_legal).toBe(3);
    const sum = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(db.documents.filter((row) => row.archivedAt === null).length);
  });

  it("applies the overview shortcuts: expiring within N days, stale drafts and shared", async () => {
    const { ctx, db } = makeTestContext();
    const ids = async (filter: Record<string, unknown>) =>
      (await listDocuments(ctx, documentFilterSchema.parse({ ...filter, pageSize: 100 }))).items
        .map((row) => row.id)
        .sort();
    expect(await ids({ expiringWithinDays: 60 })).toEqual([
      "doc_nda_tamanaco",
      "doc_propuesta_aurora",
    ]);
    expect(await ids({ staleDraft: true })).toEqual(["doc_arquitectura_tamanaco"]);
    expect(await ids({ shared: true })).toEqual([]);
    db.shareLinks.push({
      status: "ACTIVE",
      documents: [{ document: { id: "doc_prd_kairos_web" } }],
    } as unknown as ShareLinkDetailDTO);
    expect(await ids({ shared: true })).toEqual(["doc_prd_kairos_web"]);
    expect(await ids({ shared: false })).not.toContain("doc_prd_kairos_web");
  });
});
