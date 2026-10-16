// MOCK — tests for the public portal services of H1-B4 T9 (S9 access keys, S10 portal; DT-45, C22).
import { describe, expect, it } from "vitest";
import {
  ACCESS_KEY_LOCKOUT_MINUTES,
  ACCESS_KEY_MAX_FAILED_ATTEMPTS,
  portalDocumentViewSchema,
  portalDownloadSchema,
  portalShareSchema,
  type PortalSharesService,
} from "@/lib/validators/shares";
import type { MockPublicServiceContext } from "../ctx";
import { ServiceError, createMockPublicContext } from "../ctx";
import { makeTestPublicContext } from "../test-helpers";
import * as portal from "./portal-shares";

const KAIROS = "qB_oM6fupiHqU3EEP1WJdPrUEEVQLSStshw-uBByF7s";
const TAMANACO_REVOKED = "jKfayR-yjhR8KWmwa3SY2EYchtiKTV93lqeLnwAfEeQ";
const ORINOCO_EXPIRED = "VE3SkdLgPirl7OirECK-fnjVddKW_sjAIjqx5uanl2I";
const UNKNOWN = "Z".repeat(43);
const CONTRATO = "doc_contrato_kairos";
const PRD = "doc_prd_kairos_web";
const CREDENCIALES = "doc_credenciales_kairos";
const KEY = "KAIRO-STAGE-2026";
const IP = "a".repeat(64);
const OTHER_IP = "b".repeat(64);
const meta = { ipHash: IP, userAgent: "Vitest" };

const service: PortalSharesService<MockPublicServiceContext> = portal;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ServiceError) return error.code;
    throw error;
  }
  return "OK";
}

function logsOf(ctx: MockPublicServiceContext, event: string) {
  return ctx.db.shareAccessLogs.filter((row) => row.event === event);
}

describe("findLiveShareLink", () => {
  it("finds an active link and answers null for unknown, revoked and expired tokens alike", async () => {
    const { ctx } = makeTestPublicContext();
    expect((await portal.findLiveShareLink(ctx, KAIROS))?.token).toBe(KAIROS);
    expect(await portal.findLiveShareLink(ctx, UNKNOWN)).toBeNull();
    expect(await portal.findLiveShareLink(ctx, TAMANACO_REVOKED)).toBeNull();
    expect(await portal.findLiveShareLink(ctx, ORINOCO_EXPIRED)).toBeNull();
  });
});

describe("resolveShareToken", () => {
  it("returns the portal page with only what a visitor may see", async () => {
    const { ctx } = makeTestPublicContext();
    const page = await service.resolveShareToken(ctx, {
      token: KAIROS,
      unlockedDocumentIds: [],
      ...meta,
    });
    expect(portalShareSchema.strict().parse(page)).toEqual(page);
    expect(page.title).toBe("Entrega de documentación — Kairos Studio");
    expect(page.clientName).toBe("Kairos Studio");
    expect(page.documents.map((doc) => doc.documentId)).toEqual([CONTRATO, PRD, CREDENCIALES]);
    expect(page.documents.map((doc) => doc.locked)).toEqual([false, false, true]);
    expect(page.documents[0]).toMatchObject({ versionNumber: 2, format: "ARCHIVO" });
    expect(JSON.stringify(page)).not.toMatch(/scrypt|accessKey|ipHash|shr_/);
  });

  it("reports a key-protected document as unlocked once its id comes from the unlock cookie", async () => {
    const { ctx } = makeTestPublicContext();
    const page = await service.resolveShareToken(ctx, {
      token: KAIROS,
      unlockedDocumentIds: [CREDENCIALES],
      ...meta,
    });
    expect(page.documents.find((doc) => doc.documentId === CREDENCIALES)?.locked).toBe(false);
  });

  it("answers the same bare NOT_FOUND for unknown, revoked and expired tokens", async () => {
    const { ctx } = makeTestPublicContext();
    for (const token of [UNKNOWN, TAMANACO_REVOKED, ORINOCO_EXPIRED]) {
      const error = await service
        .resolveShareToken(ctx, { token, unlockedDocumentIds: [], ...meta })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ServiceError);
      expect(error).toMatchObject({ code: "NOT_FOUND", message: "common.errors.NOT_FOUND" });
    }
  });

  it("leaves out a shared document that was archived since", async () => {
    const { ctx } = makeTestPublicContext();
    ctx.db.documents.find((doc) => doc.id === PRD)!.archivedAt = "2026-10-08T00:00:00.000Z";
    const page = await service.resolveShareToken(ctx, {
      token: KAIROS,
      unlockedDocumentIds: [],
      ...meta,
    });
    expect(page.documents.map((doc) => doc.documentId)).toEqual([CONTRATO, CREDENCIALES]);
  });
});

describe("recordShareAccess", () => {
  it("appends a VIEW with the hashed IP and user agent only", async () => {
    const { ctx } = makeTestPublicContext();
    const before = logsOf(ctx, "VIEW").length;
    expect(await service.recordShareAccess(ctx, { token: KAIROS, event: "VIEW", ...meta })).toEqual(
      {
        recorded: true,
      },
    );
    const views = logsOf(ctx, "VIEW");
    expect(views).toHaveLength(before + 1);
    expect(views.at(-1)).toMatchObject({ documentId: null, ipHash: IP, userAgent: "Vitest" });
  });

  it("refuses a document that is not part of the link", async () => {
    const { ctx } = makeTestPublicContext();
    expect(
      await codeOf(
        service.recordShareAccess(ctx, {
          token: KAIROS,
          documentId: "doc_nda_tamanaco",
          event: "VIEW",
          ...meta,
        }),
      ),
    ).toBe("NOT_FOUND");
  });
});

describe("unlockSharedDocument", () => {
  const unlock = (ctx: MockPublicServiceContext, key: string, ipHash = IP) =>
    service.unlockSharedDocument(ctx, { token: KAIROS, documentId: CREDENCIALES, key, ipHash });

  it("unlocks with the right key and logs UNLOCK", async () => {
    const { ctx } = makeTestPublicContext();
    const before = logsOf(ctx, "UNLOCK").length;
    expect(await unlock(ctx, KEY)).toEqual({ documentId: CREDENCIALES, unlocked: true });
    expect(logsOf(ctx, "UNLOCK")).toHaveLength(before + 1);
  });

  it("answers ACCESS_KEY_INVALID for a wrong key and logs UNLOCK_FAILED, never the key", async () => {
    const { ctx } = makeTestPublicContext();
    const before = logsOf(ctx, "UNLOCK_FAILED").length;
    expect(await codeOf(unlock(ctx, "WRONG-KEY-0000"))).toBe("ACCESS_KEY_INVALID");
    expect(logsOf(ctx, "UNLOCK_FAILED")).toHaveLength(before + 1);
    expect(JSON.stringify(ctx.db.shareAccessLogs)).not.toContain("WRONG-KEY-0000");
  });

  it(`locks the document for this IP after ${ACCESS_KEY_MAX_FAILED_ATTEMPTS} failures, even for the right key`, async () => {
    const { ctx } = makeTestPublicContext();
    const codes: string[] = [];
    for (let attempt = 1; attempt <= ACCESS_KEY_MAX_FAILED_ATTEMPTS; attempt += 1) {
      codes.push(await codeOf(unlock(ctx, `WRONG-KEY-000${attempt}`)));
    }
    expect(codes).toEqual([
      "ACCESS_KEY_INVALID",
      "ACCESS_KEY_INVALID",
      "ACCESS_KEY_INVALID",
      "ACCESS_KEY_INVALID",
      "ACCESS_KEY_LOCKED",
    ]);
    expect(await codeOf(unlock(ctx, KEY))).toBe("ACCESS_KEY_LOCKED");
    // Another visitor is not affected.
    expect(await codeOf(unlock(ctx, KEY, OTHER_IP))).toBe("OK");
  });

  it(`lifts the lockout ${ACCESS_KEY_LOCKOUT_MINUTES} minutes after the last counted failure`, async () => {
    const { db, ctx } = makeTestPublicContext();
    for (let attempt = 1; attempt <= ACCESS_KEY_MAX_FAILED_ATTEMPTS; attempt += 1) {
      await codeOf(unlock(ctx, `WRONG-KEY-000${attempt}`));
    }
    const later = createMockPublicContext({
      db,
      now: new Date(ctx.now.getTime() + (ACCESS_KEY_LOCKOUT_MINUTES * 60 + 1) * 1000),
    });
    expect(await codeOf(unlock(later, KEY))).toBe("OK");
  });

  it("answers NOT_FOUND for a document outside the link and for a dead token", async () => {
    const { ctx } = makeTestPublicContext();
    expect(
      await codeOf(
        service.unlockSharedDocument(ctx, {
          token: KAIROS,
          documentId: "doc_nda_tamanaco",
          key: KEY,
          ipHash: IP,
        }),
      ),
    ).toBe("NOT_FOUND");
    expect(
      await codeOf(
        service.unlockSharedDocument(ctx, {
          token: TAMANACO_REVOKED,
          documentId: "doc_nda_tamanaco",
          key: KEY,
          ipHash: IP,
        }),
      ),
    ).toBe("NOT_FOUND");
  });
});

describe("getSharedDocument", () => {
  const get = (
    ctx: MockPublicServiceContext,
    documentId: string,
    unlockedDocumentIds: string[] = [],
  ) => service.getSharedDocument(ctx, { token: KAIROS, documentId, unlockedDocumentIds, ...meta });

  it("returns the markdown of a markdown document", async () => {
    const { ctx } = makeTestPublicContext();
    const view = await get(ctx, PRD);
    expect(portalDocumentViewSchema.parse(view)).toEqual(view);
    expect(view.content.format).toBe("MARKDOWN");
  });

  it("describes a PDF file for the embedded viewer", async () => {
    const { ctx } = makeTestPublicContext();
    const view = await get(ctx, CONTRATO);
    expect(view.content).toMatchObject({
      format: "ARCHIVO",
      mimeType: "application/pdf",
      preview: "pdf",
    });
  });

  it("refuses a locked document with FORBIDDEN until it is unlocked", async () => {
    const { ctx } = makeTestPublicContext();
    expect(await codeOf(get(ctx, CREDENCIALES))).toBe("FORBIDDEN");
    expect((await get(ctx, CREDENCIALES, [CREDENCIALES])).content.format).toBe("ENLACE");
  });
});

describe("getSharedDocumentDownload", () => {
  const download = (
    ctx: MockPublicServiceContext,
    documentId: string,
    unlockedDocumentIds: string[] = [],
  ) =>
    service.getSharedDocumentDownload(ctx, {
      token: KAIROS,
      documentId,
      unlockedDocumentIds,
      ...meta,
    });

  it("serves a markdown document as a .md and logs DOWNLOAD", async () => {
    const { ctx } = makeTestPublicContext();
    const before = logsOf(ctx, "DOWNLOAD").length;
    const result = await download(ctx, PRD);
    expect(portalDownloadSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({ kind: "markdown", fileName: expect.stringMatching(/\.md$/) });
    expect(logsOf(ctx, "DOWNLOAD")).toHaveLength(before + 1);
  });

  it("gives a file a URL that expires in 5 minutes", async () => {
    const { ctx } = makeTestPublicContext();
    const result = await download(ctx, CONTRATO);
    expect(result.kind).toBe("url");
    if (result.kind === "url") {
      expect(Date.parse(result.expiresAt) - ctx.now.getTime()).toBe(300_000);
      expect(result.fileName).toBe("contrato-kairos-firmado.pdf");
    }
  });

  it("refuses a locked document and a link without downloads with FORBIDDEN", async () => {
    const { ctx } = makeTestPublicContext();
    expect(await codeOf(download(ctx, CREDENCIALES))).toBe("FORBIDDEN");
    ctx.db.shareLinks.find((link) => link.token === KAIROS)!.allowDownload = false;
    expect(await codeOf(download(ctx, PRD))).toBe("FORBIDDEN");
  });
});
