/**
 * Upload rules per context (DT-41, C23). Ported from `fe/src/lib/validators/files.ts`. The BE repeats them
 * at upload-intent time and again at confirm time, where the real type is read from magic bytes.
 */

const MB = 1024 * 1024;

export const UPLOAD_CONTEXT_VALUES = ['general', 'payment_receipt'] as const;
export type UploadContext = (typeof UPLOAD_CONTEXT_VALUES)[number];

/** i18n keys of the file validations (the FE translates them). */
export const FILE_VALIDATION_KEYS = {
  nameInvalid: 'validation.file.nameInvalid',
  typeNotAllowed: 'validation.file.typeNotAllowed',
  empty: 'validation.file.empty',
  tooLarge: 'validation.file.tooLarge',
  tooLargeMax: 'validation.file.tooLargeMax',
} as const;

const PDF = ['application/pdf'] as const;
const RECEIPT_IMAGES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const OFFICE = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // XLSX
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // PPTX
] as const;
/** Text types have no magic bytes: they are accepted by declared type plus a UTF-8 check. */
export const TEXT_MIME_TYPES = ['text/markdown', 'text/x-markdown', 'text/plain'] as const;
const ZIP = ['application/zip', 'application/x-zip-compressed'] as const;

export interface UploadRules {
  readonly maxBytes: number;
  readonly allowedMimeTypes: readonly string[];
  /** Lower-case extensions (with dot) that match the allowed types. */
  readonly allowedExtensions: readonly string[];
}

export const UPLOAD_RULES: Readonly<Record<UploadContext, UploadRules>> = {
  general: {
    maxBytes: 25 * MB,
    allowedMimeTypes: [
      ...PDF,
      ...RECEIPT_IMAGES,
      'image/gif',
      ...OFFICE,
      ...TEXT_MIME_TYPES,
      ...ZIP,
    ],
    allowedExtensions: [
      '.pdf',
      '.png',
      '.jpg',
      '.jpeg',
      '.webp',
      '.gif',
      '.docx',
      '.xlsx',
      '.pptx',
      '.md',
      '.txt',
      '.zip',
    ],
  },
  payment_receipt: {
    maxBytes: 10 * MB,
    allowedMimeTypes: [...PDF, ...RECEIPT_IMAGES],
    allowedExtensions: ['.pdf', '.png', '.jpg', '.jpeg', '.webp'],
  },
};

export function getUploadRules(context: UploadContext): UploadRules {
  return UPLOAD_RULES[context];
}

export interface UploadCandidate {
  readonly name: string;
  readonly mime: string;
  readonly size: number;
}

/** First violation of `checkUpload`: an i18n key plus the values its message interpolates, if any. */
export type UploadViolation =
  | { readonly key: typeof FILE_VALIDATION_KEYS.typeNotAllowed }
  | { readonly key: typeof FILE_VALIDATION_KEYS.empty }
  | {
      readonly key: typeof FILE_VALIDATION_KEYS.tooLargeMax;
      readonly values: { readonly max: number };
    };

/** `application/pdf; charset=binary` -> `application/pdf`. */
export function normalizeMime(mime: string): string {
  return (mime.split(';')[0] ?? '').trim().toLowerCase();
}

/** Lower-case extension with its dot (`Notes.MD` -> `.md`), or `""` when the name has none. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.docx': OFFICE[0],
  '.xlsx': OFFICE[1],
  '.pptx': OFFICE[2],
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
};

const GENERIC_MIME = 'application/octet-stream';

/**
 * The type the client declares: the normalized MIME, or, when it is empty or `application/octet-stream`
 * (browsers do that for `.md`), the one implied by the extension. `""` when neither is known.
 */
export function resolveDeclaredMime(mime: string, name: string): string {
  const normalized = normalizeMime(mime);
  if (normalized !== '' && normalized !== GENERIC_MIME) return normalized;
  return MIME_BY_EXTENSION[fileExtension(name)] ?? '';
}

function isMimeAllowed(candidate: UploadCandidate, rules: UploadRules): boolean {
  const mime = normalizeMime(candidate.mime);
  if (mime !== '' && mime !== GENERIC_MIME) return rules.allowedMimeTypes.includes(mime);
  return rules.allowedExtensions.includes(fileExtension(candidate.name));
}

/**
 * Checks a file against the rules of its context and returns the first violation, or `null`. MIME
 * parameters are ignored; an empty or `application/octet-stream` MIME falls back to the extension.
 * `values.max` is a number of MB.
 */
export function checkUpload(
  candidate: UploadCandidate,
  context: UploadContext,
): UploadViolation | null {
  const rules = UPLOAD_RULES[context];
  if (!isMimeAllowed(candidate, rules)) return { key: FILE_VALIDATION_KEYS.typeNotAllowed };
  if (candidate.size <= 0) return { key: FILE_VALIDATION_KEYS.empty };
  if (candidate.size > rules.maxBytes) {
    return { key: FILE_VALIDATION_KEYS.tooLargeMax, values: { max: rules.maxBytes / MB } };
  }
  return null;
}

/** Original file name: 1-255 chars, no path separators or control characters, no edge whitespace. */
export function isSafeFileName(name: string): boolean {
  if (name.length < 1 || name.length > 255) return false;
  if (name.trim() !== name || name === '.' || name === '..') return false;
  for (const char of name) {
    const code = char.charCodeAt(0);
    if (char === '/' || char === '\\' || code < 32 || code === 127) return false;
  }
  return true;
}
