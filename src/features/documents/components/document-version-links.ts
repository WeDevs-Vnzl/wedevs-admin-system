import type { DocumentVersionRowDTO } from "@/lib/validators/documents";

/** Page of one version (`/documents/[id]/versions/[versionId]`), plus an optional sub-path (`/compare`). */
export function versionHref(documentId: string, versionId: string, suffix = ""): string {
  return `/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}${suffix}`;
}

/** Where a version's bytes are read: the version file route, or the URL itself for a link version. */
export function versionFileHref(
  documentId: string,
  version: Pick<DocumentVersionRowDTO, "id" | "format" | "url">,
  download: boolean,
): string {
  if (version.format === "ENLACE" && version.url) return version.url;
  const base = versionHref(documentId, version.id, "/file");
  return download ? `${base}?download=1` : base;
}
