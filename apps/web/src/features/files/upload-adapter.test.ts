import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  requestUploadAction: vi.fn(),
  confirmUploadAction: vi.fn(),
}));
vi.mock("./actions", () => actions);

import { uploadAdapter } from "./upload-adapter";

const pdf = {
  name: "contrato.pdf",
  mime: "application/pdf",
  size: 2048,
  context: "general",
} as const;

const future = () => new Date(Date.now() + 5 * 60_000).toISOString();
const past = () => new Date(Date.now() - 1000).toISOString();
const target = (over: Record<string, unknown> = {}) => ({
  fileId: "fil_1",
  url: "https://api.cloudinary.test/upload",
  fields: { signature: "sig", timestamp: "1" },
  expiresAt: future(),
  ...over,
});

/** XHR stand-in: records the POST and answers with the queued status. */
const cloudinary = vi.fn();
let statuses: number[] = [];
class FakeXhr {
  status = 0;
  upload: { onprogress?: (event: unknown) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  headers = new Headers();
  method = "";
  url = "";
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: FormData) {
    cloudinary(this.url, { method: this.method, body, headers: this.headers });
    this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 });
    this.status = statuses.shift() ?? 200;
    this.onload?.();
  }
  abort() {
    this.onabort?.();
  }
}

beforeEach(() => {
  actions.requestUploadAction.mockReset();
  actions.confirmUploadAction.mockReset();
  cloudinary.mockReset();
  statuses = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
});
afterEach(() => vi.unstubAllGlobals());

describe("uploadAdapter", () => {
  it("runs intent → Cloudinary POST (fields + file, no token) → confirm", async () => {
    actions.requestUploadAction.mockResolvedValue({ ok: true, data: target() });
    actions.confirmUploadAction.mockResolvedValue({
      ok: true,
      data: { id: "fil_1", status: "READY" },
    });

    const requested = await uploadAdapter.requestUpload(pdf);
    if (!requested.ok) throw new Error("expected ok");
    const onProgress = vi.fn();
    await uploadAdapter.put(requested.data, new Blob(["x"]), { onProgress });
    const confirmed = await uploadAdapter.confirmUpload(requested.data.fileId);

    expect(actions.requestUploadAction).toHaveBeenCalledWith(pdf);
    const [url, init] = cloudinary.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.cloudinary.test/upload");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).has("authorization")).toBe(false);
    const form = init.body as FormData;
    expect(form.get("signature")).toBe("sig");
    expect(form.get("timestamp")).toBe("1");
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(onProgress).toHaveBeenCalledWith(0.5);
    expect(onProgress).toHaveBeenLastCalledWith(1);
    expect(actions.confirmUploadAction).toHaveBeenCalledWith({ fileId: "fil_1" });
    expect(confirmed).toMatchObject({ ok: true, data: { status: "READY" } });
  });

  it("rejects an oversize or wrong-type file before any request", async () => {
    const big = await uploadAdapter.requestUpload({ ...pdf, size: 26 * 1024 * 1024 });
    expect(big).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { size: ["validation.file.tooLarge"] } },
    });
    const exe = await uploadAdapter.requestUpload({
      ...pdf,
      name: "a.exe",
      mime: "application/x-msdownload",
    });
    expect(exe).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(actions.requestUploadAction).not.toHaveBeenCalled();
    expect(cloudinary).not.toHaveBeenCalled();
  });

  it("passes BE errors through (Viewer FORBIDDEN)", async () => {
    actions.requestUploadAction.mockResolvedValue({
      ok: false,
      error: { code: "FORBIDDEN", message: "common.errors.FORBIDDEN" },
    });
    expect(await uploadAdapter.requestUpload(pdf)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("passes a confirm VALIDATION through", async () => {
    actions.confirmUploadAction.mockResolvedValue({
      ok: false,
      error: { code: "VALIDATION", message: "validation.file.typeNotAllowed" },
    });
    expect(await uploadAdapter.confirmUpload("fil_9")).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });

  it("re-requests an expired intent once and confirms the new file id", async () => {
    actions.requestUploadAction
      .mockResolvedValueOnce({ ok: true, data: target({ expiresAt: past() }) })
      .mockResolvedValueOnce({ ok: true, data: target({ fileId: "fil_2" }) });
    actions.confirmUploadAction.mockResolvedValue({ ok: true, data: { id: "fil_2" } });

    const requested = await uploadAdapter.requestUpload(pdf);
    if (!requested.ok) throw new Error("expected ok");
    await uploadAdapter.put(requested.data, new Blob(["x"]));

    expect(actions.requestUploadAction).toHaveBeenCalledTimes(2);
    expect(cloudinary).toHaveBeenCalledTimes(1);
    await uploadAdapter.confirmUpload("fil_1");
    expect(actions.confirmUploadAction).toHaveBeenCalledWith({ fileId: "fil_2" });
  });

  it("re-requests once when Cloudinary rejects the signature, then throws", async () => {
    actions.requestUploadAction
      .mockResolvedValueOnce({ ok: true, data: target() })
      .mockResolvedValueOnce({ ok: true, data: target({ fileId: "fil_2" }) });
    statuses = [400, 400];

    const requested = await uploadAdapter.requestUpload(pdf);
    if (!requested.ok) throw new Error("expected ok");
    await expect(uploadAdapter.put(requested.data, new Blob(["x"]))).rejects.toThrow();
    expect(actions.requestUploadAction).toHaveBeenCalledTimes(2);
    expect(cloudinary).toHaveBeenCalledTimes(2);
  });

  it("throws when the re-request is refused", async () => {
    actions.requestUploadAction
      .mockResolvedValueOnce({ ok: true, data: target({ expiresAt: past() }) })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "FORBIDDEN", message: "common.errors.FORBIDDEN" },
      });
    const requested = await uploadAdapter.requestUpload(pdf);
    if (!requested.ok) throw new Error("expected ok");
    await expect(uploadAdapter.put(requested.data, new Blob(["x"]))).rejects.toThrow();
    expect(cloudinary).not.toHaveBeenCalled();
  });

  it("throws when the target has no URL", async () => {
    await expect(uploadAdapter.put({ fileId: "fil_x", url: null }, new Blob([]))).rejects.toThrow();
  });
});
