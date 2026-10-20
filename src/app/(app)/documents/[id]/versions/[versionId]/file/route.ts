import { readVersionFile, samplePdf } from "@/features/documents/queries";
import { UnauthenticatedError } from "@/server/auth/session";

type RouteParams = { params: Promise<{ id: string; versionId: string }> };

/** Never cached, never sniffed: the bytes of a private document. */
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

function contentDisposition(download: boolean, fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * `GET /documents/[id]/versions/[versionId]/file` (`?download=1` for an attachment): the bytes of one version for the
 * detail viewer and the "Descargar" actions (PRD §8.9.3 "Historial"). Same read rules as the detail (session, every
 * role, archived only with the trash grant); anything not found answers a bare 404. Hito 1 serves mock bytes
 * (`readVersionFile`); a link version redirects to its URL.
 */
export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { id, versionId } = await params;
  let file: Awaited<ReturnType<typeof readVersionFile>>;
  try {
    file = await readVersionFile(id, versionId);
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return new Response(null, { status: 401, headers: PRIVATE_HEADERS });
    }
    throw error;
  }
  if (!file) return new Response(null, { status: 404, headers: PRIVATE_HEADERS });
  if (file.kind === "external") {
    return new Response(null, {
      status: 307,
      headers: { ...PRIVATE_HEADERS, Location: file.url },
    });
  }

  const download = new URL(request.url).searchParams.get("download") === "1";
  if (file.kind === "markdown") {
    return new Response(file.content, {
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": "text/markdown; charset=utf-8",
        // Shown as plain text even when opened inline: nothing in it can run.
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": contentDisposition(download, file.fileName),
      },
    });
  }
  if (file.kind === "pdf") {
    const bytes = samplePdf({
      title: file.title,
      lines: [file.fileName, `v${file.versionNumber}`],
    });
    return new Response(bytes.slice().buffer, {
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(download, file.fileName),
      },
    });
  }
  // Any other stored file: no bytes exist in Hito 1, so the download is a text placeholder with the stored name.
  return new Response(`${file.fileName}\n`, {
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": contentDisposition(true, file.fileName),
    },
  });
}
