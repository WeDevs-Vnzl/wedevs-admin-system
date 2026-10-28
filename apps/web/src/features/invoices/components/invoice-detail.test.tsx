import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeAll, describe, expect, it, vi } from "vitest";
import esCommon from "@/i18n/messages/es/common.json";
import esEnums from "@/i18n/messages/es/enums.json";
import esInvoices from "@/i18n/messages/es/invoices.json";
import esPatterns from "@/i18n/messages/es/patterns.json";
import esTable from "@/i18n/messages/es/table.json";
import esValidation from "@/i18n/messages/es/validation.json";
import { makeTestContext } from "@/mocks/test-helpers";
import type { InvoiceDetailDTO } from "@/lib/validators/invoices";
import { InvoiceDetail } from "./invoice-detail";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/invoices/x",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/features/invoices/actions", () => ({
  archiveInvoiceAction: vi.fn(),
  issueDraftAction: vi.fn(),
  voidInvoiceAction: vi.fn(),
  attachInvoiceFileAction: vi.fn(),
}));
vi.mock("@/features/files/actions", () => ({
  confirmUploadAction: vi.fn(),
  requestUploadAction: vi.fn(),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function seededInvoice(): InvoiceDetailDTO {
  const invoice = makeTestContext().db.invoices.find((row) => row.code === "FAC-0001");
  if (!invoice) throw new Error("FAC-0001 fixture missing");
  return { ...invoice, isDraft: true };
}

function renderDetail(invoice: InvoiceDetailDTO, canUpdate = true) {
  return render(
    <NextIntlClientProvider
      locale="es"
      timeZone="America/Caracas"
      messages={{
        common: esCommon,
        enums: esEnums,
        invoices: esInvoices,
        patterns: esPatterns,
        table: esTable,
        validation: esValidation,
      }}
    >
      <NuqsTestingAdapter>
        <InvoiceDetail invoice={invoice} canUpdate={canUpdate} />
      </NuqsTestingAdapter>
    </NextIntlClientProvider>,
  );
}

describe("InvoiceDetail", () => {
  it("keeps the header: number, code and client, and Editar / Emitir for an editable draft", () => {
    const invoice = seededInvoice();
    renderDetail(invoice);

    expect(
      screen.getByRole("heading", { level: 1, name: invoice.invoiceNumber }),
    ).toBeInTheDocument();
    expect(screen.getByText(`${invoice.code} · ${invoice.client.label}`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Editar" })).toHaveAttribute(
      "href",
      `/invoices/${invoice.id}/edit`,
    );
    expect(screen.getByRole("button", { name: "Emitir" })).toBeInTheDocument();
  });

  it('switches to the graph with the shared "Detalle | Grafo" toggle instead of an action link (A4)', () => {
    const invoice = seededInvoice();
    renderDetail(invoice, false);

    expect(screen.getByRole("radiogroup", { name: "Vista" })).toBeInTheDocument();
    expect(screen.getByText("Detalle").closest("a")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Grafo").closest("a")).toHaveAttribute(
      "href",
      `/invoices/${invoice.id}/graph`,
    );
    // The old "Grafo" action link is gone: the toggle items are radios.
    expect(screen.queryByRole("link", { name: /Grafo/ })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Grafo" })).toBeInTheDocument();
  });
});
