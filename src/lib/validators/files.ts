import { z } from "zod";
import { VALIDATION_MESSAGES, idSchema, type ActionResult } from "./common";
import { fileStatusSchema } from "./enums";

/**
 * File contracts (C23, DT-41): upload request, allowlists and size limits per context, the
 * `UploadAdapter` seam (mock adapter in Hito 1, presigned adapter in Hito 2) and `FileDTO`.
 *
 * These rules are the client-side/first-line checks. Hito 2 repeats them on the server and validates the
 * real MIME by magic bytes at confirm time.
 */

const MB = 1024 * 1024;

/** `general`: documents, notes, invoices, expense receipts. `payment_receipt`: HU-14. */
export const UPLOAD_CONTEXT_VALUES = ["general", "payment_receipt"] as const;
export const uploadContextSchema = z.enum(UPLOAD_CONTEXT_VALUES);
export type UploadContext = z.infer<typeof uploadContextSchema>;

const PDF = ["application/pdf"] as const;
const RECEIPT_IMAGES = ["image/png", "image/jpeg", "image/webp"] as const;
const OFFICE = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // DOCX
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // XLSX
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // PPTX
] as const;
const TEXT = ["text/markdown", "text/x-markdown", "text/plain"] as const;
const ZIP = ["application/zip", "application/x-zip-compressed"] as const;

export interface UploadRules {
  maxBytes: number;
  allowedMimeTypes: readonly string[];
  /** Lower-case extensions (with dot) that match the allowed types, for pickers and `accept`. */
  allowedExtensions: readonly string[];
}

export const UPLOAD_RULES: Record<UploadContext, UploadRules> = {
  general: {
    maxBytes: 25 * MB,
    allowedMimeTypes: [...PDF, ...RECEIPT_IMAGES, "image/gif", ...OFFICE, ...TEXT, ...ZIP],
    allowedExtensions: [
      ".pdf",
      ".png",
      ".jpg",
      ".jpeg",
      ".webp",
      ".gif",
      ".docx",
      ".xlsx",
      ".pptx",
      ".md",
      ".txt",
      ".zip",
    ],
  },
  payment_receipt: {
    maxBytes: 10 * MB,
    allowedMimeTypes: [...PDF, ...RECEIPT_IMAGES],
    allowedExtensions: [".pdf", ".png", ".jpg", ".jpeg", ".webp"],
  },
};

export function getUploadRules(context: UploadContext): UploadRules {
  return UPLOAD_RULES[context];
}

export interface UploadCandidate {
  name: string;
  mime: string;
  size: number;
}

/** First violation of `checkUpload`: an i18n key plus the values its message interpolates, if any. */
export type UploadViolation =
  | { key: typeof VALIDATION_MESSAGES.fileTypeNotAllowed }
  | { key: typeof VALIDATION_MESSAGES.fileEmpty }
  | { key: typeof VALIDATION_MESSAGES.fileTooLarge; values: { max: string } };

/** `application/pdf; charset=binary` → `application/pdf`. */
function normalizeMime(mime: string): string {
  return (mime.split(";")[0] ?? "").trim().toLowerCase();
}

/** Lower-case extension with its dot (`Notes.MD` → `.md`), or `""` when the name has none. */
function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** Browsers report an empty or generic MIME for some files (e.g. `.md`); the extension decides then. */
function isMimeAllowed(candidate: UploadCandidate, rules: UploadRules): boolean {
  const mime = normalizeMime(candidate.mime);
  if (mime !== "" && mime !== "application/octet-stream") {
    return rules.allowedMimeTypes.includes(mime);
  }
  return rules.allowedExtensions.includes(fileExtension(candidate.name));
}

/**
 * Checks a file against the rules of its context. Returns the first violation (an i18n key and the values
 * it interpolates), or `null` when the file is acceptable. Shared by the uploader (client) and
 * `requestUploadInputSchema`. MIME parameters are ignored; an empty or `application/octet-stream` MIME
 * falls back to the extension. Hito 2 still validates the real type by magic bytes at confirm time.
 */
export function checkUpload(
  candidate: UploadCandidate,
  context: UploadContext,
): UploadViolation | null {
  const rules = UPLOAD_RULES[context];
  if (!isMimeAllowed(candidate, rules)) return { key: VALIDATION_MESSAGES.fileTypeNotAllowed };
  if (candidate.size <= 0) return { key: VALIDATION_MESSAGES.fileEmpty };
  if (candidate.size > rules.maxBytes) {
    return {
      key: VALIDATION_MESSAGES.fileTooLarge,
      values: { max: `${rules.maxBytes / MB} MB` },
    };
  }
  return null;
}

function isSafeFileName(name: string): boolean {
  if (name.trim() !== name || name === "." || name === "..") return false;
  for (const char of name) {
    const code = char.charCodeAt(0);
    if (char === "/" || char === "\\" || code < 32 || code === 127) return false;
  }
  return true;
}

/** Original file name: no path separators or control characters, at most 255 chars. */
const fileNameSchema = z
  .string()
  .min(1, VALIDATION_MESSAGES.fileNameInvalid)
  .max(255, VALIDATION_MESSAGES.fileNameInvalid)
  .refine(isSafeFileName, { message: VALIDATION_MESSAGES.fileNameInvalid });

export const requestUploadInputSchema = z
  .object({
    name: fileNameSchema,
    /** May be empty: `checkUpload` then falls back to the extension. */
    mime: z.string(),
    /** Size in bytes (not money, so a plain integer). */
    size: z.number().int(),
    context: uploadContextSchema,
  })
  .superRefine((input, ctx) => {
    const violation = checkUpload(input, input.context);
    if (!violation) return;
    ctx.addIssue({
      code: "custom",
      message: violation.key,
      path: [violation.key === VALIDATION_MESSAGES.fileTypeNotAllowed ? "mime" : "size"],
    });
  });
export type RequestUploadInput = z.infer<typeof requestUploadInputSchema>;

// ───────────────────────────── DTOs and adapter ─────────────────────────────

export const fileDtoSchema = z.object({
  id: idSchema,
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  status: fileStatusSchema,
  uploadedById: idSchema,
  /** ISO 8601 UTC timestamp. */
  createdAt: z.string(),
});
export type FileDTO = z.infer<typeof fileDtoSchema>;

/** Where and how to PUT the bytes. `url` is `null` for the Hito 1 mock adapter (nothing is uploaded). */
export interface UploadTarget {
  fileId: string;
  url: string | null;
  headers?: Record<string, string>;
  /** ISO 8601 UTC expiry of the presigned URL (5-minute TTL, C23). */
  expiresAt?: string;
}

export interface UploadPutOptions {
  signal?: AbortSignal;
  /** Fraction between 0 and 1. */
  onProgress?: (fraction: number) => void;
}

/**
 * The uploader's only way to reach storage (frontend-patterns §6). Hito 1: mock adapter. Hito 2:
 * presigned-URL adapter over `requestUpload` / `confirmUpload` (PRD §12 `files`).
 */
export interface UploadAdapter {
  requestUpload(input: RequestUploadInput): Promise<ActionResult<UploadTarget>>;
  put(target: UploadTarget, file: Blob, options?: UploadPutOptions): Promise<void>;
  confirmUpload(fileId: string): Promise<ActionResult<FileDTO>>;
}
