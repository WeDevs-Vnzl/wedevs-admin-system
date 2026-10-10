// MOCK — file services of Hito 1 (PRD §12 `files`, C23). `fn(ctx, input)`, framework-free (C11). Nothing is
// uploaded: `requestUpload` registers a `PENDING` file and returns no upload URL, `confirmUpload` flips it
// to `READY`. Hito 2 adds presigned URLs, the magic-bytes check and the allowlist on the server.
import type { FileDTO, RequestUploadInput, UploadTarget } from "@/lib/validators/files";
import type { MockServiceContext } from "../ctx";
import { ServiceError } from "../ctx";
import { nextMockId } from "../ids";

/** The file the browser finished uploading. Parsed by the action; the contract has no schema for it yet. */
export interface ConfirmUploadInput {
  fileId: string;
}

const FALLBACK_MIME = "application/octet-stream";

export async function requestUpload(
  ctx: MockServiceContext,
  input: RequestUploadInput,
): Promise<UploadTarget> {
  const files = ctx.db.files;
  const fileId = nextMockId(ctx.db.idCounters, "fil", (id) => files.some((file) => file.id === id));
  files.push({
    id: fileId,
    originalName: input.name,
    mimeType: input.mime || FALLBACK_MIME,
    sizeBytes: input.size,
    status: "PENDING",
    uploadedById: ctx.user.id,
    createdAt: ctx.now.toISOString(),
  });
  return { fileId, url: null };
}

/** Marks the caller's own upload `READY`. Idempotent; unknown or foreign ids are a plain `NOT_FOUND` (C14). */
export async function confirmUpload(
  ctx: MockServiceContext,
  input: ConfirmUploadInput,
): Promise<FileDTO> {
  const file = ctx.db.files.find((row) => row.id === input.fileId);
  if (!file || file.uploadedById !== ctx.user.id) throw new ServiceError("NOT_FOUND");
  file.status = "READY";
  return structuredClone(file);
}
