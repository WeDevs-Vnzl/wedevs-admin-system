import { readSharedFile } from "@/features/portal/queries";
import { PORTAL_SECURITY_HEADERS } from "@/server/portal/headers";
import { PortalConfigError } from "@/server/portal/request-meta";

type RouteParams = { params: Promise<{ token: string; documentId: string }> };

const BASE_HEADERS = { ...PORTAL_SECURITY_HEADERS, "X-Content-Type-Options": "nosniff" };

function contentDisposition(attachment: boolean, fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `${attachment ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * `GET /api/s/[token]/files/[documentId]` (`?download=1` for an attachment): a document of a portal link (PRD §8.11,
 * DT-42, C22). Public by token; a key-protected document needs the signed unlock cookie of this link. A locked
 * document answers 403 and anything about the link a bare 404, both with no body; a missing portal secret in
 * production answers 503. Never cached, never indexed.
 */
export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { token, documentId } = await params;
  const download = new URL(request.url).searchParams.get("download") === "1";
  let file: Awaited<ReturnType<typeof readSharedFile>>;
  try {
    file = await readSharedFile(token, documentId, download);
  } catch (error) {
    // A missing portal secret in production: fail closed, say why in the server log only.
    if (error instanceof PortalConfigError) {
      console.error(`[portal] ${error.message}`);
      return new Response(null, { status: 503, headers: BASE_HEADERS });
    }
    throw error;
  }

  if (file.kind === "error")
    return new Response(null, { status: file.status, headers: BASE_HEADERS });
  if (file.kind === "redirect") {
    return new Response(null, { status: 307, headers: { ...BASE_HEADERS, Location: file.url } });
  }
  const body = typeof file.body === "string" ? file.body : file.body.slice().buffer;
  return new Response(body, {
    headers: {
      ...BASE_HEADERS,
      "Content-Type": file.contentType,
      "Content-Disposition": contentDisposition(file.attachment, file.fileName),
      ...(file.sandbox
        ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" }
        : {}),
    },
  });
}
