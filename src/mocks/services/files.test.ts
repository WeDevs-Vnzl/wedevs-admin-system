// MOCK — tests for the file mock services.
import { describe, expect, it } from "vitest";
import { FIXED_NOW, makeTestContext } from "../test-helpers";
import { confirmUpload, requestUpload } from "./files";

const input = {
  name: "contrato.pdf",
  mime: "application/pdf",
  size: 1024,
  context: "general",
} as const;

describe("requestUpload", () => {
  it("registers a PENDING file and returns a mock file id and no upload URL", async () => {
    const { ctx, db, user } = makeTestContext();
    const target = await requestUpload(ctx, input);
    expect(target).toEqual({ fileId: "fil_0001", url: null });
    expect(db.files).toEqual([
      {
        id: "fil_0001",
        originalName: "contrato.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: "PENDING",
        uploadedById: user.id,
        createdAt: FIXED_NOW.toISOString(),
      },
    ]);
  });

  it("hands out a new id every time and never reuses a taken one", async () => {
    const { ctx, db } = makeTestContext();
    db.files.push({
      ...{
        id: "fil_0001",
        originalName: "x",
        mimeType: "x",
        sizeBytes: 1,
        status: "READY" as const,
        uploadedById: "u",
        createdAt: "t",
      },
    });
    expect((await requestUpload(ctx, input)).fileId).toBe("fil_0002");
    expect((await requestUpload(ctx, input)).fileId).toBe("fil_0003");
  });

  it("stores a generic type when the browser reported none", async () => {
    const { ctx, db } = makeTestContext();
    await requestUpload(ctx, { ...input, name: "notas.md", mime: "" });
    expect(db.files[0]?.mimeType).toBe("application/octet-stream");
  });
});

describe("confirmUpload", () => {
  it("flips the caller's file to READY and returns it", async () => {
    const { ctx, db } = makeTestContext();
    const { fileId } = await requestUpload(ctx, input);
    const file = await confirmUpload(ctx, { fileId });
    expect(file.status).toBe("READY");
    expect(db.files[0]?.status).toBe("READY");
    expect(await confirmUpload(ctx, { fileId })).toEqual(file); // idempotent
  });

  it("answers NOT_FOUND for an unknown id and for a file somebody else uploaded", async () => {
    const { ctx, db } = makeTestContext();
    await expect(confirmUpload(ctx, { fileId: "fil_9999" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    db.files.push({
      id: "fil_foreign",
      originalName: "x",
      mimeType: "x",
      sizeBytes: 1,
      status: "PENDING",
      uploadedById: "usr_other",
      createdAt: "t",
    });
    await expect(confirmUpload(ctx, { fileId: "fil_foreign" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(db.files[0]?.status).toBe("PENDING");
  });
});
