import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import esCommon from "@/i18n/messages/es/common.json";
import esForms from "@/i18n/messages/es/forms.json";
import esInvoices from "@/i18n/messages/es/invoices.json";
import esValidation from "@/i18n/messages/es/validation.json";

const mocks = vi.hoisted(() => ({
  getServerApi: vi.fn(),
  refresh: vi.fn(),
  revalidatePath: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath, updateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import type {
  InvoicePaymentLinksResponseDto,
  PaymentLinkResponseDto,
} from "@/lib/api/types/payment-links";
import { PaymentLinksPanel } from "./payment-links-panel";

const listRoute = "GET /api/v1/invoices/{id}/payment-links";
const createRoute = "POST /api/v1/invoices/{id}/payment-links";
const deactivateRoute = "POST /api/v1/invoices/{id}/payment-links/{linkId}/deactivate";

function link(overrides: Partial<PaymentLinkResponseDto>): PaymentLinkResponseDto {
  return {
    id: "lnk_1",
    invoiceId: "inv_1",
    amount: "100.00",
    currency: "USD",
    status: "ACTIVE",
    url: "https://checkout.example/pay/abc",
    externalId: null,
    requestId: "5f3f3f3f-3f3f-4f3f-8f3f-3f3f3f3f3f3f",
    paymentId: null,
    createdAt: "2026-11-07T10:00:00.000Z",
    deactivatedAt: null,
    deactivationReason: null,
    settledAt: null,
    ...overrides,
  };
}

function listBody(
  links: PaymentLinkResponseDto[],
  capacity = "250.00",
): InvoicePaymentLinksResponseDto {
  return { capacity, links };
}

function useRoutes(routes: RouteTable) {
  const mocked = mockApi(routes);
  mocks.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

async function renderPanel(props: { currency?: string; canCreate?: boolean } = {}) {
  const element = await PaymentLinksPanel({
    invoiceId: "inv_1",
    currency: props.currency ?? "USD",
    canCreate: props.canCreate ?? true,
  });
  return render(
    <NextIntlClientProvider
      locale="es"
      timeZone="America/Caracas"
      messages={{
        common: esCommon,
        forms: esForms,
        invoices: esInvoices,
        validation: esValidation,
      }}
    >
      {element}
    </NextIntlClientProvider>,
  );
}

let uuidCount = 0;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getServerApi.mockReset();
  uuidCount = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(crypto, "randomUUID").mockImplementation(
    () => `00000000-0000-4000-8000-${String(++uuidCount).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`,
  );
});

describe("PaymentLinksPanel: reads (6.1)", () => {
  it("renders nothing on 404 (Stripe off) and no error", async () => {
    useRoutes({ [listRoute]: errorEnvelope("NOT_FOUND") });
    const { container } = await renderPanel();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing on a 5xx", async () => {
    useRoutes({ [listRoute]: errorEnvelope("INTERNAL") });
    const { container } = await renderPanel();
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PaymentLinksPanel: list (6.1)", () => {
  it("shows amount, status, created date, the capacity and the payment href", async () => {
    useRoutes({
      [listRoute]: {
        body: listBody([
          link({ id: "lnk_1", status: "SETTLED", paymentId: "pay_9", url: null }),
          link({ id: "lnk_2", status: "PENDING", url: null, amount: "40.00" }),
        ]),
      },
    });
    await renderPanel();
    expect(screen.getByText("Liquidado")).toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver pago" })).toHaveAttribute("href", "/payments/pay_9");
    expect(screen.getAllByText(/250[.,]00/).length).toBeGreaterThan(0);
    expect(screen.getByText(/40[.,]00/)).toBeInTheDocument();
    // 10:00 UTC is 06:00 in America/Caracas.
    expect(screen.getAllByText(/06:00/).length).toBeGreaterThan(0);
  });

  it("shows the empty copy without links", async () => {
    useRoutes({ [listRoute]: { body: listBody([]) } });
    await renderPanel();
    expect(screen.getByText(esInvoices.paymentLinks.empty)).toBeInTheDocument();
  });

  it("maps LINK_EXPIRED through its key and any other reason to the generic fallback, never raw", async () => {
    useRoutes({
      [listRoute]: {
        body: listBody([
          link({ id: "lnk_1", status: "DEACTIVATED", url: null, deactivationReason: "LINK_EXPIRED" }),
          link({ id: "lnk_2", status: "DEACTIVATED", url: null, deactivationReason: "SOMETHING_NEW" }),
        ]),
      },
    });
    await renderPanel();
    expect(screen.getByText(esInvoices.paymentLinks.reasons.LINK_EXPIRED, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(esInvoices.paymentLinks.reasons.generic, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("SOMETHING_NEW")).not.toBeInTheDocument();
  });

  it("offers open and copy only for ACTIVE links with an https URL", async () => {
    useRoutes({
      [listRoute]: {
        body: listBody([
          link({ id: "lnk_1", status: "ACTIVE", url: "https://checkout.example/a" }),
          link({ id: "lnk_2", status: "ACTIVE", url: "http://insecure.example/b" }),
          link({ id: "lnk_3", status: "ACTIVE", url: "javascript:alert(1)" }),
          link({ id: "lnk_4", status: "COMPLETED", url: "https://checkout.example/c" }),
          link({ id: "lnk_5", status: "DEACTIVATED", url: "https://checkout.example/d" }),
        ]),
      },
    });
    await renderPanel();
    const open = screen.getAllByRole("link", { name: "Abrir enlace" });
    expect(open).toHaveLength(1);
    expect(open[0]).toHaveAttribute("href", "https://checkout.example/a");
    expect(open[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getAllByRole("button", { name: "Copiar enlace" })).toHaveLength(1);
  });

  it("copies the URL without putting it in a toast", async () => {
    useRoutes({ [listRoute]: { body: listBody([link({})]) } });
    await renderPanel();
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    await user.click(screen.getByRole("button", { name: "Copiar enlace" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://checkout.example/pay/abc"));
    expect(JSON.stringify(mocks.toast.success.mock.calls)).not.toContain("checkout.example");
  });
});

describe("PaymentLinksPanel: create (6.1)", () => {
  async function openDialog() {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Crear enlace" }));
    const dialog = await screen.findByRole("dialog");
    return { user, dialog };
  }

  it("prefills the capacity and sends the amount and a requestId", async () => {
    const { calls } = useRoutes({
      [listRoute]: { body: listBody([]) },
      [createRoute]: { status: 201, body: link({}) },
    });
    await renderPanel();
    const { user, dialog } = await openDialog();
    expect(within(dialog).getByRole("textbox")).toHaveValue("250,00");
    await user.click(within(dialog).getByRole("button", { name: "Crear enlace" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    const post = calls.find((call) => call.method === "POST");
    expect(post?.body).toEqual({
      amount: "250.00",
      requestId: "00000000-0000-4000-8000-000000000001",
    });
    expect(mocks.toast.success).toHaveBeenCalledWith(esInvoices.paymentLinks.toast.created);
  });

  it("reuses the requestId on a retry inside the dialog and generates a new one on the next open", async () => {
    let attempt = 0;
    const { calls } = useRoutes({
      [listRoute]: { body: listBody([]) },
      [createRoute]: () =>
        ++attempt === 1 ? errorEnvelope("INTERNAL") : { status: 201, body: link({}) },
    });
    await renderPanel();
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole("button", { name: "Crear enlace" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(1));
    await user.click(within(dialog).getByRole("button", { name: "Crear enlace" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(2));
    const ids = calls.filter((c) => c.method === "POST").map((c) => (c.body as { requestId: string }).requestId);
    expect(ids[1]).toBe(ids[0]);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const second = await openDialog();
    await second.user.click(within(second.dialog).getByRole("button", { name: "Crear enlace" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(3));
    const third = (calls.filter((c) => c.method === "POST")[2]?.body as { requestId: string })
      .requestId;
    expect(third).not.toBe(ids[0]);
  });

  it.each([
    ["paymentLinkExceedsCapacity", esValidation.paymentLinkExceedsCapacity],
    ["paymentLinkBelowMinimum", esValidation.paymentLinkBelowMinimum],
  ])("shows %s on the amount field", async (key, text) => {
    useRoutes({
      [listRoute]: { body: listBody([]) },
      [createRoute]: errorEnvelope("VALIDATION", {
        fieldErrors: { amount: [`validation.${key}`] },
      }),
    });
    await renderPanel();
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole("button", { name: "Crear enlace" }));
    expect(await within(dialog).findByText(text)).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("shows the unsupported-currency refusal as the form error", async () => {
    useRoutes({
      [listRoute]: { body: listBody([]) },
      [createRoute]: errorEnvelope("VALIDATION", {
        message: "validation.paymentLinkCurrencyUnsupported",
      }),
    });
    await renderPanel();
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole("button", { name: "Crear enlace" }));
    expect(
      await within(dialog).findByText(esValidation.paymentLinkCurrencyUnsupported),
    ).toBeInTheDocument();
  });

  it("maps INTEGRITY_LOCK through the mapper", async () => {
    useRoutes({
      [listRoute]: { body: listBody([]) },
      [createRoute]: errorEnvelope("INTEGRITY_LOCK"),
    });
    await renderPanel();
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole("button", { name: "Crear enlace" }));
    expect(await within(dialog).findByText(esCommon.errors.INTEGRITY_LOCK)).toBeInTheDocument();
  });

  it('disables the action with the unsupported copy when the capacity is "0.00"', async () => {
    useRoutes({ [listRoute]: { body: listBody([], "0.00") } });
    await renderPanel();
    expect(screen.getByRole("button", { name: "Crear enlace" })).toBeDisabled();
    expect(screen.getByText(esValidation.paymentLinkCurrencyUnsupported)).toBeInTheDocument();
  });

  it("disables the action for a VES invoice", async () => {
    useRoutes({ [listRoute]: { body: listBody([]) } });
    await renderPanel({ currency: "VES" });
    expect(screen.getByRole("button", { name: "Crear enlace" })).toBeDisabled();
    expect(screen.getByText(esValidation.paymentLinkCurrencyUnsupported)).toBeInTheDocument();
  });

  it("has no create or deactivate entry point without the payment create grant", async () => {
    useRoutes({ [listRoute]: { body: listBody([link({})]) } });
    await renderPanel({ canCreate: false });
    expect(screen.queryByRole("button", { name: "Crear enlace" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desactivar" })).not.toBeInTheDocument();
  });
});

describe("PaymentLinksPanel: deactivate (6.1)", () => {
  it("offers it for PENDING and ACTIVE links only, behind a confirmation, and refreshes", async () => {
    const { calls } = useRoutes({
      [listRoute]: {
        body: listBody([
          link({ id: "lnk_1", status: "ACTIVE" }),
          link({ id: "lnk_2", status: "PENDING", url: null }),
          link({ id: "lnk_3", status: "SETTLED", url: null }),
        ]),
      },
      [deactivateRoute]: { body: link({ status: "DEACTIVATED" }) },
    });
    await renderPanel();
    const buttons = screen.getAllByRole("button", { name: "Desactivar" });
    expect(buttons).toHaveLength(2);

    const user = userEvent.setup();
    await user.click(buttons[0]!);
    const dialog = await screen.findByRole("alertdialog");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "Desactivar enlace" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "POST")?.path).toBe(
      "/api/v1/invoices/inv_1/payment-links/lnk_1/deactivate",
    );
    expect(mocks.toast.success).toHaveBeenCalledWith(esInvoices.paymentLinks.toast.deactivated);
  });
});
