import { fileDownloadPath } from "@/lib/api/file-url";
import type { DocumentVersionRowDTO } from "@/lib/validators/documents";

/** Page of one version (`/documents/[id]/versions/[versionId]`), plus an optional sub-path (`/compare`). */
export function versionHref(documentId: string, versionId: string, suffix = ""): string {
  return `/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}${suffix}`;
}

/** An `http(s)` address as stored, or `null` for any other scheme (never linked, so never `javascript:`). */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Where a version's bytes are read (one convention, DT-206): an `ARCHIVO` version through the authenticated file
 * download route (view and download alike), an `ENLACE` version at its stored `http(s)` URL, and a markdown version
 * through the version route, which serves only the `.md` attachment. `null` when there is nothing safe to link.
 */
export function versionFileHref(
  documentId: string,
  version: Pick<DocumentVersionRowDTO, "id" | "format" | "url" | "file">,
): string | null {
  if (version.format === "ENLACE") return safeExternalUrl(version.url);
  if (version.format === "ARCHIVO") return version.file ? fileDownloadPath(version.file.id) : null;
  return versionHref(documentId, version.id, "/file");
}
