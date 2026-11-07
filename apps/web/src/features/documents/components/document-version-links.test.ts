import { describe, expect, it } from "vitest";
import { fileDownloadPath } from "@/lib/api/file-url";
import { safeExternalUrl, versionFileHref, versionHref } from "./document-version-links";

const file = {
  id: "fil_1",
  originalName: "a.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1,
  status: "READY" as const,
  uploadedById: "usr_1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("versionFileHref (one download-route convention)", () => {
  it("links an ARCHIVO version to the authenticated file route, for view and download alike", () => {
    expect(versionFileHref("doc_1", { id: "v1", format: "ARCHIVO", url: null, file })).toBe(
      fileDownloadPath("fil_1"),
    );
  });

  it("links nothing for an ARCHIVO version with no file", () => {
    expect(
      versionFileHref("doc_1", { id: "v1", format: "ARCHIVO", url: null, file: null }),
    ).toBeNull();
  });

  it("opens an ENLACE version at its stored http(s) URL and links no other scheme", () => {
    const link = (url: string) => ({ id: "v1", format: "ENLACE" as const, url, file: null });
    expect(versionFileHref("doc_1", link("https://example.com/x"))).toBe("https://example.com/x");
    expect(versionFileHref("doc_1", link("http://example.com/x"))).toBe("http://example.com/x");
    expect(versionFileHref("doc_1", link("javascript:alert(1)"))).toBeNull();
    expect(versionFileHref("doc_1", link("data:text/html,x"))).toBeNull();
    expect(versionFileHref("doc_1", link("not a url"))).toBeNull();
  });

  it("serves a markdown version from the version route (the attachment)", () => {
    expect(versionFileHref("doc_1", { id: "v 1", format: "MARKDOWN", url: null, file: null })).toBe(
      versionHref("doc_1", "v 1", "/file"),
    );
  });

  it("safeExternalUrl answers null for empty values", () => {
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl("")).toBeNull();
  });
});
