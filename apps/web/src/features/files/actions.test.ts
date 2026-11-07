import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/api/server", () => server);

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import { confirmUploadAction, deleteFileAction, requestUploadAction } from "./actions";

const pdf = {
  name: "contrato.pdf",
  mime: "application/pdf",
  size: 2048,
  context: "general",
} as const;

const intent = {
  fileId: "fil_1",
  url: "https://api.cloudinary.test/v1/auto/upload",
  fields: { signature: "sig", timestamp: "1" },
  expiresAt: "2030-01-01T00:00:00.000Z",
};

function use(routes: RouteTable) {
  const mocked = mockApi(routes);
  server.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

beforeEach(() => {
  server.getServerApi.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("requestUploadAction", () => {
  it("POSTs the metadata to /files/upload-intent and returns the signed target", async () => {
    const { calls } = use({ "POST /api/v1/files/upload-intent": { status: 201, body: intent } });
    expect(await requestUploadAction(pdf)).toEqual({ ok: true, data: intent });
    expect(calls[0]?.body).toEqual(pdf);
  });

  it("maps a Viewer's FORBIDDEN", async () => {
    use({ "POST /api/v1/files/upload-intent": errorEnvelope("FORBIDDEN") });
    expect(await requestUploadAction(pdf)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});

describe("confirmUploadAction", () => {
  it("POSTs { fileId } to /files and returns the READY file", async () => {
    const file = { id: "fil_1", status: "READY", originalName: "contrato.pdf" };
    const { calls } = use({ "POST /api/v1/files": { status: 201, body: file } });
    expect(await confirmUploadAction({ fileId: "fil_1" })).toEqual({ ok: true, data: file });
    expect(calls[0]?.body).toEqual({ fileId: "fil_1" });
  });

  it("maps a VALIDATION error (wrong type on the bytes) with its field errors", async () => {
    use({
      "POST /api/v1/files": errorEnvelope("VALIDATION", {
        message: "validation.file.typeNotAllowed",
        fieldErrors: { mime: ["validation.file.typeNotAllowed"] },
      }),
    });
    expect(await confirmUploadAction({ fileId: "fil_1" })).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "validation.file.typeNotAllowed",
        fieldErrors: { mime: ["validation.file.typeNotAllowed"] },
      },
    });
  });
});

describe("deleteFileAction", () => {
  it("DELETEs /files/{id}", async () => {
    const { calls } = use({ "DELETE /api/v1/files/{id}": { status: 204 } });
    expect(await deleteFileAction({ fileId: "fil_1" })).toMatchObject({ ok: true });
    expect(calls[0]).toMatchObject({ method: "DELETE", path: "/api/v1/files/fil_1" });
  });

  it("maps INTEGRITY_LOCK for an attached file", async () => {
    use({ "DELETE /api/v1/files/{id}": errorEnvelope("INTEGRITY_LOCK") });
    expect(await deleteFileAction({ fileId: "fil_1" })).toMatchObject({
      ok: false,
      error: { code: "INTEGRITY_LOCK" },
    });
  });
});
