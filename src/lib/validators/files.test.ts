import { describe, expect, it } from "vitest";
import { VALIDATION_MESSAGES } from "./common";
import {
  UPLOAD_RULES,
  checkUpload,
  fileDtoSchema,
  getUploadRules,
  requestUploadInputSchema,
} from "./files";

const MB = 1024 * 1024;

describe("upload rules per context (DT-41, C23)", () => {
  it("general: 25 MB; payment receipts: 10 MB", () => {
    expect(UPLOAD_RULES.general.maxBytes).toBe(25 * MB);
    expect(UPLOAD_RULES.payment_receipt.maxBytes).toBe(10 * MB);
    expect(getUploadRules("general")).toBe(UPLOAD_RULES.general);
  });

  it("general allows PDF, images, DOCX, XLSX, PPTX, MD, TXT and ZIP", () => {
    const mimes = UPLOAD_RULES.general.allowedMimeTypes;
    for (const mime of [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/markdown",
      "text/plain",
      "application/zip",
    ]) {
      expect(mimes).toContain(mime);
    }
  });

  it("never allows executable or scriptable types (SVG, HTML, JS)", () => {
    for (const rules of Object.values(UPLOAD_RULES)) {
      for (const mime of [
        "image/svg+xml",
        "text/html",
        "application/javascript",
        "application/x-msdownload",
      ]) {
        expect(rules.allowedMimeTypes).not.toContain(mime);
      }
    }
  });

  it("payment receipts allow only PDF, PNG, JPG and WEBP", () => {
    expect([...UPLOAD_RULES.payment_receipt.allowedMimeTypes].sort()).toEqual([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
    expect(UPLOAD_RULES.payment_receipt.allowedExtensions).toEqual([
      ".pdf",
      ".png",
      ".jpg",
      ".jpeg",
      ".webp",
    ]);
  });
});

describe("checkUpload", () => {
  const pdf = { name: "a.pdf", mime: "application/pdf" };
  const typeNotAllowed = { key: VALIDATION_MESSAGES.fileTypeNotAllowed };

  it("accepts a file at the limit of each context", () => {
    expect(checkUpload({ ...pdf, size: 25 * MB }, "general")).toBeNull();
    expect(
      checkUpload({ name: "r.pdf", mime: pdf.mime, size: 10 * MB }, "payment_receipt"),
    ).toBeNull();
  });

  it("rejects files over the limit and provides the interpolated {max}", () => {
    expect(checkUpload({ ...pdf, size: 25 * MB + 1 }, "general")).toEqual({
      key: VALIDATION_MESSAGES.fileTooLarge,
      values: { max: "25 MB" },
    });
    expect(
      checkUpload({ name: "r.pdf", mime: pdf.mime, size: 10 * MB + 1 }, "payment_receipt"),
    ).toEqual({ key: VALIDATION_MESSAGES.fileTooLarge, values: { max: "10 MB" } });
  });

  it("applies the limit of the context, not a global one", () => {
    expect(checkUpload({ ...pdf, size: 20 * MB }, "general")).toBeNull();
    expect(checkUpload({ ...pdf, size: 20 * MB }, "payment_receipt")).toMatchObject({
      key: VALIDATION_MESSAGES.fileTooLarge,
    });
    expect(
      checkUpload({ name: "a.zip", mime: "application/zip", size: 1 * MB }, "payment_receipt"),
    ).toEqual(typeNotAllowed);
  });

  it("rejects empty files and unknown types, and ignores MIME case", () => {
    expect(checkUpload({ ...pdf, size: 0 }, "general")).toEqual({
      key: VALIDATION_MESSAGES.fileEmpty,
    });
    expect(
      checkUpload({ name: "a.exe", mime: "application/x-msdownload", size: 10 }, "general"),
    ).toEqual(typeNotAllowed);
    expect(checkUpload({ name: "a.PNG", mime: "IMAGE/PNG", size: 10 }, "general")).toBeNull();
  });

  it("strips MIME parameters", () => {
    expect(
      checkUpload({ name: "n.txt", mime: "text/plain; charset=utf-8", size: 10 }, "general"),
    ).toBeNull();
    expect(
      checkUpload({ name: "n.md", mime: " Text/Markdown ;charset=UTF-8", size: 10 }, "general"),
    ).toBeNull();
    expect(
      checkUpload(
        { name: "a.exe", mime: "application/x-msdownload; foo=bar", size: 10 },
        "general",
      ),
    ).toEqual(typeNotAllowed);
  });

  it("falls back to the extension when the MIME is empty or octet-stream", () => {
    for (const mime of ["", "application/octet-stream", "Application/Octet-Stream; x=1"]) {
      expect(checkUpload({ name: "notes.md", mime, size: 10 }, "general"), mime).toBeNull();
    }
    expect(checkUpload({ name: "NOTES.MD", mime: "", size: 10 }, "general")).toBeNull();
  });

  it("still rejects a disallowed or missing extension when the MIME is empty or generic", () => {
    for (const mime of ["", "application/octet-stream"]) {
      for (const name of ["setup.exe", "page.html", "image.svg", "README", ".md", "notes.md.exe"]) {
        expect(checkUpload({ name, mime, size: 10 }, "general"), `${name} ${mime}`).toEqual(
          typeNotAllowed,
        );
      }
    }
    expect(checkUpload({ name: "notes.md", mime: "", size: 10 }, "payment_receipt")).toEqual(
      typeNotAllowed,
    );
  });

  it("does not let the extension override a concrete, disallowed MIME", () => {
    expect(checkUpload({ name: "notes.md", mime: "text/html", size: 10 }, "general")).toEqual(
      typeNotAllowed,
    );
  });
});

describe("requestUploadInputSchema", () => {
  const valid = { name: "contract.pdf", mime: "application/pdf", size: 1024, context: "general" };

  it("accepts a valid request", () => {
    expect(requestUploadInputSchema.parse(valid)).toEqual(valid);
  });

  it("enforces the size per context", () => {
    expect(
      requestUploadInputSchema.safeParse({ ...valid, size: 11 * MB, context: "payment_receipt" })
        .success,
    ).toBe(false);
    expect(requestUploadInputSchema.safeParse({ ...valid, size: 11 * MB }).success).toBe(true);
    const tooBig = requestUploadInputSchema.safeParse({ ...valid, size: 26 * MB });
    expect(tooBig.success).toBe(false);
    if (!tooBig.success) {
      expect(tooBig.error.issues[0]).toMatchObject({
        path: ["size"],
        message: VALIDATION_MESSAGES.fileTooLarge,
      });
    }
  });

  it("accepts an empty MIME for an allowed extension and rejects it otherwise", () => {
    expect(
      requestUploadInputSchema.safeParse({ ...valid, name: "notes.md", mime: "" }).success,
    ).toBe(true);
    const result = requestUploadInputSchema.safeParse({ ...valid, name: "run.exe", mime: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]).toMatchObject({
        path: ["mime"],
        message: VALIDATION_MESSAGES.fileTypeNotAllowed,
      });
    }
  });

  it("enforces the MIME allowlist per context and points at the mime field", () => {
    const result = requestUploadInputSchema.safeParse({
      ...valid,
      mime: "application/zip",
      context: "payment_receipt",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(["mime"]);
  });

  it("rejects bad sizes, contexts and file names", () => {
    expect(requestUploadInputSchema.safeParse({ ...valid, size: 0 }).success).toBe(false);
    expect(requestUploadInputSchema.safeParse({ ...valid, size: -5 }).success).toBe(false);
    expect(requestUploadInputSchema.safeParse({ ...valid, size: 1.5 }).success).toBe(false);
    expect(requestUploadInputSchema.safeParse({ ...valid, context: "avatar" }).success).toBe(false);
    for (const name of [
      "",
      "../etc/passwd",
      "a/b.pdf",
      "a\\b.pdf",
      " a.pdf",
      "a.pdf ",
      "..",
      "a\u0000.pdf",
      "x".repeat(256),
    ]) {
      expect(requestUploadInputSchema.safeParse({ ...valid, name }).success).toBe(false);
    }
  });
});

describe("fileDtoSchema", () => {
  it("parses a FileDTO", () => {
    const dto = {
      id: "fil_1",
      originalName: "receipt.png",
      mimeType: "image/png",
      sizeBytes: 2048,
      status: "READY",
      uploadedById: "usr_1",
      createdAt: "2026-10-09T12:00:00.000Z",
    };
    expect(fileDtoSchema.parse(dto)).toEqual(dto);
    expect(fileDtoSchema.safeParse({ ...dto, status: "DONE" }).success).toBe(false);
  });
});
