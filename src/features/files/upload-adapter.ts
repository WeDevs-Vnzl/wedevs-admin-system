import type { UploadAdapter } from "@/lib/validators/files";
import { confirmUploadAction, requestUploadAction } from "./actions";

/**
 * `UploadAdapter` (C23) over the file actions: the only storage seam the `Uploader` uses
 * (frontend-patterns §6). Hito 2 keeps `requestUpload` / `confirmUpload` and replaces `put` with the PUT
 * to the presigned URL.
 */
export const uploadAdapter: UploadAdapter = {
  requestUpload: (input) => requestUploadAction(input),
  // MOCK: the Hito 1 target has no URL, so there are no bytes to send; report completion only.
  async put(target, _file, options) {
    options?.onProgress?.(1);
  },
  confirmUpload: (fileId) => confirmUploadAction({ fileId }),
};
