import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import enDocuments from "@/i18n/messages/en/documents.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import type { DocumentStatus } from "@/lib/validators/enums";
import { DocumentDetailHeader, type DocumentDetailHeaderProps } from "./document-detail-header";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./document-status-dialog", () => ({
  DocumentStatusDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="status dialog" /> : null,
}));

const base: DocumentDetailHeaderProps = {
  document: {
    id: "doc_1",
    code: "DOC-0001",
    title: "Contrato marco",
    status: "ENVIADO",
    archivedAt: null,
    tags: [],
    category: { id: "dcat_1", name: "Legales", nameEn: "Legal", color: "blue" },
    type: {
      id: "dtyp_1",
      name: "Contrato",
      nameEn: "Contract",
      defaultFormat: "ARCHIVO",
      requiresSignature: true,
      hasExpiration: true,
    },
  },
  canUpdate: true,
};

function renderHeader(
  status: DocumentStatus = "ENVIADO",
  props: Partial<DocumentDetailHeaderProps> = {},
) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ documents: enDocuments, enums: enEnums, patterns: enPatterns }}
    >
      <DocumentDetailHeader
        {...base}
        {...props}
        document={{ ...base.document, status, ...props.document }}
      />
    </NextIntlClientProvider>,
  );
}

describe("DocumentDetailHeader", () => {
  it("shows code, title, status and the localized category and type", () => {
    renderHeader();
    expect(screen.getByRole("heading", { name: "Contrato marco" })).toBeInTheDocument();
    expect(screen.getByText("DOC-0001")).toBeInTheDocument();
    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(screen.getByText("Legal · Contract")).toBeInTheDocument();
  });

  it("offers Edit details and Change status to an editor, and opens the status dialog", async () => {
    renderHeader();
    expect(screen.getByRole("link", { name: "Edit details" })).toHaveAttribute(
      "href",
      "/documents/doc_1/edit",
    );
    await userEvent.click(screen.getByRole("button", { name: "Change status" }));
    expect(screen.getByRole("dialog", { name: "status dialog" })).toBeInTheDocument();
  });

  it("offers no status change once no transition is left (VENCIDO, ANULADO)", () => {
    renderHeader("ANULADO");
    expect(screen.queryByRole("button", { name: "Change status" })).not.toBeInTheDocument();
  });

  it("offers no action to a reader nor on an archived document", () => {
    const { unmount } = renderHeader("ENVIADO", { canUpdate: false });
    expect(screen.queryByRole("link", { name: "Edit details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change status" })).not.toBeInTheDocument();
    unmount();
    renderHeader("ENVIADO", {
      document: { ...base.document, archivedAt: "2026-10-01T00:00:00.000Z" },
    });
    expect(screen.queryByRole("button", { name: "Change status" })).not.toBeInTheDocument();
  });

  it("points the Detail | Graph toggle to the document's pages", () => {
    renderHeader();
    // The toggle items are links rendered as radio items of the "Detail | Graph" group.
    expect(screen.getByText("Graph").closest("a")).toHaveAttribute(
      "href",
      "/documents/doc_1/graph",
    );
  });
});
