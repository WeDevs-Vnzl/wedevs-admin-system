import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerApi: vi.fn(),
  requireSessionUser: vi.fn(),
  denyPayment: false,
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));
vi.mock("@/server/auth/session", () => ({ requireSessionUser: mocks.requireSessionUser }));
vi.mock("@/components/app/breadcrumb-label", () => ({ BreadcrumbLabel: () => null }));
// The detail renders elsewhere; the page only wires its inputs.
vi.mock("@/features/invoices/components/invoice-detail", () => ({
  InvoiceDetail: ({
    invoice,
    canUpdate,
    paymentLinks,
  }: {
    invoice: { invoiceNumber: string };
    canUpdate: boolean;
    paymentLinks?: ReactNode;
  }) => (
    <div>
      <p>{`${invoice.invoiceNumber}|${canUpdate}`}</p>
      {paymentLinks}
    </div>
  ),
}));
// The panel has its own tests: here it only records the props the page hands it.
vi.mock("@/features/invoices/components/payment-links-panel", () => ({
  PaymentLinksPanel: (props: { invoiceId: string; currency: string; canCreate: boolean }) => (
    <p>{`panel|${props.invoiceId}|${props.currency}|${props.canCreate}`}</p>
  ),
}));
vi.mock("@/server/auth/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/permissions")>();
  return {
    ...actual,
    can: (user: Parameters<typeof actual.can>[0], action: string, resource: string) =>
      mocks.denyPayment && resource === "payment"
        ? false
        : actual.can(user, action as never, resource as never),
  };
});

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { multiRateInvoice } from "@/features/invoices/test-data";
import InvoiceDetailPage from "./page";

const params = Promise.resolve({ id: "inv_1" });

function asRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  mocks.requireSessionUser.mockResolvedValue({ id: `usr_${role}`, role });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.denyPayment = false;
});

describe("/invoices/[id]", () => {
  it("renders the BE invoice for Owner and Admin", async () => {
    asRole("ADMIN");
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/invoices/{id}": { body: multiRateInvoice() } }).api,
    );
    render(await InvoiceDetailPage({ params }));
    expect(screen.getByText("00001234|true")).toBeInTheDocument();
  });

  it("answers the not-found page when the BE says 404 or 403", async () => {
    asRole("OWNER");
    for (const code of ["NOT_FOUND", "FORBIDDEN"] as const) {
      mocks.getServerApi.mockResolvedValue(
        mockApi({ "GET /api/v1/invoices/{id}": errorEnvelope(code) }).api,
      );
      await expect(InvoiceDetailPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("answers the not-found page for Member and Viewer without calling the BE (C13)", async () => {
    for (const role of ["MEMBER", "VIEWER"] as const) {
      asRole(role);
      await expect(InvoiceDetailPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(mocks.getServerApi).not.toHaveBeenCalled();
  });

  it("mounts the payment-links panel with the invoice currency and the create grant", async () => {
    asRole("ADMIN");
    const invoice = multiRateInvoice();
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/invoices/{id}": { body: invoice } }).api,
    );
    render(await InvoiceDetailPage({ params }));
    expect(screen.getByText(`panel|${invoice.id}|${invoice.currency}|true`)).toBeInTheDocument();
  });

  it("does not mount the panel without the payment read grant, and makes no link call", async () => {
    asRole("ADMIN");
    mocks.denyPayment = true;
    const { api, calls } = mockApi({
      "GET /api/v1/invoices/{id}": { body: multiRateInvoice() },
    });
    mocks.getServerApi.mockResolvedValue(api);
    render(await InvoiceDetailPage({ params }));
    expect(screen.getByText("00001234|true")).toBeInTheDocument();
    expect(screen.queryByText(/^panel\|/)).not.toBeInTheDocument();
    expect(calls.some((call) => call.path.includes("payment-links"))).toBe(false);
  });
});
