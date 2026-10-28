import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enDocuments from "@/i18n/messages/en/documents.json";
import enEnums from "@/i18n/messages/en/enums.json";
import type { DocumentDetailDTO, DocumentVersionDetailDTO } from "@/lib/validators/documents";
import { DocumentDetailContent } from "./document-detail-content";

const pdfViewer = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/pdf-viewer", () => ({
  PdfViewer: (props: { url: string; onDownload: () => void }) => {
    pdfViewer(props);
    return (
      <button type="button" onClick={props.onDownload}>
        pdf viewer
      </button>
    );
  },
}));
vi.mock("./document-version-upload-dialog", () => ({
  DocumentVersionUploadDialog: ({ format, signed }: { format: string; signed: boolean }) => (
    <span data-testid="upload">{`${format}:${signed}`}</span>
  ),
}));

const author = { id: "usr_1", name: "Valeria Rojas", imageUrl: null };

function version(overrides: Partial<DocumentVersionDetailDTO>): DocumentVersionDetailDTO {
  return {
    id: "dver_2",
    documentId: "doc_1",
    versionNumber: 2,
    format: "MARKDOWN",
    file: null,
    url: null,
    changelog: null,
    createdBy: author,
    createdAt: "2026-10-02T15:00:00.000Z",
    isCurrent: true,
    content: null,
    ...overrides,
  };
}

function detail(
  currentVersion: DocumentVersionDetailDTO | null,
  overrides: Partial<DocumentDetailDTO> = {},
): DocumentDetailDTO {
  return {
    id: "doc_1",
    code: "DOC-0001",
    title: "PRD Kairos",
    type: {
      id: "dtyp_prd",
      name: "PRD",
      nameEn: "PRD",
      defaultFormat: "MARKDOWN",
      requiresSignature: false,
      hasExpiration: false,
    },
    category: { id: "dcat_1", name: "Técnicos", nameEn: "Technical", color: "blue" },
    summary: null,
    status: "BORRADOR",
    effectiveDate: null,
    signedAt: null,
    expiresAt: null,
    alertDaysBefore: 30,
    currentVersion,
    versionCount: currentVersion ? 2 : 0,
    draftContent: null,
    draftUpdatedAt: null,
    links: [],
    tags: [],
    isShared: false,
    createdBy: author,
    createdAt: "2026-10-01T15:00:00.000Z",
    updatedAt: "2026-10-02T15:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

function renderContent(document: DocumentDetailDTO, canUpdate = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ documents: enDocuments, enums: enEnums }}>
      <DocumentDetailContent document={document} canUpdate={canUpdate} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  pdfViewer.mockReset();
});

describe("DocumentDetailContent (S7 'Contenido')", () => {
  it("renders markdown sanitized, with Edit to the editor and the print action", () => {
    renderContent(detail(version({ content: "# Alcance\n\n<script>alert(1)</script>Texto" })));
    expect(screen.getByRole("heading", { name: "Alcance" })).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/documents/doc_1/editor",
    );
    expect(screen.getByRole("button", { name: "Print / Save as PDF" })).toBeInTheDocument();
  });

  it("offers no Edit to a reader nor on a signed document", () => {
    const { unmount } = renderContent(detail(version({ content: "Texto" })), false);
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    unmount();
    renderContent(detail(version({ content: "Texto" }), { status: "FIRMADO" }));
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    expect(
      screen.getByText("This document is signed: it accepts no new versions."),
    ).toBeInTheDocument();
  });

  it("shows a PDF in the viewer through the version file route, and downloads from it", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    renderContent(
      detail(
        version({
          format: "ARCHIVO",
          file: {
            id: "fil_1",
            originalName: "contrato.pdf",
            mimeType: "application/pdf",
            sizeBytes: 2048,
            status: "READY",
            uploadedById: "usr_1",
            createdAt: "2026-10-02T15:00:00.000Z",
          },
        }),
      ),
    );
    expect(pdfViewer).toHaveBeenCalledWith(
      expect.objectContaining({ url: "/documents/doc_1/versions/dver_2/file" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "pdf viewer" }));
    expect(assign).toHaveBeenCalledWith("/documents/doc_1/versions/dver_2/file?download=1");
    expect(screen.getByTestId("upload")).toHaveTextContent("ARCHIVO:false");
    vi.unstubAllGlobals();
  });

  it("shows another file type as a download card", () => {
    renderContent(
      detail(
        version({
          format: "ARCHIVO",
          file: {
            id: "fil_2",
            originalName: "wireframes.png",
            mimeType: "image/png",
            sizeBytes: 2048,
            status: "READY",
            uploadedById: "usr_1",
            createdAt: "2026-10-02T15:00:00.000Z",
          },
        }),
      ),
    );
    expect(pdfViewer).not.toHaveBeenCalled();
    expect(screen.getByText("wireframes.png")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      "/documents/doc_1/versions/dver_2/file?download=1",
    );
  });

  it("opens a link version in a new tab and offers 'Update link'", () => {
    renderContent(detail(version({ format: "ENLACE", url: "https://vault.example.com/k" })));
    const open = screen.getByRole("link", { name: "Open link" });
    expect(open).toHaveAttribute("href", "https://vault.example.com/k");
    expect(open).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByTestId("upload")).toHaveTextContent("ENLACE:false");
  });

  it("without a version: an empty state with the way to publish the first one", () => {
    const { unmount } = renderContent(detail(null));
    expect(screen.getByText("No published version")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/documents/doc_1/editor",
    );
    unmount();
    renderContent(
      detail(null, {
        type: {
          id: "dtyp_c",
          name: "Contrato",
          nameEn: "Contract",
          defaultFormat: "ARCHIVO",
          requiresSignature: true,
          hasExpiration: true,
        },
      }),
    );
    expect(screen.getByTestId("upload")).toHaveTextContent("ARCHIVO:false");
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  });
});
