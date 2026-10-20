import "server-only";
import { idSchema } from "@/lib/validators/common";
import { shareTokenSchema, type PortalShareDTO } from "@/lib/validators/shares";
import { samplePdf } from "@/mocks/sample-pdf";
import * as portal from "@/mocks/services/portal-shares";
import { getPublicServiceContext, ServiceError } from "@/server/context";
import { getPortalRequest } from "@/server/portal/portal-request";

// Reads of the public portal (PRD §8.11, C22). Like the public actions they never read the session; the request
// metadata (IP hash, user agent, unlock cookie) is read on the server. Every failure about the link is `null` or a
// bare 404 for the caller, with no reason.

/**
 * The portal page of `token` plus a `VIEW` of the link, or `null` when the token is malformed, unknown, revoked or
 * expired (the page then answers the generic 404).
 */
export async function loadPortalPage(token: string): Promise<PortalShareDTO | null> {
  if (!shareTokenSchema.safeParse(token).success) return null;
  const ctx = getPublicServiceContext();
  const request = await getPortalRequest(token);
  try {
    const page = await portal.resolveShareToken(ctx, { token, ...request });
    await portal.recordShareAccess(ctx, {
      token,
      event: "VIEW",
      ipHash: request.ipHash,
      ...(request.userAgent ? { userAgent: request.userAgent } : {}),
    });
    return page;
  } catch (error) {
    if (error instanceof ServiceError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

/** What the download route answers for one shared document. */
export type SharedFileResponse =
  | { kind: "error"; status: 403 | 404 }
  | { kind: "redirect"; url: string }
  | {
      kind: "body";
      body: string | Uint8Array;
      contentType: string;
      fileName: string;
      attachment: boolean;
      /** Text-like bodies are served under a `sandbox` CSP: nothing in them can run. */
      sandbox: boolean;
    };

const MOCK_STORAGE = "mock-storage://";

/** A stand-in image for an image file: Hito 1 has no stored bytes. */
function placeholderImage(fileName: string): string {
  const label = fileName.replace(/[<>&"']/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="#f4f4f5"/><text x="400" y="255" font-family="Inter, sans-serif" font-size="24" text-anchor="middle" fill="#71717a">${label}</text></svg>`;
}

/**
 * A shared document for `/api/s/[token]/files/[documentId]`: inline for the viewer (no log; the viewer action logs
 * the `VIEW`), or as a download (`DOWNLOAD` logged by the service, refused when the link forbids downloads). A
 * locked document is a 403 on both; anything about the link is a bare 404. Hito 1 writes the bytes of a PDF from
 * the document data and serves other files as placeholders.
 */
export async function readSharedFile(
  token: string,
  documentId: string,
  download: boolean,
): Promise<SharedFileResponse> {
  if (!shareTokenSchema.safeParse(token).success || !idSchema.safeParse(documentId).success) {
    return { kind: "error", status: 404 };
  }
  const ctx = getPublicServiceContext();
  const request = await getPortalRequest(token, "api");
  const input = { token, documentId, ...request };
  try {
    const view = await portal.getSharedDocument(ctx, input);
    const { content } = view;
    if (content.format === "ENLACE") {
      if (download) await portal.getSharedDocumentDownload(ctx, input);
      return { kind: "redirect", url: content.url };
    }
    if (content.format === "MARKDOWN") {
      const fileName = download
        ? (await portal.getSharedDocumentDownload(ctx, input)).fileName
        : `${view.document.title}.md`;
      return {
        kind: "body",
        body: content.markdown,
        contentType: "text/markdown; charset=utf-8",
        fileName,
        attachment: download,
        sandbox: true,
      };
    }
    if (download) {
      const result = await portal.getSharedDocumentDownload(ctx, input);
      if (result.kind === "url" && !result.url.startsWith(MOCK_STORAGE)) {
        return { kind: "redirect", url: result.url };
      }
    }
    if (content.preview === "pdf") {
      return {
        kind: "body",
        body: samplePdf({
          title: view.document.title,
          lines: [content.fileName, `v${view.document.versionNumber}`],
        }),
        contentType: "application/pdf",
        fileName: content.fileName,
        attachment: download,
        sandbox: false,
      };
    }
    if (content.preview === "image") {
      return {
        kind: "body",
        body: placeholderImage(content.fileName),
        contentType: "image/svg+xml",
        fileName: content.fileName,
        attachment: download,
        sandbox: true,
      };
    }
    return {
      kind: "body",
      body: `${content.fileName}\n`,
      contentType: "text/plain; charset=utf-8",
      fileName: content.fileName,
      attachment: true,
      sandbox: true,
    };
  } catch (error) {
    if (error instanceof ServiceError && error.code === "FORBIDDEN") {
      return { kind: "error", status: 403 };
    }
    if (error instanceof ServiceError && error.code === "NOT_FOUND") {
      return { kind: "error", status: 404 };
    }
    throw error;
  }
}
