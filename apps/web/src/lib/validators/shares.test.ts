import { describe, expect, it } from "vitest";
import { z } from "./zod";
import {
  SHARE_TOKEN_LENGTH,
  createShareLinkInputSchema,
  generatedAccessKeySchema,
  setShareDocumentAccessKeyInputSchema,
  setShareDocumentAccessKeyResultSchema,
  shareAccessLogFilterSchema,
  shareAccessLogRowSchema,
  shareCountersSchema,
  shareDocumentSchema,
  shareFilterSchema,
  shareLinkDetailSchema,
  shareLinkListRowSchema,
  shareLinkMutationResultSchema,
  shareTokenSchema,
  updateShareLinkInputSchema,
} from "./shares";

const TOKEN = "A".repeat(SHARE_TOKEN_LENGTH);
const TS = "2026-10-01T10:00:00.000Z";
const user = { id: "usr_1", name: "Andrés Molina", imageUrl: null };
const doc = { id: "doc_1", code: "DOC-0001", label: "Contrato", type: "DOCUMENT" };
const counters = { viewCount: 3, downloadCount: 1, unlockCount: 1, failedUnlockCount: 2 };

/** Every property name that appears anywhere in a schema (its JSON Schema), so a stray field is caught. */
function propertyNames(schema: z.ZodType): string[] {
  const names = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== "object" || node === null) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "properties" && typeof value === "object" && value !== null) {
        for (const name of Object.keys(value)) names.add(name);
      }
      walk(value);
    }
  };
  walk(z.toJSONSchema(schema, { unrepresentable: "any", io: "output" }));
  return [...names];
}

/** A key, hash, salt or secret: forbidden in any read DTO (C5, C22). */
const SECRET_FIELD = /^(accessKey|key)$|hash|salt|secret|password/i;

describe("share token", () => {
  it("is 43 base64url characters", () => {
    expect(shareTokenSchema.safeParse(TOKEN).success).toBe(true);
    expect(shareTokenSchema.safeParse("Ab-_".repeat(10) + "Abc").success).toBe(true);
    for (const bad of [
      TOKEN.slice(1),
      `${TOKEN}A`,
      `${"A".repeat(42)}+`,
      `${"A".repeat(42)}=`,
      "",
      "../etc",
    ]) {
      expect(shareTokenSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("createShareLink / updateShareLink", () => {
  const valid = {
    title: "Documentación contractual — Proyecto X",
    documents: [{ documentId: "doc_1" }],
  };

  it("accepts the minimum and applies defaults (download allowed, ES, latest version, no key)", () => {
    const parsed = createShareLinkInputSchema.parse(valid);
    expect(parsed.allowDownload).toBe(true);
    expect(parsed.locale).toBe("es");
    expect(parsed.documents[0]).toEqual({
      documentId: "doc_1",
      versionId: null,
      requiresAccessKey: false,
    });
    expect(parsed.message).toBeUndefined();
    expect(parsed.expiresAt).toBeUndefined();
  });

  it("accepts pinned versions, per-document keys, client, locale and expiry", () => {
    const parsed = createShareLinkInputSchema.parse({
      ...valid,
      message: "Adjuntamos los documentos",
      clientId: "cli_1",
      locale: "en",
      allowDownload: false,
      expiresAt: "2026-12-31",
      documents: [
        { documentId: "doc_1", versionId: "ver_2", requiresAccessKey: true },
        { documentId: "doc_2", versionId: null },
      ],
    });
    expect(parsed.documents.map((d) => d.requiresAccessKey)).toEqual([true, false]);
    expect(parsed.documents[0]?.versionId).toBe("ver_2");
    expect(parsed.locale).toBe("en");
  });

  it("rejects blank titles, no documents, repeated documents, bad locale and bad expiry", () => {
    expect(createShareLinkInputSchema.safeParse({ ...valid, title: " " }).success).toBe(false);
    expect(createShareLinkInputSchema.safeParse({ ...valid, documents: [] }).success).toBe(false);
    expect(createShareLinkInputSchema.safeParse({ title: "x" }).success).toBe(false);
    expect(
      createShareLinkInputSchema.safeParse({
        ...valid,
        documents: [{ documentId: "d" }, { documentId: "d" }],
      }).success,
    ).toBe(false);
    expect(createShareLinkInputSchema.safeParse({ ...valid, locale: "fr" }).success).toBe(false);
    expect(
      createShareLinkInputSchema.safeParse({ ...valid, expiresAt: "2026-02-30" }).success,
    ).toBe(false);
    expect(
      createShareLinkInputSchema.safeParse({ ...valid, message: "x".repeat(2001) }).success,
    ).toBe(false);
  });

  it("updateShareLink needs an id and keeps the rules", () => {
    expect(updateShareLinkInputSchema.safeParse({ id: "shr_1", ...valid }).success).toBe(true);
    expect(updateShareLinkInputSchema.safeParse(valid).success).toBe(false);
    expect(
      updateShareLinkInputSchema.safeParse({ id: "shr_1", ...valid, documents: [] }).success,
    ).toBe(false);
  });
});

describe("setShareDocumentAccessKey", () => {
  const base = { shareLinkId: "shr_1", documentId: "doc_1" };

  it.each(["generate", "regenerate", "remove"])("accepts %s", (action) => {
    expect(setShareDocumentAccessKeyInputSchema.safeParse({ ...base, action }).success).toBe(true);
  });

  it("rejects other actions; the input never carries a key", () => {
    expect(setShareDocumentAccessKeyInputSchema.safeParse({ ...base, action: "set" }).success).toBe(
      false,
    );
    expect(setShareDocumentAccessKeyInputSchema.safeParse(base).success).toBe(false);
    expect(propertyNames(setShareDocumentAccessKeyInputSchema)).not.toContain("accessKey");
    // A smuggled key is stripped, not accepted.
    expect(
      setShareDocumentAccessKeyInputSchema.parse({
        ...base,
        action: "generate",
        accessKey: "hunter2hunter2",
      }),
    ).toEqual({ ...base, action: "generate" });
  });

  it("returns the clear key once: present for generate/regenerate, null for remove", () => {
    const result = {
      ...base,
      requiresAccessKey: true,
      accessKeyUpdatedAt: TS,
    };
    expect(
      setShareDocumentAccessKeyResultSchema.safeParse({
        ...result,
        action: "generate",
        accessKey: "K7M2-QX9P-4TDA",
      }).success,
    ).toBe(true);
    expect(
      setShareDocumentAccessKeyResultSchema.safeParse({
        ...result,
        action: "regenerate",
        accessKey: "K7M2-QX9P-4TDA",
      }).success,
    ).toBe(true);
    expect(
      setShareDocumentAccessKeyResultSchema.safeParse({
        ...result,
        requiresAccessKey: false,
        accessKeyUpdatedAt: null,
        action: "remove",
        accessKey: null,
      }).success,
    ).toBe(true);
    expect(
      setShareDocumentAccessKeyResultSchema.safeParse({
        ...result,
        action: "generate",
        accessKey: null,
      }).success,
    ).toBe(false);
    expect(
      setShareDocumentAccessKeyResultSchema.safeParse({
        ...result,
        action: "remove",
        accessKey: "K7M2-QX9P-4TDA",
      }).success,
    ).toBe(false);
    expect(
      generatedAccessKeySchema.safeParse({ documentId: "doc_1", accessKey: "short" }).success,
    ).toBe(false);
  });
});

describe("filters", () => {
  it("shares: facets, document filter and sort whitelist", () => {
    const parsed = shareFilterSchema.parse({
      status: "ACTIVE",
      documentId: "doc_1",
      hasAccessKeys: "true",
      sort: "viewCount:desc",
    });
    expect(parsed.status).toEqual(["ACTIVE"]);
    expect(parsed.hasAccessKeys).toBe(true);
    expect(shareFilterSchema.safeParse({ status: "OPEN" }).success).toBe(false);
    expect(shareFilterSchema.safeParse({ sort: "token:asc" }).success).toBe(false);
  });

  it("access log: needs the link, filters events", () => {
    expect(
      shareAccessLogFilterSchema.safeParse({ shareLinkId: "shr_1", event: ["UNLOCK_FAILED"] })
        .success,
    ).toBe(true);
    expect(shareAccessLogFilterSchema.safeParse({}).success).toBe(false);
    expect(
      shareAccessLogFilterSchema.safeParse({ shareLinkId: "shr_1", event: "PEEK" }).success,
    ).toBe(false);
  });
});

describe("read DTOs", () => {
  const shareDocument = {
    document: doc,
    documentStatus: "ENVIADO",
    versionId: null,
    isLatest: true,
    versionNumber: 2,
    format: "ARCHIVO",
    order: 0,
    requiresAccessKey: true,
    accessKeyUpdatedAt: TS,
    counters,
  };
  const detail = {
    id: "shr_1",
    token: TOKEN,
    url: `https://app.example/s/${TOKEN}`,
    title: "Documentación",
    message: null,
    client: null,
    locale: "es",
    allowDownload: true,
    expiresAt: null,
    revokedAt: null,
    status: "ACTIVE",
    counters,
    lastAccessedAt: null,
    documents: [shareDocument],
    createdBy: user,
    createdAt: TS,
  };
  const listRow = {
    id: "shr_1",
    title: "Documentación",
    client: null,
    documentCount: 1,
    protectedDocumentCount: 1,
    status: "ACTIVE",
    expiresAt: null,
    counters,
    lastAccessedAt: null,
    createdBy: user,
    createdAt: TS,
  };
  const logRow = {
    id: "log_1",
    shareLinkId: "shr_1",
    event: "UNLOCK_FAILED",
    documentId: "doc_1",
    documentTitle: "Contrato",
    visitor: "9f2c41ab",
    userAgent: null,
    createdAt: TS,
  };

  it("detail, list row, access-log row and counters carry counters (views, downloads, failed unlocks)", () => {
    expect(shareLinkDetailSchema.safeParse(detail).success).toBe(true);
    expect(shareLinkListRowSchema.safeParse(listRow).success).toBe(true);
    expect(shareAccessLogRowSchema.safeParse(logRow).success).toBe(true);
    expect(shareCountersSchema.safeParse(counters).success).toBe(true);
    expect(shareCountersSchema.safeParse({ ...counters, failedUnlockCount: -1 }).success).toBe(
      false,
    );
    expect(shareAccessLogRowSchema.safeParse({ ...logRow, visitor: "x".repeat(13) }).success).toBe(
      false,
    );
  });

  it("no read DTO of shares has a key, hash, salt or secret field (C22)", () => {
    const readSchemas = {
      shareLinkDetailSchema,
      shareLinkListRowSchema,
      shareAccessLogRowSchema,
      shareDocumentSchema,
      shareCountersSchema,
    };
    for (const [name, schema] of Object.entries(readSchemas)) {
      expect(
        propertyNames(schema).filter((n) => SECRET_FIELD.test(n)),
        name,
      ).toEqual([]);
    }
    // The key only exists in the results that return it once.
    expect(propertyNames(generatedAccessKeySchema)).toContain("accessKey");
    expect(propertyNames(setShareDocumentAccessKeyResultSchema)).toContain("accessKey");
    // The mutation result nests the read DTO next to the generated keys, and nothing else.
    expect(propertyNames(shareLinkMutationResultSchema).sort()).toEqual(
      [
        ...new Set([
          ...propertyNames(shareLinkDetailSchema),
          ...propertyNames(generatedAccessKeySchema),
          "share",
          "generatedKeys",
        ]),
      ].sort(),
    );
  });

  it("parsing a row that still carries a key or hash drops it", () => {
    const leaked = {
      ...shareDocument,
      accessKey: "K7M2-QX9P-4TDA",
      accessKeyHash: "scrypt$16384$8$1$salt$hash",
    };
    const parsed = shareDocumentSchema.parse(leaked);
    expect(Object.keys(parsed)).not.toContain("accessKey");
    expect(Object.keys(parsed)).not.toContain("accessKeyHash");
    expect(JSON.stringify(parsed)).not.toMatch(/scrypt|K7M2/);

    const parsedDetail = shareLinkDetailSchema.parse({ ...detail, documents: [leaked] });
    expect(JSON.stringify(parsedDetail)).not.toMatch(/scrypt|K7M2|accessKeyHash/);
  });

  it("the mutation result carries the keys generated by this call", () => {
    expect(
      shareLinkMutationResultSchema.safeParse({
        share: detail,
        generatedKeys: [{ documentId: "doc_1", accessKey: "K7M2-QX9P-4TDA" }],
      }).success,
    ).toBe(true);
    expect(
      shareLinkMutationResultSchema.safeParse({ share: detail, generatedKeys: [] }).success,
    ).toBe(true);
  });
});
