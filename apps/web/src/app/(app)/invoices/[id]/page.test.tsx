import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getServerApi: vi.fn(), requireSessionUser: vi.fn() }));
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
  }: {
    invoice: { invoiceNumber: string };
    canUpdate: boolean;
  }) => <p>{`${invoice.invoiceNumber}|${canUpdate}`}</p>,
}));

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { multiRateInvoice } from "@/features/invoices/test-data";
import InvoiceDetailPage from "./page";

const params = Promise.resolve({ id: "inv_1" });

function asRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  mocks.requireSessionUser.mockResolvedValue({ id: `usr_${role}`, role });
}

beforeEach(() => vi.clearAllMocks());

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
});
