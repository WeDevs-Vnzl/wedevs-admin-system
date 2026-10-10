import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);

import { getMockStore } from "@/mocks/store";

/** Files uploaded at runtime: the store starts with the file fixtures of the dataset (m8). */
const uploaded = () => getMockStore().files.filter((file) => /^fil_\d+$/.test(file.id));
import { makeSessionUser } from "@/mocks/test-helpers";
import { confirmUploadAction, requestUploadAction } from "./actions";

const pdf = {
  name: "contrato.pdf",
  mime: "application/pdf",
  size: 2048,
  context: "general",
} as const;
const receipt = {
  name: "recibo.png",
  mime: "image/png",
  size: 2048,
  context: "payment_receipt",
} as const;

beforeEach(() => {
  session.getMockSessionUser.mockReset();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("requestUploadAction", () => {
  it("returns a mock file id and no upload URL, and registers a PENDING file", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER", { id: "usr_o" }));
    expect(await requestUploadAction(pdf)).toEqual({
      ok: true,
      data: { fileId: "fil_0001", url: null },
    });
    expect(uploaded()).toMatchObject([
      { id: "fil_0001", status: "PENDING", uploadedById: "usr_o" },
    ]);
  });

  it("lets whoever can create a document or a note upload, and refuses a Viewer", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("MEMBER"));
    expect(await requestUploadAction(pdf)).toMatchObject({ ok: true });
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("VIEWER"));
    expect(await requestUploadAction(pdf)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(uploaded()).toHaveLength(1);
  });

  it("payment receipts need the payment grant on top: a Member is refused", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("MEMBER"));
    expect(await requestUploadAction(receipt)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(uploaded()).toHaveLength(0);
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("ADMIN"));
    expect(await requestUploadAction(receipt)).toMatchObject({ ok: true });
  });

  it("applies the upload rules of the contract (C23): type and size", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    expect(
      await requestUploadAction({ ...pdf, name: "virus.exe", mime: "application/x-msdownload" }),
    ).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { mime: ["validation.file.typeNotAllowed"] } },
    });
    expect(await requestUploadAction({ ...receipt, size: 11 * 1024 * 1024 })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { size: ["validation.file.tooLarge"] } },
    });
    expect(uploaded()).toHaveLength(0);
  });

  it("requires a session", async () => {
    session.getMockSessionUser.mockResolvedValue(null);
    expect(await requestUploadAction(pdf)).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });
});

describe("confirmUploadAction", () => {
  it("flips the file to READY", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    const requested = await requestUploadAction(pdf);
    if (!requested.ok) throw new Error("upload not requested");
    const confirmed = await confirmUploadAction({ fileId: requested.data.fileId });
    expect(confirmed).toMatchObject({
      ok: true,
      data: { id: "fil_0001", status: "READY", originalName: "contrato.pdf" },
    });
  });

  it("answers NOT_FOUND for an unknown id or another user's file", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER", { id: "usr_a" }));
    const requested = await requestUploadAction(pdf);
    if (!requested.ok) throw new Error("upload not requested");
    expect(await confirmUploadAction({ fileId: "fil_9999" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER", { id: "usr_b" }));
    expect(await confirmUploadAction({ fileId: requested.data.fileId })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it("validates the id and refuses a Viewer", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    expect(await confirmUploadAction({ fileId: "../etc/passwd" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("VIEWER"));
    expect(await confirmUploadAction({ fileId: "fil_0001" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});
