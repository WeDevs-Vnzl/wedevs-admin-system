import { screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireSessionUser: vi.fn(), getServerApi: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next-intl/server", async () => {
  const [en, payments] = await Promise.all([
    import("@/i18n/messages/en/payments.json"),
    import("@/i18n/messages/en/enums.json"),
  ]);
  const messages = { payments: en.default, enums: payments.default };
  return {
    getLocale: async () => "en",
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: "en", messages, namespace } as never),
  };
});
vi.mock("@/server/auth/session", () => ({ requireSessionUser: mocks.requireSessionUser }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));
vi.mock("@/components/app/breadcrumb-label", () => ({ BreadcrumbLabel: () => null }));
vi.mock("@/features/payments/components/payment-detail-header", () => ({
  PaymentDetailHeader: (props: { payment: { code: string; description: string }; canUpdate?: boolean }) => (
    <div data-testid="header" data-can-update={String(props.canUpdate)}>
      {props.payment.code} | {props.payment.description}
    </div>
  ),
}));
vi.mock("@/features/payments/components/payment-allocations-panel", () => ({
  PaymentAllocationsPanel: (props: { payment: { allocations: unknown[] }; canUpdate?: boolean }) => (
    <div data-testid="allocations" data-count={props.payment.allocations.length} data-can-update={String(props.canUpdate)} />
  ),
}));
vi.mock("@/features/payments/components/payment-receipt", () => ({
  PaymentReceipt: (props: { receipt: { id: string } | null }) => (
    <div data-testid="receipt" data-id={props.receipt?.id ?? ""} />
  ),
}));

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { renderWithIntl } from "@/features/payments/components/test-utils";
import { makePayment } from "@/features/payments/test-fixtures";
import { makeSessionUser } from "@/mocks/test-helpers";
import PaymentDetailPage from "./page";

const renderPage = async () =>
  renderWithIntl(await PaymentDetailPage({ params: Promise.resolve({ id: "pay_1" }) }));

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe("/payments/[id] (HU-13 CA2, HU-14 CA2)", () => {
  it("shows the figures the BE computed: 100 / IGTF 3 / fee 0 → allocatable 97, net 100", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/payments/{id}": { body: makePayment() } }).api,
    );
    await renderPage();

    const amount = (label: string) => screen.getByText(label).parentElement?.textContent ?? "";
    expect(amount("Amount received")).toMatch(/100\.00/);
    expect(amount("IGTF")).toMatch(/3\.00/);
    expect(amount("Fee")).toMatch(/0\.00/);
    expect(amount("Allocatable")).toMatch(/97\.00/);
    expect(amount("Net credited")).toMatch(/100\.00/);
    expect(screen.getByTestId("header")).toHaveTextContent("PAG-0001 | Kairos Studio (MOCK) · Zelle");
  });

  it("passes the response's allocations, receipt and the update gate to the children", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("ADMIN"));
    mocks.getServerApi.mockResolvedValue(
      mockApi({
        "GET /api/v1/payments/{id}": {
          body: makePayment({
            receipt: {
              id: "fil_1",
              mimeType: "application/pdf",
              originalName: "comprobante.pdf",
              sizeBytes: 1024,
              status: "READY",
              uploadedById: "usr_1",
              createdAt: "2026-10-05T12:00:00.000Z",
            },
          }),
        },
      }).api,
    );
    await renderPage();
    expect(screen.getByTestId("receipt")).toHaveAttribute("data-id", "fil_1");
    expect(screen.getByTestId("allocations")).toHaveAttribute("data-can-update", "true");
    expect(screen.getByTestId("header")).toHaveAttribute("data-can-update", "true");
  });

  it("shows a voided payment's empty allocations from the response", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    mocks.getServerApi.mockResolvedValue(
      mockApi({
        "GET /api/v1/payments/{id}": { body: makePayment({ status: "ANULADO", allocations: [] }) },
      }).api,
    );
    await renderPage();
    expect(screen.getByTestId("allocations")).toHaveAttribute("data-count", "0");
  });

  it("answers the not-found state for an unknown id", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/payments/{id}": errorEnvelope("NOT_FOUND") }).api,
    );
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("answers the not-found state when the BE says FORBIDDEN", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("ADMIN"));
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/payments/{id}": errorEnvelope("FORBIDDEN") }).api,
    );
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("answers the not-found state for a Member without reading the payment", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("MEMBER"));
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getServerApi).not.toHaveBeenCalled();
  });
});
