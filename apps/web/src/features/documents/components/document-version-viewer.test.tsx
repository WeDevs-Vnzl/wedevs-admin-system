import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import enDocuments from "@/i18n/messages/en/documents.json";
import { DocumentVersionViewer } from "./document-version-viewer";

vi.mock("@/components/ui/pdf-viewer", () => ({ PdfViewer: () => null }));

const base = {
  id: "ver_1",
  documentId: "doc_1",
  versionNumber: 1,
  format: "MARKDOWN" as const,
  file: null,
  url: null,
  changelog: null,
  createdBy: { id: "usr_1", name: "Ana", imageUrl: null },
  createdAt: "2026-01-01T00:00:00.000Z",
  isCurrent: true,
};

describe("DocumentVersionViewer", () => {
  it("never lets a <script> or an on* handler in returned markdown reach the DOM (HU-18 CA4)", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={{ documents: enDocuments }}>
        <DocumentVersionViewer
          documentId="doc_1"
          version={{
            ...base,
            content: '# Hola\n\n<script>alert(1)</script><img src=x onerror="alert(2)">',
          }}
        />
      </NextIntlClientProvider>,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).not.toContain("onerror");
    expect(container).toHaveTextContent("Hola");
  });
});
