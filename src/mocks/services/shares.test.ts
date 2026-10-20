// MOCK — tests for the shares service of H1-B4 T7 (S8 share links, S9 access keys; DT-45, C22).
import { describe, expect, it } from "vitest";
import {
  ACCESS_KEY_MAX_LENGTH,
  ACCESS_KEY_MIN_LENGTH,
  createShareLinkInputSchema,
  setShareDocumentAccessKeyResultSchema,
  shareAccessLogFilterSchema,
  shareAccessLogRowSchema,
  shareFilterSchema,
  shareLinkDetailSchema,
  shareLinkListRowSchema,
  shareLinkMutationResultSchema,
  shareTokenSchema,
  updateShareLinkInputSchema,
  type CreateShareLinkFormValues,
  type SharesService,
  type ShareLinkDetailDTO,
} from "@/lib/validators/shares";
import type { MockServiceContext } from "../ctx";
import { ServiceError, createMockContext } from "../ctx";
import { FIXED_NOW, makeTestContext } from "../test-helpers";
import { generateAccessKey, hashAccessKey, verifyAccessKey } from "./share-keys";
import * as sharesService from "./shares";
import {
  createShareLink,
  getShareLink,
  listShareAccessLog,
  listShareLinks,
  revokeShareLink,
  setShareDocumentAccessKey,
  updateShareLink,
} from "./shares";

const KAIROS_LINK = "shr_kairos_entrega";
const KAIROS_KEYED_DOC = "doc_credenciales_kairos";
/** MOCK dev key of the Kairos fixture (documented in `fixtures/shares.ts`). */
const KAIROS_DEV_KEY = "KAIRO-STAGE-2026";

function createInput(overrides: Partial<CreateShareLinkFormValues> = {}) {
  return createShareLinkInputSchema.parse({
    title: "Entrega a Andina",
    documents: [{ documentId: "doc_tsd_andina" }],
    ...overrides,
  });
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ServiceError);
  expect((error as ServiceError).code).toBe(code);
  return error as ServiceError;
}

function editInput(share: ShareLinkDetailDTO, overrides: Record<string, unknown> = {}) {
  return updateShareLinkInputSchema.parse({
    id: share.id,
    title: share.title,
    message: share.message ?? undefined,
    clientId: share.client?.id,
    documents: share.documents.map((doc) => ({
      documentId: doc.document.id,
      versionId: doc.versionId,
      requiresAccessKey: doc.requiresAccessKey,
    })),
    allowDownload: share.allowDownload,
    locale: share.locale,
    expiresAt: share.expiresAt ?? undefined,
    ...overrides,
  });
}

const keyRow = (db: MockServiceContext["db"], shareLinkId: string, documentId: string) =>
  db.shareDocumentKeys.find(
    (row) => row.shareLinkId === shareLinkId && row.documentId === documentId,
  );

describe("shares service contract", () => {
  it("implements every SharesService name", () => {
    const service: SharesService<MockServiceContext> = sharesService;
    for (const name of [
      "createShareLink",
      "updateShareLink",
      "revokeShareLink",
      "setShareDocumentAccessKey",
      "listShareLinks",
      "getShareLink",
      "listShareAccessLog",
    ] as const) {
      expect(typeof service[name]).toBe("function");
    }
  });
});

describe("createShareLink (S8)", () => {
  it("generates a unique 43-character base64url token and persists the link", async () => {
    const { ctx, db } = makeTestContext();
    const first = await createShareLink(ctx, createInput());
    const second = await createShareLink(ctx, createInput());
    expect(shareLinkMutationResultSchema.parse(first)).toEqual(first);
    for (const { share } of [first, second]) {
      expect(share.token).toHaveLength(43);
      expect(share.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(shareTokenSchema.safeParse(share.token).success).toBe(true);
      expect(share.url.endsWith(`/s/${share.token}`)).toBe(true);
    }
    expect(first.share.token).not.toBe(second.share.token);
    const stored = db.shareLinks.find((row) => row.id === first.share.id);
    expect(stored?.token).toBe(first.share.token);
    expect(new Set(db.shareLinks.map((row) => row.token)).size).toBe(db.shareLinks.length);
  });

  it("allows download, uses the ES portal and never expires by default", async () => {
    const { ctx, db } = makeTestContext();
    const { share } = await createShareLink(ctx, createInput());
    expect(share).toMatchObject({
      allowDownload: true,
      locale: "es",
      expiresAt: null,
      status: "ACTIVE",
    });
    expect(share.revokedAt).toBeNull();
    const stored = db.shareLinks.find((row) => row.id === share.id)!;
    expect(stored).toMatchObject({ allowDownload: true, locale: "es", expiresAt: null });
  });

  it("keeps the EN locale, no download and the expiry asked for", async () => {
    const { ctx, db } = makeTestContext();
    const { share } = await createShareLink(
      ctx,
      createInput({
        locale: "en",
        allowDownload: false,
        expiresAt: "2026-11-30",
        clientId: "cli_andina_software",
      }),
    );
    expect(share).toMatchObject({ locale: "en", allowDownload: false, expiresAt: "2026-11-30" });
    expect(share.client).toMatchObject({ id: "cli_andina_software", type: "CLIENT" });
    expect(db.shareLinks.find((row) => row.id === share.id)).toMatchObject({
      locale: "en",
      allowDownload: false,
      expiresAt: "2026-11-30",
    });
  });

  it("pins a document to a version or follows the latest one (versionId: null)", async () => {
    const { ctx, db } = makeTestContext();
    const { share } = await createShareLink(
      ctx,
      createInput({
        documents: [
          { documentId: "doc_prd_kairos_web", versionId: "dver_prd_kairos_web_1" },
          { documentId: "doc_tsd_andina", versionId: null },
        ],
      }),
    );
    const [pinned, latest] = share.documents;
    expect(pinned).toMatchObject({
      versionId: "dver_prd_kairos_web_1",
      versionNumber: 1,
      isLatest: false,
      order: 0,
      format: "MARKDOWN",
    });
    expect(latest).toMatchObject({ versionId: null, versionNumber: 2, isLatest: true, order: 1 });
    const stored = db.shareLinks.find((row) => row.id === share.id)!;
    expect(stored.documents.map((doc) => doc.versionId)).toEqual(["dver_prd_kairos_web_1", null]);
  });

  it("follows the newest version after a publish when not pinned", async () => {
    const { ctx, db } = makeTestContext();
    const { share } = await createShareLink(ctx, createInput());
    const doc = db.documents.find((row) => row.id === "doc_tsd_andina")!;
    const previous = db.documentVersions.find((row) => row.id === doc.currentVersionId)!;
    db.documentVersions.push({ ...previous, id: "dver_tsd_andina_3", versionNumber: 3 });
    doc.currentVersionId = "dver_tsd_andina_3";
    const read = await getShareLink(ctx, { id: share.id });
    expect(read.documents[0]).toMatchObject({ versionId: null, versionNumber: 3, isLatest: true });
  });

  it("rejects a version of another document, unknown or version-less documents, a past expiry and an unknown client", async () => {
    const { ctx, db } = makeTestContext();
    const before = db.shareLinks.length;
    const activityBefore = db.activity.length;
    const wrongVersion = await expectCode(
      createShareLink(
        ctx,
        createInput({
          documents: [{ documentId: "doc_tsd_andina", versionId: "dver_prd_kairos_web_1" }],
        }),
      ),
      "VALIDATION",
    );
    expect(wrongVersion.fieldErrors).toHaveProperty(["documents.0.versionId"]);
    await expectCode(
      createShareLink(ctx, createInput({ documents: [{ documentId: "doc_missing" }] })),
      "VALIDATION",
    );
    await expectCode(
      createShareLink(ctx, createInput({ documents: [{ documentId: "doc_minuta_solaris" }] })),
      "VALIDATION",
    );
    const expired = await expectCode(
      createShareLink(ctx, createInput({ expiresAt: "2026-10-08" })),
      "VALIDATION",
    );
    expect(expired.fieldErrors).toHaveProperty(["expiresAt"]);
    await expectCode(createShareLink(ctx, createInput({ clientId: "cli_missing" })), "VALIDATION");
    await expectCode(
      createShareLink(ctx, { ...createInput(), documents: [] } as never),
      "VALIDATION",
    );
    expect(db.shareLinks).toHaveLength(before);
    expect(db.activity).toHaveLength(activityBefore);
  });

  it("logs SHARE_CREATE on the link", async () => {
    const { ctx, db } = makeTestContext();
    const { share } = await createShareLink(ctx, createInput());
    expect(db.activity.at(-1)).toMatchObject({
      action: "SHARE_CREATE",
      entityType: "SHARE_LINK",
      entityId: share.id,
      entityLabel: share.title,
      actorId: ctx.user.id,
    });
  });
});

describe("access keys (S9)", () => {
  it("generates a key once for the documents that require one and stores only a salted scrypt hash", async () => {
    const { ctx, db } = makeTestContext();
    const { share, generatedKeys } = await createShareLink(
      ctx,
      createInput({
        documents: [
          { documentId: "doc_tsd_andina", requiresAccessKey: true },
          { documentId: "doc_prd_kairos_web", requiresAccessKey: true },
          { documentId: "doc_roadmap_harbor" },
        ],
      }),
    );
    expect(generatedKeys.map((key) => key.documentId).sort()).toEqual([
      "doc_prd_kairos_web",
      "doc_tsd_andina",
    ]);
    for (const { documentId, accessKey } of generatedKeys) {
      expect(accessKey.length).toBeGreaterThanOrEqual(ACCESS_KEY_MIN_LENGTH);
      expect(accessKey.length).toBeLessThanOrEqual(ACCESS_KEY_MAX_LENGTH);
      const row = keyRow(db, share.id, documentId)!;
      expect(row.accessKeyHash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
      expect(row.accessKeyHash).not.toContain(accessKey);
      expect(row.accessKeyUpdatedAt).toBe(FIXED_NOW.toISOString());
      expect(await verifyAccessKey(accessKey, row.accessKeyHash!)).toBe(true);
    }
    const hashes = generatedKeys.map((key) => keyRow(db, share.id, key.documentId)!.accessKeyHash);
    expect(hashes[0]).not.toBe(hashes[1]);
    expect(keyRow(db, share.id, "doc_roadmap_harbor")?.accessKeyHash ?? null).toBeNull();
    const flags = Object.fromEntries(
      share.documents.map((d) => [d.document.id, d.requiresAccessKey]),
    );
    expect(flags).toEqual({
      doc_tsd_andina: true,
      doc_prd_kairos_web: true,
      doc_roadmap_harbor: false,
    });
  });

  it("never exposes a key or a hash in reads, list rows, access-log rows or the activity log", async () => {
    const { ctx, db } = makeTestContext();
    const { share, generatedKeys } = await createShareLink(
      ctx,
      createInput({ documents: [{ documentId: "doc_tsd_andina", requiresAccessKey: true }] }),
    );
    const key = generatedKeys[0]!.accessKey;
    const reads = JSON.stringify([
      await getShareLink(ctx, { id: share.id }),
      await getShareLink(ctx, { id: KAIROS_LINK }),
      await listShareLinks(ctx, shareFilterSchema.parse({ pageSize: 100 })),
      await listShareAccessLog(ctx, shareAccessLogFilterSchema.parse({ shareLinkId: KAIROS_LINK })),
      db.activity,
      db.shareLinks,
    ]);
    expect(reads).not.toContain(key);
    expect(reads).not.toContain("scrypt");
    expect(reads).not.toMatch(/accessKeyHash|"accessKey"|ipHash/);
    const detail = await getShareLink(ctx, { id: share.id });
    expect(Object.keys(shareLinkDetailSchema.strict().parse(detail))).not.toContain(
      "generatedKeys",
    );
  });

  it("regenerates a key: new clear key once, new hash, old key rejected", async () => {
    const { ctx, db } = makeTestContext();
    const before = keyRow(db, KAIROS_LINK, KAIROS_KEYED_DOC)!.accessKeyHash!;
    expect(await verifyAccessKey(KAIROS_DEV_KEY, before)).toBe(true);
    const result = await setShareDocumentAccessKey(ctx, {
      shareLinkId: KAIROS_LINK,
      documentId: KAIROS_KEYED_DOC,
      action: "regenerate",
    });
    expect(setShareDocumentAccessKeyResultSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      action: "regenerate",
      requiresAccessKey: true,
      accessKeyUpdatedAt: FIXED_NOW.toISOString(),
    });
    const after = keyRow(db, KAIROS_LINK, KAIROS_KEYED_DOC)!;
    expect(after.accessKeyHash).not.toBe(before);
    expect(after.accessKeyHash).not.toContain(result.accessKey!);
    expect(await verifyAccessKey(result.accessKey!, after.accessKeyHash!)).toBe(true);
    expect(await verifyAccessKey(KAIROS_DEV_KEY, after.accessKeyHash!)).toBe(false);
  });

  it("generates a key for an open document and removes it again", async () => {
    const { ctx, db } = makeTestContext();
    const generated = await setShareDocumentAccessKey(ctx, {
      shareLinkId: KAIROS_LINK,
      documentId: "doc_prd_kairos_web",
      action: "generate",
    });
    expect(generated.accessKey).not.toBeNull();
    expect(
      await verifyAccessKey(
        generated.accessKey!,
        keyRow(db, KAIROS_LINK, "doc_prd_kairos_web")!.accessKeyHash!,
      ),
    ).toBe(true);
    const read = await getShareLink(ctx, { id: KAIROS_LINK });
    expect(read.documents.find((d) => d.document.id === "doc_prd_kairos_web")).toMatchObject({
      requiresAccessKey: true,
      accessKeyUpdatedAt: FIXED_NOW.toISOString(),
    });

    const removed = await setShareDocumentAccessKey(ctx, {
      shareLinkId: KAIROS_LINK,
      documentId: "doc_prd_kairos_web",
      action: "remove",
    });
    expect(removed).toMatchObject({
      requiresAccessKey: false,
      accessKeyUpdatedAt: null,
      accessKey: null,
    });
    expect(keyRow(db, KAIROS_LINK, "doc_prd_kairos_web")).toMatchObject({
      accessKeyHash: null,
      accessKeyUpdatedAt: null,
    });
  });

  it("refuses an action that does not match the key state, and a document outside the link", async () => {
    const { ctx, db } = makeTestContext();
    const before = structuredClone(db.shareDocumentKeys);
    await expectCode(
      setShareDocumentAccessKey(ctx, {
        shareLinkId: KAIROS_LINK,
        documentId: KAIROS_KEYED_DOC,
        action: "generate",
      }),
      "CONFLICT",
    );
    await expectCode(
      setShareDocumentAccessKey(ctx, {
        shareLinkId: KAIROS_LINK,
        documentId: "doc_prd_kairos_web",
        action: "regenerate",
      }),
      "CONFLICT",
    );
    await expectCode(
      setShareDocumentAccessKey(ctx, {
        shareLinkId: KAIROS_LINK,
        documentId: "doc_prd_kairos_web",
        action: "remove",
      }),
      "CONFLICT",
    );
    await expectCode(
      setShareDocumentAccessKey(ctx, {
        shareLinkId: KAIROS_LINK,
        documentId: "doc_tsd_andina",
        action: "generate",
      }),
      "NOT_FOUND",
    );
    expect(db.shareDocumentKeys).toEqual(before);
  });

  it("logs a key change as UPDATE with only the 'changed' marker", async () => {
    const { ctx, db } = makeTestContext();
    const { accessKey } = await setShareDocumentAccessKey(ctx, {
      shareLinkId: KAIROS_LINK,
      documentId: KAIROS_KEYED_DOC,
      action: "regenerate",
    });
    const entry = db.activity.at(-1)!;
    expect(entry).toMatchObject({
      action: "UPDATE",
      entityType: "SHARE_LINK",
      entityId: KAIROS_LINK,
      changes: { accessKey: "changed" },
      metadata: { documentId: KAIROS_KEYED_DOC, accessKeyAction: "regenerate" },
    });
    expect(JSON.stringify(entry)).not.toContain(accessKey!);
  });

  it("keeps, generates and removes keys when the edit form replaces the documents", async () => {
    const { ctx, db } = makeTestContext();
    const share = await getShareLink(ctx, { id: KAIROS_LINK });
    const keptHash = keyRow(db, KAIROS_LINK, KAIROS_KEYED_DOC)!.accessKeyHash;
    const input = editInput(share);
    input.documents = input.documents
      .filter((doc) => doc.documentId !== "doc_contrato_kairos")
      .map((doc) =>
        doc.documentId === "doc_prd_kairos_web" ? { ...doc, requiresAccessKey: true } : doc,
      );
    input.documents.push({
      documentId: "doc_tsd_andina",
      versionId: null,
      requiresAccessKey: false,
    });
    const { share: updated, generatedKeys } = await updateShareLink(ctx, input);
    expect(generatedKeys.map((key) => key.documentId)).toEqual(["doc_prd_kairos_web"]);
    expect(keyRow(db, KAIROS_LINK, KAIROS_KEYED_DOC)!.accessKeyHash).toBe(keptHash);
    expect(keyRow(db, KAIROS_LINK, "doc_contrato_kairos")).toBeUndefined();
    expect(updated.documents.map((doc) => doc.document.id)).toEqual([
      "doc_prd_kairos_web",
      "doc_credenciales_kairos",
      "doc_tsd_andina",
    ]);

    const off = editInput(updated);
    off.documents = off.documents.map((doc) =>
      doc.documentId === KAIROS_KEYED_DOC ? { ...doc, requiresAccessKey: false } : doc,
    );
    const result = await updateShareLink(ctx, off);
    expect(result.generatedKeys).toEqual([]);
    expect(keyRow(db, KAIROS_LINK, KAIROS_KEYED_DOC)!.accessKeyHash).toBeNull();
    expect(db.activity.at(-1)).toMatchObject({ action: "UPDATE", entityId: KAIROS_LINK });
    expect(db.activity.at(-1)!.changes).toMatchObject({ accessKey: "changed" });
  });
});

describe("share-keys helpers (S9)", () => {
  it("salts every hash, so the same key hashes differently each time", async () => {
    const key = generateAccessKey();
    const [a, b] = [await hashAccessKey(key), await hashAccessKey(key)];
    expect(a).not.toBe(b);
    expect(await verifyAccessKey(key, a)).toBe(true);
    expect(await verifyAccessKey(key, b)).toBe(true);
  });

  it("accepts the right key and rejects a wrong, short, long or malformed one", async () => {
    const hash = await hashAccessKey("correct-horse-battery");
    expect(await verifyAccessKey("correct-horse-battery", hash)).toBe(true);
    expect(await verifyAccessKey("correct-horse-battery!", hash)).toBe(false);
    expect(await verifyAccessKey("short", hash)).toBe(false);
    expect(await verifyAccessKey("x".repeat(129), hash)).toBe(false);
    expect(await verifyAccessKey("correct-horse-battery", "plain-text")).toBe(false);
    expect(await verifyAccessKey("correct-horse-battery", hash.replace(/\$[^$]+$/, "$AAAA"))).toBe(
      false,
    );
  });

  it("only hashes keys of 8 to 128 characters", async () => {
    await expect(hashAccessKey("1234567")).rejects.toThrow(RangeError);
    await expect(hashAccessKey("x".repeat(129))).rejects.toThrow(RangeError);
    await expect(hashAccessKey("12345678")).resolves.toMatch(/^scrypt\$/);
    await expect(hashAccessKey("x".repeat(128))).resolves.toMatch(/^scrypt\$/);
    for (let index = 0; index < 20; index += 1) {
      const key = generateAccessKey();
      expect(key).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    }
  });
});

describe("expiry and revoke (S8)", () => {
  it("reports ACTIVE, EXPIRED after the last valid day, and REVOKED", async () => {
    const { ctx, db } = makeTestContext();
    const { share } = await createShareLink(ctx, createInput({ expiresAt: "2026-10-10" }));
    expect(share.status).toBe("ACTIVE");
    const lastDay = createMockContext({
      user: ctx.user,
      db,
      now: new Date("2026-10-10T20:00:00Z"),
    });
    expect((await getShareLink(lastDay, { id: share.id })).status).toBe("ACTIVE");
    const later = createMockContext({ user: ctx.user, db, now: new Date("2026-10-11T15:00:00Z") });
    expect((await getShareLink(later, { id: share.id })).status).toBe("EXPIRED");
    expect(db.shareLinks.find((row) => row.id === share.id)?.status).toBe("EXPIRED");

    const revoked = await revokeShareLink(ctx, { id: share.id });
    expect(revoked).toMatchObject({ status: "REVOKED", revokedAt: FIXED_NOW.toISOString() });
    expect(db.shareLinks.find((row) => row.id === share.id)).toMatchObject({
      status: "REVOKED",
      revokedAt: FIXED_NOW.toISOString(),
    });
    expect(db.activity.at(-1)).toMatchObject({ action: "SHARE_REVOKE", entityId: share.id });
  });

  it("locks a revoked link against further changes", async () => {
    const { ctx, db } = makeTestContext();
    await revokeShareLink(ctx, { id: KAIROS_LINK });
    const snapshot = structuredClone({ links: db.shareLinks, keys: db.shareDocumentKeys });
    await expectCode(revokeShareLink(ctx, { id: KAIROS_LINK }), "INTEGRITY_LOCK");
    await expectCode(
      updateShareLink(ctx, editInput(await getShareLink(ctx, { id: KAIROS_LINK }))),
      "INTEGRITY_LOCK",
    );
    await expectCode(
      setShareDocumentAccessKey(ctx, {
        shareLinkId: KAIROS_LINK,
        documentId: KAIROS_KEYED_DOC,
        action: "regenerate",
      }),
      "INTEGRITY_LOCK",
    );
    expect({ links: db.shareLinks, keys: db.shareDocumentKeys }).toEqual(snapshot);
  });

  it("updates the fields of the edit form and logs the diff", async () => {
    const { ctx, db } = makeTestContext();
    const share = await getShareLink(ctx, { id: KAIROS_LINK });
    const { share: updated, generatedKeys } = await updateShareLink(
      ctx,
      editInput(share, {
        title: "Entrega final — Kairos",
        locale: "en",
        allowDownload: false,
        expiresAt: "2026-12-31",
      }),
    );
    expect(generatedKeys).toEqual([]);
    expect(updated).toMatchObject({
      title: "Entrega final — Kairos",
      locale: "en",
      allowDownload: false,
      expiresAt: "2026-12-31",
      token: share.token,
    });
    expect(db.shareLinks.find((row) => row.id === KAIROS_LINK)).toMatchObject({
      title: "Entrega final — Kairos",
    });
    expect(db.activity.at(-1)).toMatchObject({
      action: "UPDATE",
      entityId: KAIROS_LINK,
      changes: { title: [share.title, "Entrega final — Kairos"], locale: ["es", "en"] },
    });
  });

  it("answers NOT_FOUND for an unknown link", async () => {
    const { ctx } = makeTestContext();
    await expectCode(getShareLink(ctx, { id: "shr_missing" }), "NOT_FOUND");
    await expectCode(revokeShareLink(ctx, { id: "shr_missing" }), "NOT_FOUND");
  });
});

describe("counters and access log (S8)", () => {
  it("derives link and document counters and the last access from the access log", async () => {
    const { ctx, db } = makeTestContext();
    const share = await getShareLink(ctx, { id: KAIROS_LINK });
    expect(share.counters).toEqual({
      viewCount: 7,
      downloadCount: 2,
      unlockCount: 1,
      failedUnlockCount: 1,
    });
    expect(share.documents.find((d) => d.document.id === KAIROS_KEYED_DOC)?.counters).toEqual({
      viewCount: 1,
      downloadCount: 0,
      unlockCount: 1,
      failedUnlockCount: 1,
    });
    const at = new Date(FIXED_NOW.getTime() - 60_000).toISOString();
    db.shareAccessLogs.push({
      id: "sacc_extra",
      shareLinkId: KAIROS_LINK,
      event: "UNLOCK_FAILED",
      documentId: KAIROS_KEYED_DOC,
      ipHash: "a".repeat(64),
      userAgent: null,
      createdAt: at,
    });
    db.shareAccessLogs.push({ ...db.shareAccessLogs.at(-1)!, id: "sacc_view", event: "VIEW" });
    const after = await getShareLink(ctx, { id: KAIROS_LINK });
    expect(after.counters).toMatchObject({ viewCount: 8, failedUnlockCount: 2 });
    expect(after.lastAccessedAt).toBe(at);
    const rows = await listShareLinks(ctx, shareFilterSchema.parse({ pageSize: 100 }));
    expect(rows.items.find((row) => row.id === KAIROS_LINK)?.counters.failedUnlockCount).toBe(2);
  });

  it("lists the access log newest first, filtered by event and document, without the IP hash", async () => {
    const { ctx } = makeTestContext();
    const all = await listShareAccessLog(
      ctx,
      shareAccessLogFilterSchema.parse({ shareLinkId: KAIROS_LINK }),
    );
    expect(all.total).toBe(11);
    for (const row of all.items) {
      expect(shareAccessLogRowSchema.strict().parse(row)).toEqual(row);
      expect(row.visitor).toHaveLength(12);
    }
    const times = all.items.map((row) => row.createdAt);
    expect(times).toEqual([...times].sort().reverse());
    const unlocks = await listShareAccessLog(
      ctx,
      shareAccessLogFilterSchema.parse({
        shareLinkId: KAIROS_LINK,
        event: ["UNLOCK", "UNLOCK_FAILED"],
      }),
    );
    expect(unlocks.items.map((row) => row.event).sort()).toEqual(["UNLOCK", "UNLOCK_FAILED"]);
    expect(unlocks.items[0]?.documentTitle).toBe("Credenciales de staging — Kairos");
    const byDoc = await listShareAccessLog(
      ctx,
      shareAccessLogFilterSchema.parse({
        shareLinkId: KAIROS_LINK,
        documentId: "doc_prd_kairos_web",
      }),
    );
    expect(byDoc.items.every((row) => row.documentId === "doc_prd_kairos_web")).toBe(true);
    expect(byDoc.total).toBe(3);
    const none = await listShareAccessLog(
      ctx,
      shareAccessLogFilterSchema.parse({
        shareLinkId: KAIROS_LINK,
        from: "2026-10-09",
        to: "2026-10-09",
      }),
    );
    expect(none.total).toBe(0);
    await expectCode(
      listShareAccessLog(ctx, shareAccessLogFilterSchema.parse({ shareLinkId: "shr_missing" })),
      "NOT_FOUND",
    );
  });
});

describe("listShareLinks (S8)", () => {
  it("lists every fixture link with its status and filters by status, key protection, document and client", async () => {
    const { ctx } = makeTestContext();
    const list = async (filter: Record<string, unknown>) =>
      (await listShareLinks(ctx, shareFilterSchema.parse({ pageSize: 100, ...filter }))).items;
    const all = await list({});
    for (const row of all) expect(shareLinkListRowSchema.strict().parse(row)).toEqual(row);
    expect(Object.fromEntries(all.map((row) => [row.id, row.status]))).toEqual({
      shr_kairos_entrega: "ACTIVE",
      shr_aurora_entrega: "ACTIVE",
      shr_tamanaco_nda: "REVOKED",
      shr_orinoco_propuesta: "EXPIRED",
    });
    expect(all.find((row) => row.id === KAIROS_LINK)).toMatchObject({
      documentCount: 3,
      protectedDocumentCount: 1,
    });
    expect((await list({ status: ["ACTIVE"] })).map((row) => row.id).sort()).toEqual([
      "shr_aurora_entrega",
      "shr_kairos_entrega",
    ]);
    expect((await list({ hasAccessKeys: true })).map((row) => row.id).sort()).toEqual([
      "shr_kairos_entrega",
      "shr_tamanaco_nda",
    ]);
    expect((await list({ documentId: "doc_manual_aurora" })).map((row) => row.id)).toEqual([
      "shr_aurora_entrega",
    ]);
    expect((await list({ clientId: ["cli_logistica_orinoco"] })).map((row) => row.id)).toEqual([
      "shr_orinoco_propuesta",
    ]);
    expect((await list({ q: "tamanaco" })).map((row) => row.id)).toEqual(["shr_tamanaco_nda"]);
    expect(all.map((row) => row.createdAt)).toEqual(
      all
        .map((row) => row.createdAt)
        .sort()
        .reverse(),
    );
  });
});

describe("permissions", () => {
  it("refuses every shares service to roles without the share grant", async () => {
    for (const role of ["MEMBER", "VIEWER"] as const) {
      const { ctx, db } = makeTestContext(role);
      const snapshot = structuredClone({
        links: db.shareLinks,
        keys: db.shareDocumentKeys,
        activity: db.activity,
      });
      await expectCode(createShareLink(ctx, createInput()), "FORBIDDEN");
      await expectCode(
        updateShareLink(ctx, editInput(db.shareLinks.find((row) => row.id === KAIROS_LINK)!)),
        "FORBIDDEN",
      );
      await expectCode(revokeShareLink(ctx, { id: KAIROS_LINK }), "FORBIDDEN");
      await expectCode(
        setShareDocumentAccessKey(ctx, {
          shareLinkId: KAIROS_LINK,
          documentId: KAIROS_KEYED_DOC,
          action: "regenerate",
        }),
        "FORBIDDEN",
      );
      await expectCode(getShareLink(ctx, { id: KAIROS_LINK }), "FORBIDDEN");
      await expectCode(listShareLinks(ctx, shareFilterSchema.parse({})), "FORBIDDEN");
      await expectCode(
        listShareAccessLog(ctx, shareAccessLogFilterSchema.parse({ shareLinkId: KAIROS_LINK })),
        "FORBIDDEN",
      );
      expect({ links: db.shareLinks, keys: db.shareDocumentKeys, activity: db.activity }).toEqual(
        snapshot,
      );
    }
  });

  it("lets an admin manage links", async () => {
    const { ctx } = makeTestContext("ADMIN");
    await expect(createShareLink(ctx, createInput())).resolves.toHaveProperty(
      "share.status",
      "ACTIVE",
    );
  });
});
