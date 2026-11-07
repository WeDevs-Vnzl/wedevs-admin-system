import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import type { InvoicePaymentLinksResponseDto } from "@/lib/api/types/payment-links";
import { listInvoicePaymentLinks } from "./payment-links";

const route = "GET /api/v1/invoices/{id}/payment-links";

function useRoutes(routes: RouteTable) {
  const mocked = mockApi(routes);
  mocks.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

const body: InvoicePaymentLinksResponseDto = {
  capacity: "250.00",
  links: [],
};

beforeEach(() => mocks.getServerApi.mockReset());

describe("listInvoicePaymentLinks (6.1)", () => {
  it("returns the DTO as the BE sent it", async () => {
    const { calls } = useRoutes({ [route]: { body } });
    const result = await listInvoicePaymentLinks("inv_1");
    expect(result).toEqual(body);
    expect(calls[0]?.path).toBe("/api/v1/invoices/inv_1/payment-links");
    expectTypeOf(result).toEqualTypeOf<InvoicePaymentLinksResponseDto | null>();
  });

  it("answers null on 404: the Stripe integration is off (DT-193)", async () => {
    useRoutes({ [route]: errorEnvelope("NOT_FOUND") });
    expect(await listInvoicePaymentLinks("inv_1")).toBeNull();
  });

  it.each(["FORBIDDEN", "INTERNAL", "VALIDATION"] as const)("throws on %s", async (code) => {
    useRoutes({ [route]: errorEnvelope(code) });
    await expect(listInvoicePaymentLinks("inv_1")).rejects.toThrow();
  });
});
