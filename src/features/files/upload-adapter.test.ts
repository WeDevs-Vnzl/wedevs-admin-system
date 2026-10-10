import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);

import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import { uploadAdapter } from "./upload-adapter";

const pdf = { name: "contrato.pdf", mime: "application/pdf", size: 2048, context: "general" } as const;

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER", { id: "usr_o" }));
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("uploadAdapter (UploadAdapter over the file actions)", () => {
  it("runs request → put → confirm and leaves the file READY", async () => {
    const requested = await uploadAdapter.requestUpload(pdf);
    if (!requested.ok) throw new Error("expected ok");
    expect(requested.data).toEqual({ fileId: "fil_0001", url: null });

    const onProgress = vi.fn();
    await uploadAdapter.put(requested.data, new Blob(["x"]), { onProgress });
    expect(onProgress).toHaveBeenCalledWith(1);

    const confirmed = await uploadAdapter.confirmUpload(requested.data.fileId);
    expect(confirmed).toMatchObject({ ok: true, data: { id: "fil_0001", status: "READY" } });
    expect(getMockStore().files).toMatchObject([{ id: "fil_0001", status: "READY" }]);
  });

  it("put works without options", async () => {
    await expect(uploadAdapter.put({ fileId: "fil_x", url: null }, new Blob([]))).resolves.toBeUndefined();
  });

  it("passes action errors through: invalid file → VALIDATION, Viewer → FORBIDDEN, unknown id → NOT_FOUND", async () => {
    expect(await uploadAdapter.requestUpload({ ...pdf, name: "a.exe", mime: "application/x-msdownload" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(await uploadAdapter.confirmUpload("fil_9999")).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("VIEWER"));
    expect(await uploadAdapter.requestUpload(pdf)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});
