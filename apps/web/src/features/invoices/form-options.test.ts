import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerApi: vi.fn(),
  listCurrencies: vi.fn(),
  getFiscalSettings: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));
// Other modules' reads are stubbed at the module boundary (W2 rule 7).
vi.mock("@/features/catalogs/queries", () => ({
  listCurrencies: mocks.listCurrencies,
  getFiscalSettings: mocks.getFiscalSettings,
}));

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { loadInvoiceFormOptions } from "./form-options";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listCurrencies.mockResolvedValue([{ code: "USD", name: "US dollar" }]);
  mocks.getFiscalSettings.mockResolvedValue({
    ivaRates: ["16", "8"],
    ivaDefaultRate: "16",
    invoiceDefaultDueDays: 15,
  });
});

describe("loadInvoiceFormOptions", () => {
  it("reads the client's billable installments from the BE", async () => {
    const mocked = mockApi({
      "GET /api/v1/clients/{id}": { body: { id: "cli_1", tradeName: "Kairos Studio" } },
      "GET /api/v1/clients/{id}/billable-installments": {
        body: [
          {
            installment: { type: "INSTALLMENT", id: "ins_1", label: "Anticipo", code: null },
            project: { type: "PROJECT", id: "prj_1", label: "Portal", code: null },
            kind: "ANTICIPO",
            label: "Anticipo 40 %",
            currency: "USD",
            amount: "4000.00",
            remainingAmount: "4000.00",
            dueDate: null,
          },
        ],
      },
    });
    mocks.getServerApi.mockResolvedValue(mocked.api);

    const options = await loadInvoiceFormOptions("cli_1");

    expect(options.billable).toHaveLength(1);
    expect(options.billable[0]?.installment.code).toBeUndefined();
    expect(options).toMatchObject({
      initialClient: { id: "cli_1", name: "Kairos Studio" },
      ivaRates: ["16", "8"],
      defaultIvaRate: "16",
      defaultDueDays: 15,
    });
  });

  it("keeps an unknown client id from the URL as an empty wizard (404)", async () => {
    mocks.getServerApi.mockResolvedValue(
      mockApi({
        "GET /api/v1/clients/{id}": errorEnvelope("NOT_FOUND"),
        "GET /api/v1/clients/{id}/billable-installments": errorEnvelope("NOT_FOUND"),
      }).api,
    );
    expect((await loadInvoiceFormOptions("cli_nope")).billable).toEqual([]);
  });

  it("does not call the BE for a missing client id", async () => {
    const mocked = mockApi({});
    mocks.getServerApi.mockResolvedValue(mocked.api);
    expect((await loadInvoiceFormOptions("")).billable).toEqual([]);
    expect(mocked.calls).toHaveLength(0);
  });

  it("resolves the preselected client's name by id, with no client list preload (S2, S4)", async () => {
    const mocked = mockApi({
      "GET /api/v1/clients/{id}": { body: { id: "cli_1", tradeName: "Kairos Studio" } },
      "GET /api/v1/clients/{id}/billable-installments": { body: [] },
    });
    mocks.getServerApi.mockResolvedValue(mocked.api);

    const options = await loadInvoiceFormOptions("cli_1");

    expect(options.initialClient).toEqual({ id: "cli_1", name: "Kairos Studio" });
    expect(mocked.calls.map((call) => call.path)).toEqual([
      "/api/v1/clients/cli_1",
      "/api/v1/clients/cli_1/billable-installments",
    ]);
  });

  it("keeps an unknown client id from the URL without a preselected client (404)", async () => {
    mocks.getServerApi.mockResolvedValue(
      mockApi({
        "GET /api/v1/clients/{id}": errorEnvelope("NOT_FOUND"),
        "GET /api/v1/clients/{id}/billable-installments": errorEnvelope("NOT_FOUND"),
      }).api,
    );
    const options = await loadInvoiceFormOptions("cli_nope");
    expect(options.initialClient).toBeNull();
    expect(options.billable).toEqual([]);
  });

  it("preselects no client and makes no client call without a client id", async () => {
    const mocked = mockApi({});
    mocks.getServerApi.mockResolvedValue(mocked.api);

    expect((await loadInvoiceFormOptions("")).initialClient).toBeNull();
    expect(mocked.calls).toHaveLength(0);
  });

  it("computes and carries no IGTF figure (item 7)", async () => {
    mocks.getServerApi.mockResolvedValue(mockApi({}).api);
    expect(Object.keys(await loadInvoiceFormOptions("")).some((key) => /igtf/i.test(key))).toBe(
      false,
    );
  });
});
