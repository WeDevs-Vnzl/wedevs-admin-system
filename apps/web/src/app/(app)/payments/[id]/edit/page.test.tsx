import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSessionUser: vi.fn(),
  getServerApi: vi.fn(),
  getPaymentFormOptions: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/lib/auth/session", () => ({ requireSessionUser: mocks.requireSessionUser }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));
vi.mock("@/features/payments/form-options", () => ({
  getPaymentFormOptions: mocks.getPaymentFormOptions,
}));
vi.mock("@/components/app/breadcrumb-label", () => ({ BreadcrumbLabel: () => null }));
vi.mock("@/features/payments/components/payment-form", () => ({ PaymentForm: () => null }));

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { makePayment } from "@/features/payments/test-fixtures";
import { makeSessionUser } from "@/lib/auth/testing";
import PaymentEditPage from "./page";

const render = () => PaymentEditPage({ params: Promise.resolve({ id: "pay_1" }) });
const options = {
  accounts: [{ id: "acc_usd", name: "Zelle USD", currency: "USD", active: false }],
  methods: [],
  fiscal: { igtfRate: "3", igtfCurrencies: [] },
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getPaymentFormOptions.mockResolvedValue(options);
});

describe("/payments/[id]/edit (Q-FEINT-11 (A), DT-213)", () => {
  it("renders the form in edit mode over the stored payment, with the inactive options", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("ADMIN"));
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/payments/{id}": { body: makePayment() } }).api,
    );
    const element = await render();
    const form = (element.props.children as { props: Record<string, unknown> }[])[1];
    expect(form?.props).toMatchObject({
      payment: { id: "pay_1" },
      accounts: [{ id: "acc_usd", active: false }],
    });
    expect(mocks.getPaymentFormOptions).toHaveBeenCalledWith({ includeInactive: true });
  });

  it("redirects a voided payment to its detail (rule 21)", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/payments/{id}": { body: makePayment({ status: "ANULADO" }) } }).api,
    );
    await expect(render()).rejects.toThrow("NEXT_REDIRECT:/payments/pay_1");
    expect(mocks.getPaymentFormOptions).not.toHaveBeenCalled();
  });

  it("hides the page from a role that may not update payments, without reading the payment", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("VIEWER"));
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getServerApi).not.toHaveBeenCalled();
  });

  it("answers the not-found state for an unknown id", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/payments/{id}": errorEnvelope("NOT_FOUND") }).api,
    );
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
