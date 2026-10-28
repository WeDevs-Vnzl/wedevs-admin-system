import type { FileStatus } from '../../../shared/domain/enums';
import { UPLOAD_RULES, TEXT_MIME_TYPES, type UploadContext } from './upload-rules';

/** A stored file (PRD §10 `File`). `PENDING` until the bytes are verified at confirm time (C23). */
export interface StoredFile {
  readonly id: string;
  readonly storageKey: string;
  readonly bucket: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly status: FileStatus;
  readonly uploadedById: string;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
}

export interface NewPendingFile {
  readonly id: string;
  readonly context: UploadContext;
  readonly bucket: string;
  readonly originalName: string;
  /** Declared (resolved) type; the real one replaces it at confirm. */
  readonly mimeType: string;
  /** Declared size; the real one replaces it at confirm. */
  readonly sizeBytes: number;
  readonly uploadedById: string;
  readonly now: Date;
}

/** `<context>/<yyyy>/<mm>/<id>` (UTC). The id makes it unique; the user's file name never enters it. */
export function buildStorageKey(context: UploadContext, id: string, now: Date): string {
  const year = String(now.getUTCFullYear()).padStart(4, '0');
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${context}/${year}/${month}/${id}`;
}

/** The context a storage key was created for, or `null` when it is not one of ours. */
export function contextOfStorageKey(storageKey: string): UploadContext | null {
  const prefix = storageKey.split('/')[0] ?? '';
  return Object.hasOwn(UPLOAD_RULES, prefix) ? (prefix as UploadContext) : null;
}

export function createPendingFile(input: NewPendingFile): StoredFile {
  return {
    id: input.id,
    storageKey: buildStorageKey(input.context, input.id, input.now),
    bucket: input.bucket,
    originalName: input.originalName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    status: 'PENDING',
    uploadedById: input.uploadedById,
    createdAt: input.now,
    deletedAt: null,
  };
}

const ZIP_MIME_TYPES: readonly string[] = ['application/zip', 'application/x-zip-compressed'];
const OFFICE_PREFIX = 'application/vnd.openxmlformats-officedocument.';

export type TypeVerdict = { readonly ok: true; readonly mimeType: string } | { readonly ok: false };

/**
 * Decides whether the sniffed bytes agree with the context allowlist and with what the client declared.
 * `sniffed === null` means no magic bytes matched: only the declared text types pass, and only when the
 * caller already verified the head is UTF-8 text (`headIsText`).
 *
 * - The sniffed type must be in the context allowlist (a spoofed `.pdf` that is an executable fails here).
 * - It must also match the declared type; the only tolerated difference is an Office/ZIP document that the
 *   sniffer sees as a plain ZIP (the declared Office type is kept).
 */
export function verifyContentType(input: {
  readonly context: UploadContext;
  readonly declaredMime: string;
  readonly sniffed: string | null;
  readonly headIsText: boolean;
}): TypeVerdict {
  const allowed = UPLOAD_RULES[input.context].allowedMimeTypes;
  const { declaredMime, sniffed } = input;
  if (sniffed === null) {
    const declaredText = (TEXT_MIME_TYPES as readonly string[]).includes(declaredMime);
    if (declaredText && allowed.includes(declaredMime) && input.headIsText) {
      return { ok: true, mimeType: declaredMime };
    }
    return { ok: false };
  }
  if (!allowed.includes(sniffed)) return { ok: false };
  if (sniffed === declaredMime) return { ok: true, mimeType: sniffed };
  if (ZIP_MIME_TYPES.includes(sniffed)) {
    const zipLike = ZIP_MIME_TYPES.includes(declaredMime) || declaredMime.startsWith(OFFICE_PREFIX);
    if (zipLike && allowed.includes(declaredMime)) return { ok: true, mimeType: declaredMime };
  }
  return { ok: false };
}

/** Valid UTF-8 without NUL bytes. A truncated trailing multi-byte sequence (the head is a prefix) is fine. */
export function isUtf8Text(head: Uint8Array): boolean {
  if (head.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true });
    return true;
  } catch {
    return false;
  }
}
