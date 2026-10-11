import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enDocuments from "@/i18n/messages/en/documents.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import esDocuments from "@/i18n/messages/es/documents.json";
import esEnums from "@/i18n/messages/es/enums.json";
import esPatterns from "@/i18n/messages/es/patterns.json";
import type { DocumentListRowDTO } from "@/lib/validators/documents";

const queries = vi.hoisted(() => ({
  listEntityDocuments: vi.fn(),
  listDocumentCategories: vi.fn(),
  getDocumentPermissions: vi.fn(),
}));
const locale = vi.hoisted(() => ({ value: "en" as "en" | "es" }));

vi.mock("../queries", () => queries);
vi.mock("./attach-document-sheet", () => ({
  AttachDocumentSheet: () => <button type="button">attach-sheet</button>,
}));
vi.mock("./document-row-actions", () => ({
  DocumentRowActions: () => <button type="button">row-unlink</button>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = () => ({
    documents: locale.value === "es" ? esDocuments : enDocuments,
    enums: locale.value === "es" ? esEnums : enEnums,
  });
  return {
    getTranslations: async (namespace: string) =>
      // The mock accepts any namespace of the messages it is given.
      createTranslator({
        locale: locale.value,
        messages: messages() as never,
        namespace: namespace as never,
      }),
    getLocale: async () => locale.value,
  };
});

import { EntityDocumentsTab } from "./entity-documents-tab";

const clientRow: DocumentListRowDTO = {
  id: "doc_0001",
  code: "DOC-0001",
  title: "Contrato marco",
  category: { id: "dcat_legal", name: "Legal", nameEn: "Legal", color: null },
  type: {
    id: "dtyp_contrato",
    name: "Contrato",
    nameEn: "Contract",
    defaultFormat: "ARCHIVO",
    requiresSignature: false,
    hasExpiration: false,
  },
  status: "APROBADO",
  currentFormat: "ARCHIVO",
  currentVersionNumber: 2,
  links: [{ id: "cli_0001", label: "Cliente", type: "CLIENT", code: "CLI-0001" }],
  expiresAt: null,
  isShared: false,
  tags: [],
  updatedAt: "2026-10-01T12:00:00.000Z",
  archivedAt: null,
};

const categories = [
  {
    id: "dcat_legal",
    name: "Legal",
    nameEn: "Legal",
    color: null,
    order: 1,
    types: [
      {
        id: "dtyp_contrato",
        name: "Contrato",
        nameEn: "Contract",
        defaultFormat: "ARCHIVO",
        requiresSignature: false,
        hasExpiration: false,
        active: true,
        documentCount: 1,
      },
    ],
  },
  {
    id: "dcat_finanzas",
    name: "Finanzas",
    nameEn: "Finance",
    color: null,
    order: 2,
    types: [],
  },
];

async function renderTab(loc: "en" | "es" = "en") {
  locale.value = loc;
  const messages = {
    documents: loc === "es" ? esDocuments : enDocuments,
    enums: loc === "es" ? esEnums : enEnums,
    patterns: loc === "es" ? esPatterns : enPatterns,
  };
  const tab = await EntityDocumentsTab({ entity: { type: "CLIENT", id: "cli_0001" } });
  return render(
    <NextIntlClientProvider locale={loc} messages={messages}>
      {tab}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  queries.listEntityDocuments
    .mockReset()
    .mockResolvedValue({ items: [clientRow], total: 1, page: 1, pageSize: 100 });
  queries.listDocumentCategories.mockReset().mockResolvedValue(categories);
  queries.getDocumentPermissions
    .mockReset()
    .mockResolvedValue({ canCreate: true, canUpdate: true });
});

describe("EntityDocumentsTab", () => {
  it("lists the linked documents with code, title, type, status, version and a link to the document", async () => {
    await renderTab();
    const row = screen.getByRole("row", { name: /DOC-0001/ });
    expect(within(row).getByRole("link", { name: "Contrato marco" })).toHaveAttribute(
      "href",
      "/documents/doc_0001",
    );
    expect(within(row).getByText("Contract")).toBeInTheDocument();
    expect(within(row).getByText("v2")).toBeInTheDocument();
    expect(queries.listEntityDocuments).toHaveBeenCalledWith({ type: "CLIENT", id: "cli_0001" });
  });

  it("shows the category chips with their counts, from the catalog", async () => {
    await renderTab();
    expect(screen.getByText("Legal · 1")).toBeInTheDocument();
    expect(screen.getByText("Finance · 0")).toBeInTheDocument();
  });

  it("gives Owner, Admin and Member the attach sheet and the unlink control", async () => {
    await renderTab();
    expect(screen.getByText("attach-sheet")).toBeInTheDocument();
    expect(screen.getByText("row-unlink")).toBeInTheDocument();
  });

  it("gives a Viewer a read-only table: no attach, no unlink", async () => {
    queries.getDocumentPermissions.mockResolvedValue({ canCreate: false, canUpdate: false });
    await renderTab();
    expect(screen.queryByText("attach-sheet")).not.toBeInTheDocument();
    expect(screen.queryByText("row-unlink")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contrato marco" })).toBeInTheDocument();
  });

  it("shows the empty state when the record has no documents", async () => {
    queries.listEntityDocuments.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
    await renderTab();
    expect(screen.getByText("This record has no linked documents.")).toBeInTheDocument();
  });

  it("renders in Spanish", async () => {
    await renderTab("es");
    expect(screen.getByRole("heading", { name: /Documentos/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Código" })).toBeInTheDocument();
    expect(screen.getByText("Legal · 1")).toBeInTheDocument();
  });
});
