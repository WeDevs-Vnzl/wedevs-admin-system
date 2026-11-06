import { errorMessageKey, type ActionResult } from "@/lib/validators/common";
import {
  requestUploadInputSchema,
  type FileDTO,
  type RequestUploadInput,
  type UploadAdapter,
  type UploadTarget,
} from "@/lib/validators/files";
import { confirmUploadAction, requestUploadAction } from "./actions";

/**
 * `UploadAdapter` (C23) over the files API: the only storage seam the `Uploader` uses (frontend-patterns
 * §6). `requestUpload` asks the BE for a signed Cloudinary intent, `put` posts the bytes straight from the
 * browser (multipart, no token) and `confirmUpload` lets the BE verify them. FROZEN signature (DT-218).
 */

/** Cloudinary answers these when the signature is stale or refused: the intent is re-requested once. */
const STALE_INTENT_STATUS = new Set([400, 401, 403]);

/** Input remembered per file id so an expired intent can be re-requested from `put`. */
const requested = new Map<string, RequestUploadInput>();
/** Original file id → the id of the re-requested intent, so `confirmUpload` confirms the live one. */
const reissued = new Map<string, string>();

function isExpired(target: UploadTarget): boolean {
  return target.expiresAt !== undefined && Date.parse(target.expiresAt) <= Date.now();
}

/** Client-side first line (UX only): the BE enforces DT-41 and the magic bytes. */
function preCheck(input: RequestUploadInput): ActionResult<never> | null {
  const parsed = requestUploadInputSchema.safeParse(input);
  if (parsed.success) return null;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const path = String(issue.path[0] ?? "");
    (fieldErrors[path] ??= []).push(issue.message);
  }
  return {
    ok: false,
    error: {
      code: "VALIDATION",
      message: parsed.error.issues[0]?.message ?? errorMessageKey("VALIDATION"),
      fieldErrors,
    },
  };
}

async function reissue(originalId: string, current: UploadTarget): Promise<UploadTarget> {
  const input = requested.get(current.fileId);
  if (!input) throw new Error("upload intent expired and cannot be re-requested");
  const result = await requestUploadAction(input);
  if (!result.ok) throw new Error(result.error.message);
  requested.set(result.data.fileId, input);
  reissued.set(originalId, result.data.fileId);
  return result.data;
}

/**
 * Multipart POST of the bytes to the signed Cloudinary URL. It is not a BE call, so the typed client does not
 * apply (C7 forbids global `fetch` in UI code); XHR also gives real upload progress. Resolves the HTTP status.
 */
function postToCloudinary(
  target: UploadTarget,
  file: Blob,
  options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } | undefined,
): Promise<number> {
  const form = new FormData();
  for (const [name, value] of Object.entries(target.fields ?? {})) form.append(name, value);
  form.append("file", file);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", target.url as string);
    // No Authorization header: the signed fields are the credential (C23).
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0)
        options?.onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => resolve(xhr.status);
    xhr.onerror = () => reject(new Error("upload failed (network)"));
    xhr.onabort = () => reject(new Error("upload aborted"));
    options?.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

export const uploadAdapter: UploadAdapter = {
  async requestUpload(input) {
    const invalid = preCheck(input);
    if (invalid) return invalid;
    const result = await requestUploadAction(input);
    if (result.ok) requested.set(result.data.fileId, input);
    return result;
  },

  async put(target, file, options) {
    if (!target.url) throw new Error("upload target has no URL");
    let current = target;
    let retried = false;
    for (;;) {
      if (isExpired(current)) {
        if (retried) throw new Error("upload intent expired");
        current = await reissue(target.fileId, current);
        retried = true;
        continue;
      }
      options?.onProgress?.(0);
      const status = await postToCloudinary(current, file, options);
      if (status >= 200 && status < 300) {
        options?.onProgress?.(1);
        return;
      }
      if (retried || !STALE_INTENT_STATUS.has(status)) {
        throw new Error(`upload failed (${status})`);
      }
      current = await reissue(target.fileId, current);
      retried = true;
    }
  },

  async confirmUpload(fileId): Promise<ActionResult<FileDTO>> {
    const liveId = reissued.get(fileId) ?? fileId;
    const result = await confirmUploadAction({ fileId: liveId });
    if (result.ok) {
      requested.delete(fileId);
      requested.delete(liveId);
      reissued.delete(fileId);
    }
    return result;
  },
};
