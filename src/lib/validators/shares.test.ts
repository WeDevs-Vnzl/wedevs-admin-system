import type { PortalSharesService, SharesService } from "./shares";
import { describe, expect, it } from "vitest";
import * as sharesModule from "./shares";
import { z } from "./zod";
import {
  ACCESS_KEY_LOCKOUT_MINUTES,
  ACCESS_KEY_MAX_FAILED_ATTEMPTS,
  ACCESS_KEY_MIN_LENGTH,
  SHARE_TOKEN_LENGTH,
  createShareLinkInputSchema,
  generatedAccessKeySchema,
  getSharedDocumentActionSchema,
  getSharedDocumentDownloadActionSchema,
  getSharedDocumentDownloadServiceInputSchema,
  getSharedDocumentServiceInputSchema,
  portalDocumentContentSchema,
  portalDocumentSchema,
  portalDocumentViewSchema,
  portalDownloadSchema,
  portalShareSchema,
  recordShareAccessActionSchema,
  recordShareAccessResultSchema,
  recordShareAccessServiceInputSchema,
  resolveShareTokenActionSchema,
  resolveShareTokenServiceInputSchema,
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
  unlockSharedDocumentActionSchema,
  unlockSharedDocumentResultSchema,
  unlockSharedDocumentServiceInputSchema,
  updateShareLinkInputSchema,
} from "./shares";

const TOKEN = "A".repeat(SHARE_TOKEN_LENGTH);
const HASH = "a".repeat(64);
const TS = "2026-10-01T10:00:00.000Z";
const user = { id: "usr_1", name: "Andrés Molina", imageUrl: null };
const doc = { id: "doc_1", code: "DOC-0001", label: "Contrato", type: "DOCUMENT" };
const counters = { viewCount: 3, downloadCount: 1, unlockCount: 1, failedUnlockCount: 2 };

const issues = (result: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  (result.error?.issues ?? []).map((i) => `${i.path.join(".")}:${i.message}`);

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

describe("unlockSharedDocument (public)", () => {
  const valid = { token: TOKEN, documentId: "doc_1", key: "K7M2-QX9P" };

  it("accepts a key of at least 8 characters", () => {
    expect(ACCESS_KEY_MIN_LENGTH).toBe(8);
    expect(unlockSharedDocumentActionSchema.safeParse(valid).success).toBe(true);
    expect(unlockSharedDocumentActionSchema.safeParse({ ...valid, key: "12345678" }).success).toBe(
      true,
    );
  });

  it("rejects keys shorter than 8, blank, or absurdly long", () => {
    expect(unlockSharedDocumentActionSchema.safeParse({ ...valid, key: "1234567" }).success).toBe(
      false,
    );
    expect(unlockSharedDocumentActionSchema.safeParse({ ...valid, key: "        " }).success).toBe(
      false,
    );
    expect(unlockSharedDocumentActionSchema.safeParse({ ...valid, key: "" }).success).toBe(false);
    expect(
      unlockSharedDocumentActionSchema.safeParse({ ...valid, key: "x".repeat(129) }).success,
    ).toBe(false);
  });

  it("trims a pasted key before measuring it", () => {
    expect(unlockSharedDocumentActionSchema.parse({ ...valid, key: "  K7M2-QX9P \n" }).key).toBe(
      "K7M2-QX9P",
    );
    expect(
      unlockSharedDocumentActionSchema.safeParse({ ...valid, key: "  1234567  " }).success,
    ).toBe(false);
  });

  it("rejects a malformed token and a missing document", () => {
    expect(unlockSharedDocumentActionSchema.safeParse({ ...valid, token: "short" }).success).toBe(
      false,
    );
    expect(
      unlockSharedDocumentActionSchema.safeParse({ token: TOKEN, key: valid.key }).success,
    ).toBe(false);
  });

  it("documents the lockout policy: 5 failures, 15 minutes", () => {
    expect(ACCESS_KEY_MAX_FAILED_ATTEMPTS).toBe(5);
    expect(ACCESS_KEY_LOCKOUT_MINUTES).toBe(15);
  });

  it("action schema strips server-only fields a visitor tries to send (C22)", () => {
    const forged = {
      ...valid,
      ip: "198.51.100.1",
      ipHash: HASH,
      userAgent: "forged",
      unlockedDocumentIds: ["doc_1"],
    };
    expect(unlockSharedDocumentActionSchema.parse(forged)).toEqual(valid);
  });

  it("service input carries the IP hash the lockout is keyed on", () => {
    const parsed = unlockSharedDocumentServiceInputSchema.parse({
      ...valid,
      ipHash: HASH,
      userAgent: "Mozilla/5.0",
    });
    expect(parsed).toMatchObject({ token: TOKEN, documentId: "doc_1", ipHash: HASH });
    expect(unlockSharedDocumentServiceInputSchema.safeParse(valid).success).toBe(false);
    expect(
      unlockSharedDocumentServiceInputSchema.safeParse({ ...valid, ipHash: "203.0.113.7" }).success,
    ).toBe(false);
  });

  it("result only says the document is unlocked", () => {
    expect(
      unlockSharedDocumentResultSchema.safeParse({ documentId: "doc_1", unlocked: true }).success,
    ).toBe(true);
    expect(
      unlockSharedDocumentResultSchema.safeParse({ documentId: "doc_1", unlocked: false }).success,
    ).toBe(false);
    expect(
      propertyNames(unlockSharedDocumentResultSchema).filter((n) => SECRET_FIELD.test(n)),
    ).toEqual([]);
  });
});

describe("other portal inputs", () => {
  const meta = { ipHash: HASH, userAgent: "Mozilla/5.0" };

  it("action schemas accept only client fields and strip the rest (C22)", () => {
    const forged = {
      ip: "198.51.100.1",
      ipHash: HASH,
      userAgent: "forged",
      unlockedDocumentIds: ["doc_1"],
    };
    expect(resolveShareTokenActionSchema.parse({ token: TOKEN, ...forged })).toEqual({
      token: TOKEN,
    });
    expect(
      getSharedDocumentActionSchema.parse({ token: TOKEN, documentId: "doc_1", ...forged }),
    ).toEqual({ token: TOKEN, documentId: "doc_1" });
    expect(
      getSharedDocumentDownloadActionSchema.parse({ token: TOKEN, documentId: "doc_1", ...forged }),
    ).toEqual({ token: TOKEN, documentId: "doc_1" });
    expect(recordShareAccessActionSchema.parse({ token: TOKEN, event: "VIEW", ...forged })).toEqual(
      { token: TOKEN, event: "VIEW" },
    );
  });

  it("resolveShareToken and getSharedDocument service inputs default the unlocked ids", () => {
    expect(
      resolveShareTokenServiceInputSchema.parse({ token: TOKEN, ...meta }).unlockedDocumentIds,
    ).toEqual([]);
    expect(
      getSharedDocumentServiceInputSchema.parse({ token: TOKEN, documentId: "doc_1", ...meta })
        .unlockedDocumentIds,
    ).toEqual([]);
    expect(
      getSharedDocumentDownloadServiceInputSchema.parse({
        token: TOKEN,
        documentId: "doc_1",
        unlockedDocumentIds: ["doc_1"],
        ...meta,
      }).unlockedDocumentIds,
    ).toEqual(["doc_1"]);
    expect(resolveShareTokenActionSchema.safeParse({ token: "x" }).success).toBe(false);
    expect(resolveShareTokenServiceInputSchema.safeParse({ token: TOKEN }).success).toBe(false);
  });

  it("recordShareAccess accepts only VIEW and DOWNLOAD", () => {
    const base = { token: TOKEN, documentId: "doc_1" };
    expect(recordShareAccessActionSchema.safeParse({ ...base, event: "VIEW" }).success).toBe(true);
    expect(recordShareAccessActionSchema.safeParse({ ...base, event: "DOWNLOAD" }).success).toBe(
      true,
    );
    expect(recordShareAccessActionSchema.safeParse({ ...base, event: "UNLOCK" }).success).toBe(
      false,
    );
    expect(
      recordShareAccessActionSchema.safeParse({ ...base, event: "UNLOCK_FAILED" }).success,
    ).toBe(false);
    expect(recordShareAccessActionSchema.safeParse({ token: TOKEN, event: "VIEW" }).success).toBe(
      true,
    );
    expect(recordShareAccessResultSchema.safeParse({ recorded: true }).success).toBe(true);
  });

  it("recordShareAccess service input stores the IP hash, never a raw IP", () => {
    const input = { token: TOKEN, event: "VIEW", ...meta };
    expect(recordShareAccessServiceInputSchema.parse(input)).toEqual(input);
    expect(
      recordShareAccessServiceInputSchema.safeParse({ token: TOKEN, event: "VIEW" }).success,
    ).toBe(false);
    expect(
      recordShareAccessServiceInputSchema.safeParse({ ...input, ipHash: "203.0.113.7" }).success,
    ).toBe(false);
    expect(propertyNames(recordShareAccessServiceInputSchema)).not.toContain("ip");
  });

  it("only the service inputs carry server-only metadata", () => {
    for (const action of [
      unlockSharedDocumentActionSchema,
      resolveShareTokenActionSchema,
      getSharedDocumentActionSchema,
      getSharedDocumentDownloadActionSchema,
      recordShareAccessActionSchema,
    ]) {
      const names = propertyNames(action);
      for (const forbidden of ["ip", "ipHash", "userAgent", "unlockedDocumentIds"]) {
        expect(names).not.toContain(forbidden);
      }
    }
    for (const service of [
      unlockSharedDocumentServiceInputSchema,
      resolveShareTokenServiceInputSchema,
      getSharedDocumentServiceInputSchema,
      getSharedDocumentDownloadServiceInputSchema,
      recordShareAccessServiceInputSchema,
    ]) {
      expect(propertyNames(service)).toContain("ipHash");
    }
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
      portalShareSchema,
      portalDocumentSchema,
      portalDocumentViewSchema,
      portalDocumentContentSchema,
      portalDownloadSchema,
      unlockSharedDocumentResultSchema,
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

describe("portal DTOs expose only what the visitor may see", () => {
  const portalDocument = {
    documentId: "doc_1",
    title: "Contrato de servicios",
    typeName: "Contrato",
    typeNameEn: "Agreement",
    versionNumber: 2,
    versionDate: "2026-09-15",
    format: "ARCHIVO",
    locked: true,
  };
  const portal = {
    title: "Documentación",
    message: null,
    locale: "es",
    allowDownload: true,
    clientName: "Kairos Studio",
    expiresAt: null,
    documents: [portalDocument, { ...portalDocument, documentId: "doc_2", locked: false }],
  };

  it("has locked: boolean per document", () => {
    const parsed = portalShareSchema.parse(portal);
    expect(parsed.documents.map((d) => d.locked)).toEqual([true, false]);
    expect(portalDocumentSchema.safeParse({ ...portalDocument, locked: "yes" }).success).toBe(
      false,
    );
    expect(portalDocumentSchema.safeParse({ ...portalDocument, locked: undefined }).success).toBe(
      false,
    );
  });

  it("has no internal data: no token, author, ids of internal records, counters or log", () => {
    const names = propertyNames(portalShareSchema);
    for (const internal of [
      "token",
      "createdBy",
      "createdAt",
      "counters",
      "client",
      "clientId",
      "versionId",
      "revokedAt",
      "requiresAccessKey",
      "accessKeyUpdatedAt",
      "id",
    ]) {
      expect(names, internal).not.toContain(internal);
    }
  });

  it("strips internal fields a service might pass by mistake", () => {
    const parsed = portalShareSchema.parse({
      ...portal,
      token: TOKEN,
      createdBy: user,
      documents: [{ ...portalDocument, accessKeyHash: "scrypt$x", requiresAccessKey: true }],
    });
    expect(JSON.stringify(parsed)).not.toMatch(/scrypt|createdBy|requiresAccessKey|token/);
  });

  it("the viewer payload exists only for unlocked documents and is typed by format", () => {
    const unlocked = { ...portalDocument, locked: false };
    expect(
      portalDocumentViewSchema.safeParse({
        document: unlocked,
        content: {
          format: "ARCHIVO",
          fileName: "contrato.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          preview: "pdf",
        },
      }).success,
    ).toBe(true);
    expect(
      portalDocumentViewSchema.safeParse({
        document: portalDocument,
        content: { format: "ENLACE", url: "https://x.example" },
      }).success,
    ).toBe(false);
    expect(
      portalDocumentContentSchema.safeParse({ format: "MARKDOWN", markdown: "# Hola" }).success,
    ).toBe(true);
    expect(
      portalDocumentContentSchema.safeParse({ format: "ENLACE", url: "https://x.example" }).success,
    ).toBe(true);
    expect(
      portalDocumentContentSchema.safeParse({ format: "ARCHIVO", fileName: "a.pdf" }).success,
    ).toBe(false);
  });

  it("downloads are a 5-minute URL or markdown", () => {
    expect(
      portalDownloadSchema.safeParse({
        kind: "url",
        url: "https://bucket.example/x?sig=1",
        fileName: "a.pdf",
        expiresAt: TS,
      }).success,
    ).toBe(true);
    expect(
      portalDownloadSchema.safeParse({ kind: "markdown", fileName: "a.md", content: "# A" })
        .success,
    ).toBe(true);
    expect(
      portalDownloadSchema.safeParse({ kind: "url", url: "https://x.example", fileName: "a.pdf" })
        .success,
    ).toBe(false);
    expect(issues(portalDownloadSchema.safeParse({ kind: "zip" })).length).toBeGreaterThan(0);
  });
});

describe("SharesService (PRD §12 service names)", () => {
  it("declares every service of the module with its exact name", () => {
    const names = [
      "createShareLink",
      "updateShareLink",
      "revokeShareLink",
      "setShareDocumentAccessKey",
    ] as const satisfies readonly (keyof SharesService)[];
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("PortalSharesService (PRD §12 public + DT-45 portal additions)", () => {
  it("declares the public services with their exact names", () => {
    const names = [
      "resolveShareToken",
      "recordShareAccess",
      "unlockSharedDocument",
    ] as const satisfies readonly (keyof PortalSharesService)[];
    expect(names).toHaveLength(3);
  });
});

describe("portal input names (Reviewer M3)", () => {
  it("has no un-suffixed aliases of the service schemas", () => {
    const removed = [
      "unlockSharedDocumentInputSchema",
      "resolveShareTokenInputSchema",
      "recordShareAccessInputSchema",
      "getSharedDocumentInputSchema",
      "getSharedDocumentDownloadInputSchema",
    ];
    for (const name of removed) expect(sharesModule, name).not.toHaveProperty(name);
  });

  it("keeps the Action and ServiceInput schemas for every portal operation", () => {
    for (const operation of [
      "unlockSharedDocument",
      "resolveShareToken",
      "recordShareAccess",
      "getSharedDocument",
      "getSharedDocumentDownload",
    ]) {
      expect(sharesModule, `${operation}ActionSchema`).toHaveProperty(`${operation}ActionSchema`);
      expect(sharesModule, `${operation}ServiceInputSchema`).toHaveProperty(
        `${operation}ServiceInputSchema`,
      );
    }
  });
});
