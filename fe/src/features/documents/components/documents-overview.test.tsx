import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import esDocuments from "@/i18n/messages/es/documents.json";
import esEnums from "@/i18n/messages/es/enums.json";
import esPatterns from "@/i18n/messages/es/patterns.json";
import esTable from "@/i18n/messages/es/table.json";
import type { DocumentListRowDTO, DocumentsOverviewDTO } from "@/lib/validators/documents";

const messages = { documents: esDocuments, enums: esEnums, patterns: esPatterns, table: esTable };

vi.mock("next-intl/server", () => ({
  getLocale: async () => "es",
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "es", messages, namespace: namespace as "documents" }),
}));
vi.mock("@/features/alerts/components/alert-list", () => ({
  AlertList: ({ types }: { types: readonly string[] }) => (
    <div data-testid="alert-list">{types.join(",")}</div>
  ),
}));

import { DocumentsOverview } from "./documents-overview";

const contracts = { id: "cat_1", name: "Contratos", nameEn: "Contracts", color: null };

function row(id: string, overrides: Partial<DocumentListRowDTO> = {}): DocumentListRowDTO {
  return {
    id,
    code: `DOC-${id}`,
    title: `Documento ${id}`,
    category: contracts,
    type: {
      id: "typ_1",
      name: "Contrato de servicios",
      nameEn: null,
      defaultFormat: "MARKDOWN",
      requiresSignature: true,
      hasExpiration: true,
    },
    status: "APROBADO",
    currentFormat: "MARKDOWN",
    currentVersionNumber: 2,
    links: [],
    expiresAt: "2026-11-01",
    isShared: false,
    tags: [],
    updatedAt: "2026-10-01T12:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

const overview: DocumentsOverviewDTO = {
  byCategoryAndStatus: [{ category: contracts, countByStatus: { BORRADOR: 2, APROBADO: 3 } }],
  expiringCounts: { days30: 2, days60: 4, days90: 7 },
  expiringSoon: [row("0001")],
  recent: [row("0002"), row("0003")],
  staleDrafts: [row("0004", { status: "BORRADOR" })],
};

async function renderOverview(canCreate = true) {
  const element = await DocumentsOverview({ overview, canCreate });
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      {element}
    </NextIntlClientProvider>,
  );
}

describe("DocumentsOverview", () => {
  it("shows the 30/60/90-day expiry counts and the stale drafts as KPIs, linked to the filtered table", async () => {
    await renderOverview();
    for (const [days, count] of [
      ["30", "2"],
      ["60", "4"],
      ["90", "7"],
    ] as const) {
      expect(screen.getByText(`Vencen en ${days} días`)).toBeInTheDocument();
      const link = screen.getByRole("link", { name: count });
      expect(decodeURIComponent(link.getAttribute("href")!)).toBe(
        `/documents/list?filters={"expiringWithinDays":"${days}"}`,
      );
    }
    expect(screen.getAllByText("Borradores estancados").length).toBeGreaterThan(0);
    expect(decodeURIComponent(screen.getByRole("link", { name: "1" }).getAttribute("href")!)).toBe(
      '/documents/list?filters={"staleDraft":"true"}',
    );
  });

  it("counts every category by status, with its total", async () => {
    await renderOverview();
    const card = screen
      .getByRole("heading", { name: "Por categoría y estado" })
      .closest("[data-slot=card]") as HTMLElement;
    expect(within(card).getByText("Contratos")).toBeInTheDocument();
    expect(within(card).getByText("Borrador")).toBeInTheDocument();
    expect(within(card).getByText("5")).toBeInTheDocument();
  });

  it("lists the expiring, recent and stale documents linked to their detail", async () => {
    await renderOverview();
    for (const id of ["0001", "0002", "0003", "0004"]) {
      expect(screen.getByRole("link", { name: `DOC-${id} Documento ${id}` })).toHaveAttribute(
        "href",
        `/documents/${id}`,
      );
    }
  });

  it("offers the table toggle, the create action only when allowed, and the document alerts", async () => {
    const { unmount } = await renderOverview(true);
    expect(screen.getByText(esPatterns.overviewToggle.table).closest("a")).toHaveAttribute(
      "href",
      "/documents/list",
    );
    expect(screen.getByRole("link", { name: /Nuevo documento/ })).toHaveAttribute(
      "href",
      "/documents/new",
    );
    expect(screen.getByTestId("alert-list")).toHaveTextContent(
      "DOCUMENT_EXPIRING,DOCUMENT_EXPIRED",
    );
    unmount();
    await renderOverview(false);
    expect(screen.queryByRole("link", { name: /Nuevo documento/ })).not.toBeInTheDocument();
  });
});
