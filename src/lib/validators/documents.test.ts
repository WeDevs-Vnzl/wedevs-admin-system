import type { DocumentsService } from "./documents";
import { describe, expect, it } from "vitest";
import { VALIDATION_MESSAGES } from "./common";
import { DOCUMENT_STATUS_VALUES } from "./enums";
import {
  DOCUMENT_CONTENT_MAX,
  DOCUMENT_STATUS_TRANSITIONS,
  DOCUMENT_VALIDATION_MESSAGES,
  canTransitionDocument,
  createDocumentInputSchema,
  createDocumentInputSchemaFor,
  documentDetailSchema,
  documentFilterSchema,
  documentListRowSchema,
  documentTypeRuleIssues,
  documentVersionRowSchema,
  getDocumentVersionInputSchema,
  linkDocumentInputSchema,
  publishVersionInputSchema,
  restoreVersionInputSchema,
  saveDraftInputSchema,
  setDocumentStatusInputSchema,
  setDocumentStatusInputSchemaFor,
  updateDocumentMetaInputSchema,
  updateDocumentMetaInputSchemaFor,
  uploadVersionInputSchema,
} from "./documents";

const issues = (result: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  (result.error?.issues ?? []).map((i) => `${i.path.join(".")}:${i.message}`);

const plainType = { requiresSignature: false, hasExpiration: false };
const signedType = { requiresSignature: true, hasExpiration: false };
const expiringType = { requiresSignature: false, hasExpiration: true };
const valid = { title: "Contrato de servicios — Kairos", typeId: "dtype_contract" };

describe("createDocument / updateDocumentMeta", () => {
  it("accepts the minimum and applies defaults (alert 30 days, no links)", () => {
    const parsed = createDocumentInputSchema.parse(valid);
    expect(parsed.alertDaysBefore).toBe(30);
    expect(parsed.links).toEqual([]);
    expect(parsed.tagIds).toEqual([]);
  });

  it("accepts links to clients, contacts, projects, invoices, payments and expenses", () => {
    const links = ["CLIENT", "CONTACT", "PROJECT", "INVOICE", "PAYMENT", "EXPENSE"].map(
      (entityType) => ({
        entityType,
        entityId: `${entityType.toLowerCase()}_1`,
      }),
    );
    expect(createDocumentInputSchema.safeParse({ ...valid, links }).success).toBe(true);
    expect(
      createDocumentInputSchema.safeParse({
        ...valid,
        links: [{ entityType: "NOTE", entityId: "n1" }],
      }).success,
    ).toBe(false);
    expect(
      createDocumentInputSchema.safeParse({ ...valid, links: [links[0], links[0]] }).success,
    ).toBe(false);
  });

  it("rejects blank titles, missing type, bad dates and out-of-range alert days", () => {
    expect(createDocumentInputSchema.safeParse({ ...valid, title: " " }).success).toBe(false);
    expect(createDocumentInputSchema.safeParse({ title: "x" }).success).toBe(false);
    expect(
      createDocumentInputSchema.safeParse({ ...valid, effectiveDate: "2026-13-01" }).success,
    ).toBe(false);
    expect(createDocumentInputSchema.safeParse({ ...valid, alertDaysBefore: -1 }).success).toBe(
      false,
    );
    expect(createDocumentInputSchema.safeParse({ ...valid, alertDaysBefore: 366 }).success).toBe(
      false,
    );
    expect(createDocumentInputSchema.safeParse({ ...valid, alertDaysBefore: 7.5 }).success).toBe(
      false,
    );
  });

  it("expiry cannot precede the effective date", () => {
    expect(
      issues(
        createDocumentInputSchema.safeParse({
          ...valid,
          effectiveDate: "2026-10-10",
          expiresAt: "2026-10-01",
        }),
      ),
    ).toEqual([`expiresAt:${VALIDATION_MESSAGES.invalidDate}`]);
  });

  it("update needs an id", () => {
    expect(updateDocumentMetaInputSchema.safeParse({ id: "doc_1", ...valid }).success).toBe(true);
    expect(updateDocumentMetaInputSchema.safeParse(valid).success).toBe(false);
  });
});

describe("type rules: signedAt only with signature, expiresAt only with expiration", () => {
  const dates = { signedAt: "2026-09-01", expiresAt: "2027-09-01" };

  it("documentTypeRuleIssues reports each violation on its field", () => {
    expect(documentTypeRuleIssues(plainType, dates)).toEqual([
      { path: "signedAt", message: DOCUMENT_VALIDATION_MESSAGES.signedAtNotAllowed },
      { path: "expiresAt", message: DOCUMENT_VALIDATION_MESSAGES.expiresAtNotAllowed },
    ]);
    expect(documentTypeRuleIssues({ requiresSignature: true, hasExpiration: true }, dates)).toEqual(
      [],
    );
    expect(documentTypeRuleIssues(plainType, { status: "FIRMADO" })).toEqual([
      { path: "status", message: DOCUMENT_VALIDATION_MESSAGES.signedStatusNotAllowed },
    ]);
  });

  it("createDocumentInputSchemaFor enforces them", () => {
    expect(
      createDocumentInputSchemaFor(plainType).safeParse({ ...valid, signedAt: "2026-09-01" })
        .success,
    ).toBe(false);
    expect(
      createDocumentInputSchemaFor(signedType).safeParse({ ...valid, signedAt: "2026-09-01" })
        .success,
    ).toBe(true);
    expect(
      createDocumentInputSchemaFor(signedType).safeParse({ ...valid, expiresAt: "2027-09-01" })
        .success,
    ).toBe(false);
    expect(
      createDocumentInputSchemaFor(expiringType).safeParse({ ...valid, expiresAt: "2027-09-01" })
        .success,
    ).toBe(true);
    expect(createDocumentInputSchemaFor(plainType).safeParse(valid).success).toBe(true);
  });

  it("updateDocumentMetaInputSchemaFor enforces them too", () => {
    const input = { id: "doc_1", ...valid, expiresAt: "2027-09-01" };
    expect(updateDocumentMetaInputSchemaFor(plainType).safeParse(input).success).toBe(false);
    expect(updateDocumentMetaInputSchemaFor(expiringType).safeParse(input).success).toBe(true);
  });
});

describe("setDocumentStatus", () => {
  it("FIRMADO requires the signature date", () => {
    expect(
      issues(setDocumentStatusInputSchema.safeParse({ id: "doc_1", status: "FIRMADO" })),
    ).toEqual([`signedAt:${VALIDATION_MESSAGES.required}`]);
    expect(
      setDocumentStatusInputSchema.safeParse({
        id: "doc_1",
        status: "FIRMADO",
        signedAt: "2026-09-01",
      }).success,
    ).toBe(true);
  });

  it("FIRMADO only exists on types with signature", () => {
    const input = { id: "doc_1", status: "FIRMADO", signedAt: "2026-09-01" };
    expect(setDocumentStatusInputSchemaFor(signedType).safeParse(input).success).toBe(true);
    const result = setDocumentStatusInputSchemaFor(plainType).safeParse(input);
    expect(result.success).toBe(false);
    expect(issues(result)).toContain(
      `status:${DOCUMENT_VALIDATION_MESSAGES.signedStatusNotAllowed}`,
    );
    expect(
      setDocumentStatusInputSchemaFor(plainType).safeParse({ id: "doc_1", status: "APROBADO" })
        .success,
    ).toBe(true);
  });

  it("VENCIDO is assigned by the daily job, never by a person", () => {
    expect(setDocumentStatusInputSchema.safeParse({ id: "doc_1", status: "VENCIDO" }).success).toBe(
      false,
    );
    expect(setDocumentStatusInputSchema.safeParse({ id: "doc_1", status: "ANULADO" }).success).toBe(
      true,
    );
  });

  it("transition table follows PRD §8.9.4", () => {
    expect(Object.keys(DOCUMENT_STATUS_TRANSITIONS).sort()).toEqual(
      [...DOCUMENT_STATUS_VALUES].sort(),
    );
    const caps = signedType;
    expect(canTransitionDocument("BORRADOR", "EN_REVISION", caps)).toBe(true);
    expect(canTransitionDocument("EN_REVISION", "BORRADOR", caps)).toBe(true);
    expect(canTransitionDocument("EN_REVISION", "APROBADO", caps)).toBe(true);
    expect(canTransitionDocument("APROBADO", "ENVIADO", caps)).toBe(true);
    expect(canTransitionDocument("ENVIADO", "FIRMADO", caps)).toBe(true);
    expect(canTransitionDocument("ENVIADO", "FIRMADO", plainType)).toBe(false);
    expect(canTransitionDocument("BORRADOR", "APROBADO", caps)).toBe(false);
    expect(canTransitionDocument("BORRADOR", "FIRMADO", caps)).toBe(false);
    for (const status of DOCUMENT_STATUS_VALUES) {
      expect(canTransitionDocument(status, "ANULADO", caps), status).toBe(
        status !== "VENCIDO" && status !== "ANULADO",
      );
      expect(canTransitionDocument("VENCIDO", status, caps)).toBe(false);
    }
  });
});

describe("versions and draft", () => {
  it("saveDraft takes any markdown up to the cap (even empty)", () => {
    expect(saveDraftInputSchema.safeParse({ documentId: "doc_1", content: "" }).success).toBe(true);
    expect(
      saveDraftInputSchema.safeParse({ documentId: "doc_1", content: "# Título" }).success,
    ).toBe(true);
    expect(
      saveDraftInputSchema.safeParse({
        documentId: "doc_1",
        content: "x".repeat(DOCUMENT_CONTENT_MAX + 1),
      }).success,
    ).toBe(false);
  });

  it("publishVersion: optional content and changelog ≤ 500", () => {
    expect(publishVersionInputSchema.safeParse({ documentId: "doc_1" }).success).toBe(true);
    expect(
      publishVersionInputSchema.safeParse({
        documentId: "doc_1",
        changelog: "Cambios",
        content: "# A",
      }).success,
    ).toBe(true);
    expect(publishVersionInputSchema.safeParse({ documentId: "doc_1", content: "" }).success).toBe(
      false,
    );
    expect(
      publishVersionInputSchema.safeParse({ documentId: "doc_1", changelog: "x".repeat(501) })
        .success,
    ).toBe(false);
  });

  it("uploadVersion is a file or a valid http(s) link", () => {
    expect(
      uploadVersionInputSchema.safeParse({ format: "ARCHIVO", documentId: "doc_1", fileId: "f1" })
        .success,
    ).toBe(true);
    expect(
      uploadVersionInputSchema.safeParse({
        format: "ENLACE",
        documentId: "doc_1",
        url: "https://drive.example/doc",
      }).success,
    ).toBe(true);
    for (const url of ["javascript:alert(1)", "drive.example/doc", ""]) {
      expect(
        uploadVersionInputSchema.safeParse({ format: "ENLACE", documentId: "doc_1", url }).success,
        url,
      ).toBe(false);
    }
    expect(
      uploadVersionInputSchema.safeParse({ format: "ARCHIVO", documentId: "doc_1" }).success,
    ).toBe(false);
    expect(
      uploadVersionInputSchema.safeParse({ format: "MARKDOWN", documentId: "doc_1" }).success,
    ).toBe(false);
  });

  it("restoreVersion and getDocumentVersion", () => {
    expect(
      restoreVersionInputSchema.safeParse({ documentId: "doc_1", versionId: "v1" }).success,
    ).toBe(true);
    expect(restoreVersionInputSchema.safeParse({ documentId: "doc_1" }).success).toBe(false);
    expect(
      getDocumentVersionInputSchema.safeParse({ documentId: "doc_1", versionId: "v1" }).success,
    ).toBe(true);
  });

  it("linkDocument targets one record", () => {
    expect(
      linkDocumentInputSchema.safeParse({
        documentId: "doc_1",
        target: { entityType: "PROJECT", entityId: "pry_1" },
      }).success,
    ).toBe(true);
    expect(
      linkDocumentInputSchema.safeParse({
        documentId: "doc_1",
        target: { entityType: "TAG", entityId: "t1" },
      }).success,
    ).toBe(false);
  });

  it("version row DTO", () => {
    expect(
      documentVersionRowSchema.safeParse({
        id: "v1",
        documentId: "doc_1",
        versionNumber: 1,
        format: "MARKDOWN",
        file: null,
        url: null,
        changelog: null,
        createdBy: { id: "usr_1", name: "Andrés", imageUrl: null },
        createdAt: "2026-10-01T10:00:00.000Z",
        isCurrent: true,
      }).success,
    ).toBe(true);
    expect(
      documentVersionRowSchema.safeParse({ id: "v1", documentId: "doc_1", versionNumber: 0 })
        .success,
    ).toBe(false);
  });
});

describe("document filters and DTOs", () => {
  it("filters by status, category, type, format, links, expiry and shared", () => {
    const parsed = documentFilterSchema.parse({
      status: ["BORRADOR", "APROBADO"],
      format: "MARKDOWN",
      expiringWithinDays: "30",
      shared: "false",
      sort: "expiresAt:asc",
    });
    expect(parsed.status).toEqual(["BORRADOR", "APROBADO"]);
    expect(parsed.format).toEqual(["MARKDOWN"]);
    expect(parsed.expiringWithinDays).toBe(30);
    expect(parsed.shared).toBe(false);
    expect(documentFilterSchema.safeParse({ status: "OK" }).success).toBe(false);
    expect(documentFilterSchema.safeParse({ sort: "draftContent:asc" }).success).toBe(false);
  });

  const category = { id: "cat_legal", name: "Legal", nameEn: null, color: null };
  const type = {
    id: "dtype_contract",
    name: "Contrato",
    nameEn: null,
    requiresSignature: true,
    hasExpiration: true,
    defaultFormat: "ARCHIVO",
  };
  const row = {
    id: "doc_1",
    code: "DOC-0001",
    title: "Contrato",
    category,
    type,
    status: "BORRADOR",
    currentFormat: null,
    currentVersionNumber: null,
    links: [],
    expiresAt: null,
    isShared: false,
    tags: [],
    updatedAt: "2026-10-01T10:00:00.000Z",
    archivedAt: null,
  };

  it("list row and detail DTOs", () => {
    expect(documentListRowSchema.safeParse(row).success).toBe(true);
    expect(
      documentListRowSchema.safeParse({ ...row, status: "FIRMADO ", currentFormat: "PDF" }).success,
    ).toBe(false);
    expect(
      documentDetailSchema.safeParse({
        ...row,
        summary: null,
        effectiveDate: null,
        signedAt: null,
        alertDaysBefore: 30,
        currentVersion: null,
        versionCount: 0,
        draftContent: null,
        draftUpdatedAt: null,
        createdBy: null,
        createdAt: "2026-10-01T10:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});

describe("DocumentsService (PRD §12 service names)", () => {
  it("declares every service of the module with its exact name", () => {
    const names = [
      "createDocument",
      "updateDocumentMeta",
      "saveDraft",
      "publishVersion",
      "uploadVersion",
      "restoreVersion",
      "setDocumentStatus",
      "linkDocument",
      "unlinkDocument",
    ] as const satisfies readonly (keyof DocumentsService)[];
    expect(new Set(names).size).toBe(names.length);
  });
});
