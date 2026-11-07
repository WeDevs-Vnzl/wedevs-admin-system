import type { ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import esCommon from "@/i18n/messages/es/common.json";
import esEnums from "@/i18n/messages/es/enums.json";
import esInvoices from "@/i18n/messages/es/invoices.json";
import esPatterns from "@/i18n/messages/es/patterns.json";
import esTable from "@/i18n/messages/es/table.json";
import esValidation from "@/i18n/messages/es/validation.json";
import type { InvoiceResponseDto } from "@/lib/api/types/invoices";
import { multiRateInvoice } from "../test-data";
import {
  archiveInvoiceAction,
  issueDraftAction,
  voidInvoiceAction,
} from "@/features/invoices/actions";
import { InvoiceDetail } from "./invoice-detail";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
    refresh: mocks.refresh,
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
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

beforeEach(() => {
  vi.clearAllMocks();
});

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function seededInvoice(): InvoiceResponseDto {
  return multiRateInvoice();
}

function renderDetail(invoice: InvoiceResponseDto, canUpdate = true, paymentLinks?: ReactNode) {
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
        <InvoiceDetail invoice={invoice} canUpdate={canUpdate} paymentLinks={paymentLinks} />
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

  it("shows the totals and the per-rate tax lines exactly as the BE returned them (C17, choice 6)", () => {
    renderDetail(seededInvoice());
    // 160.01 = 160.00 + the 0.01 adjustment: the figure is the response's, not recomputed.
    expect(screen.getAllByText(/160[.,]01/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/200[.,]01/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2[.,]?000[.,]01/).length).toBeGreaterThan(0);
  });

  it("issues a draft and refreshes", async () => {
    vi.mocked(issueDraftAction).mockResolvedValue({ ok: true, data: seededInvoice() });
    renderDetail(seededInvoice());
    await userEvent.setup().click(screen.getByRole("button", { name: "Emitir" }));
    await waitFor(() => expect(issueDraftAction).toHaveBeenCalledWith({ id: "inv_1" }));
    expect(mocks.toast.success).toHaveBeenCalledWith(esInvoices.toast.issued);
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("shows the BE's refusal key when archiving fails (DT-128 copy comes from the BE key)", async () => {
    vi.mocked(archiveInvoiceAction).mockResolvedValue({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "invoices.errors.hasAllocations" },
    });
    renderDetail(seededInvoice());
    await userEvent.setup().click(screen.getByRole("button", { name: "Archivar" }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(esInvoices.errors.hasAllocations),
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("voids with a reason and falls back to the generic text for a key the catalogs lack", async () => {
    vi.mocked(voidInvoiceAction).mockResolvedValue({
      ok: false,
      error: { code: "CONFLICT", message: "common.errors.CONFLICT" },
    });
    renderDetail(seededInvoice());
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Anular" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox"), "Duplicada");
    await user.click(within(dialog).getByRole("button", { name: esInvoices.void.confirm }));
    await waitFor(() =>
      expect(voidInvoiceAction).toHaveBeenCalledWith({ id: "inv_1", reason: "Duplicada" }),
    );
    expect(mocks.toast.error).toHaveBeenCalledWith(esCommon.errors.CONFLICT);
  });

  it("hides every write action for a role without update", () => {
    renderDetail(seededInvoice(), false);
    expect(screen.queryByRole("button", { name: "Emitir" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Editar" })).not.toBeInTheDocument();
  });

  it("renders the paymentLinks node at the foot of the Pagos tab only", async () => {
    renderDetail(seededInvoice(), true, <p>panel-de-enlaces</p>);
    expect(screen.queryByText("panel-de-enlaces")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("tab", { name: "Pagos" }));
    expect(await screen.findByText("panel-de-enlaces")).toBeInTheDocument();
  });

  it("renders the Pagos tab as before without paymentLinks", async () => {
    renderDetail(seededInvoice());
    await userEvent.setup().click(screen.getByRole("tab", { name: "Pagos" }));
    expect(await screen.findByText(esInvoices.payments.empty.title)).toBeInTheDocument();
    expect(screen.queryByText("panel-de-enlaces")).not.toBeInTheDocument();
  });

  it("keeps the 3.4 props and adds only the optional paymentLinks one (frozen export)", () => {
    expectTypeOf(InvoiceDetail).parameter(0).toEqualTypeOf<{
      invoice: InvoiceResponseDto;
      canUpdate: boolean;
      paymentLinks?: ReactNode;
    }>();
  });
});
