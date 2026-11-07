import { screen, within } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => server);
vi.mock("next-intl/server", async () => {
  const [payments, patterns] = await Promise.all([
    import("@/i18n/messages/en/payments.json"),
    import("@/i18n/messages/en/patterns.json"),
  ]);
  const messages = { payments: payments.default, patterns: patterns.default };
  return {
    getLocale: async () => "en",
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: "en", messages, namespace } as never),
  };
});

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { makePaymentRow, page } from "../test-fixtures";
import { ClientPaymentsTab } from "./client-payments-tab";
import { installResizeObserver, renderWithIntl } from "./test-utils";

const credit = {
  payments: [
    {
      paymentId: "pay_1",
      code: "PAG-0001",
      date: "2026-10-05",
      currency: "USD",
      unallocated: "97.00",
      unallocatedUsd: "97.00",
    },
  ],
  totalUsd: "97.00",
};

beforeAll(installResizeObserver);
beforeEach(() => server.getServerApi.mockReset());

describe("ClientPaymentsTab (HU-13 CA5)", () => {
  it("shows the credit from GET /clients/{id}/credit and the client's payments from GET /payments?clientId", async () => {
    const { api, calls } = mockApi({
      "GET /api/v1/clients/{id}/credit": { body: credit },
      "GET /api/v1/payments": { body: page([makePaymentRow()]) },
    });
    server.getServerApi.mockResolvedValue(api);

    renderWithIntl(await ClientPaymentsTab({ clientId: "cli_1", newHref: "/payments/new" }));

    const creditCard = screen.getByText("Credit").closest("[data-slot=card]") as HTMLElement;
    expect(within(creditCard).getByRole("link", { name: /PAG-0001/ })).toHaveAttribute(
      "href",
      "/payments/pay_1",
    );
    expect(creditCard).toHaveTextContent(/97\.00/);
    expect(calls.find((call) => call.path === "/api/v1/clients/cli_1/credit")).toBeDefined();
    const list = calls.find((call) => call.path === "/api/v1/payments");
    expect(list?.search.getAll("clientId")).toEqual(["cli_1"]);
    expect(list?.search.get("sort")).toBe("date:desc");
    expect(screen.getAllByRole("link", { name: "PAG-0001" }).length).toBeGreaterThan(0);
  });

  it("says there is no credit when the BE lists none", async () => {
    const { api } = mockApi({
      "GET /api/v1/clients/{id}/credit": { body: { payments: [], totalUsd: "0.00" } },
      "GET /api/v1/payments": { body: page([]) },
    });
    server.getServerApi.mockResolvedValue(api);
    renderWithIntl(await ClientPaymentsTab({ clientId: "cli_1" }));
    expect(screen.getByText("There is no credit.")).toBeInTheDocument();
  });

  it("lets a BE refusal surface instead of showing stale rows", async () => {
    const { api } = mockApi({
      "GET /api/v1/clients/{id}/credit": errorEnvelope("FORBIDDEN"),
      "GET /api/v1/payments": errorEnvelope("FORBIDDEN"),
    });
    server.getServerApi.mockResolvedValue(api);
    await expect(ClientPaymentsTab({ clientId: "cli_1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("keeps its frozen props: { clientId: string; newHref?: string }", () => {
    expectTypeOf(ClientPaymentsTab).parameter(0).toEqualTypeOf<{
      clientId: string;
      newHref?: string;
    }>();
  });
});
