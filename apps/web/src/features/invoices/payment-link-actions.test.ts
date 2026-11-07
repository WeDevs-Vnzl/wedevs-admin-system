import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerApi: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath, updateTag: mocks.updateTag }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import type { PaymentLinkResponseDto } from "@/lib/api/types/payment-links";
import { createPaymentLinkAction, deactivatePaymentLinkAction } from "./payment-link-actions";

function useRoutes(routes: RouteTable) {
  const mocked = mockApi(routes);
  mocks.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

const link: PaymentLinkResponseDto = {
  id: "lnk_1",
  invoiceId: "inv_1",
  amount: "100.00",
  currency: "USD",
  status: "ACTIVE",
  url: "https://checkout.example/pay/1",
  externalId: null,
  requestId: "5f3f3f3f-3f3f-4f3f-8f3f-3f3f3f3f3f3f",
  paymentId: null,
  createdAt: "2026-11-07T10:00:00.000Z",
  deactivatedAt: null,
  deactivationReason: null,
  settledAt: null,
};

const createRoute = "POST /api/v1/invoices/{id}/payment-links";
const deactivateRoute = "POST /api/v1/invoices/{id}/payment-links/{linkId}/deactivate";
const input = {
  invoiceId: "inv_1",
  amount: "100.00",
  requestId: "5f3f3f3f-3f3f-4f3f-8f3f-3f3f3f3f3f3f",
};

beforeEach(() => {
  mocks.getServerApi.mockReset();
  mocks.revalidatePath.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createPaymentLinkAction (6.1)", () => {
  it("posts the amount string and the requestId, then revalidates the invoice", async () => {
    const { calls } = useRoutes({ [createRoute]: { status: 201, body: link } });
    const result = await createPaymentLinkAction(input);
    expect(result).toEqual({ ok: true, data: link });
    expect(calls[0]?.path).toBe("/api/v1/invoices/inv_1/payment-links");
    expect(calls[0]?.body).toEqual({ amount: "100.00", requestId: input.requestId });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/invoices/inv_1");
  });

  it("maps the field refusal on amount", async () => {
    useRoutes({
      [createRoute]: errorEnvelope("VALIDATION", {
        message: "validation.invalidFormat",
        fieldErrors: { amount: ["validation.paymentLinkExceedsCapacity"] },
      }),
    });
    const result = await createPaymentLinkAction(input);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { amount: ["validation.paymentLinkExceedsCapacity"] } },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps the unsupported-currency message key and INTEGRITY_LOCK", async () => {
    useRoutes({
      [createRoute]: errorEnvelope("VALIDATION", {
        message: "validation.paymentLinkCurrencyUnsupported",
      }),
    });
    expect(await createPaymentLinkAction(input)).toMatchObject({
      ok: false,
      error: { message: "validation.paymentLinkCurrencyUnsupported" },
    });
    useRoutes({ [createRoute]: errorEnvelope("INTEGRITY_LOCK") });
    expect(await createPaymentLinkAction(input)).toMatchObject({
      ok: false,
      error: { code: "INTEGRITY_LOCK" },
    });
  });
});

describe("deactivatePaymentLinkAction (6.1)", () => {
  it("posts the deactivation and revalidates the invoice", async () => {
    const { calls } = useRoutes({
      [deactivateRoute]: { body: { ...link, status: "DEACTIVATED" } },
    });
    const result = await deactivatePaymentLinkAction({ invoiceId: "inv_1", linkId: "lnk_1" });
    expect(result.ok).toBe(true);
    expect(calls[0]?.path).toBe("/api/v1/invoices/inv_1/payment-links/lnk_1/deactivate");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/invoices/inv_1");
  });

  it("maps a refusal", async () => {
    useRoutes({ [deactivateRoute]: errorEnvelope("INTEGRITY_LOCK") });
    expect(
      await deactivatePaymentLinkAction({ invoiceId: "inv_1", linkId: "lnk_1" }),
    ).toMatchObject({ ok: false, error: { code: "INTEGRITY_LOCK" } });
  });
});
