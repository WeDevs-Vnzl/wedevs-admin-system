"use server";

import { apiAction } from "@/lib/api/action";
import type {
  ConfirmUploadInput,
  FileDTO,
  RequestUploadInput,
  UploadTarget,
} from "@/lib/validators/files";

// Thin proxies over the files API (C10). The BE decides who may upload (the Viewer gets FORBIDDEN; the
// DT-41 limits and the magic bytes are enforced there); the client-side rules are a first line for UX only.

/** `UploadAdapter.requestUpload`: registers a PENDING file and returns the signed Cloudinary parameters. */
export const requestUploadAction = apiAction<RequestUploadInput, UploadTarget>({
  call: (input, api) => api.POST("/api/v1/files/upload-intent", { body: input }),
});

/** `UploadAdapter.confirmUpload`: the BE checks the uploaded bytes and the file becomes `READY`. */
export const confirmUploadAction = apiAction<ConfirmUploadInput, FileDTO>({
  call: (input, api) => api.POST("/api/v1/files", { body: { fileId: input.fileId } }),
});

/** Deletes the caller's own unattached upload (an attached file answers `INTEGRITY_LOCK`). */
export const deleteFileAction = apiAction<ConfirmUploadInput, undefined>({
  call: (input, api) =>
    api.DELETE("/api/v1/files/{id}", { params: { path: { id: input.fileId } } }),
});
