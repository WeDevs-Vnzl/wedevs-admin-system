import { notFound, redirect } from "next/navigation";
import { SIGN_IN_PATH } from "@/lib/api/errors";
import { getServerApi } from "@/lib/api/server";

type RouteParams = { params: Promise<{ id: string; versionId: string }> };

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

/** The same handling as the 1.3 file route: `401` sign-in, `404`/`403` not-found, anything else `502`. */
function failure(status: number): Response {
  if (status === 401) redirect(SIGN_IN_PATH);
  if (status === 404 || status === 403) notFound();
  return new Response(null, { status: 502, headers: HEADERS });
}

/**
 * `GET /documents/[id]/versions/[versionId]/file`: the markdown attachment `<code>-v<n>.md` of one markdown version
 * (the history's "Descargar" for a version with no file behind it). Files are viewed and downloaded through
 * `/files/[id]/download` and links open their own URL, so any other version is not-found here. A relay: the BE
 * decides who may read the version; the bytes are its stored `content`.
 */
export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  const { id, versionId } = await params;
  const api = await getServerApi();
  // The version carries no document code, which names the file: read both.
  const version = await api.GET("/api/v1/documents/{id}/versions/{versionId}", {
    params: { path: { id, versionId } },
  });
  if (!version.data) return failure(version.response.status);
  if (version.data.format !== "MARKDOWN") notFound();
  const document = await api.GET("/api/v1/documents/{id}", { params: { path: { id } } });
  if (!document.data) return failure(document.response.status);

  const fileName = `${document.data.code}-v${version.data.versionNumber}.md`;
  return new Response(version.data.content ?? "", {
    headers: {
      ...HEADERS,
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
