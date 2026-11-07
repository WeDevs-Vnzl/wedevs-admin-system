import { describe, expect, it } from "vitest";
import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { getIntegrationMapping, updateIntegrationMapping } from "./api";

const mapping = {
  stripe: { accountId: "acc_usd", paymentMethodId: "pm_stripe" },
  binance: { accountId: "acc_wallet" },
};

describe("getIntegrationMapping", () => {
  it("returns the saved mapping with the bearer token", async () => {
    const { api, calls } = mockApi({ "GET /api/v1/settings/integrations": { body: mapping } });
    expect(await getIntegrationMapping(api)).toEqual({ ok: true, data: mapping });
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
  });

  it("returns an unmapped provider as null", async () => {
    const empty = { stripe: null, binance: null };
    const { api } = mockApi({ "GET /api/v1/settings/integrations": { body: empty } });
    expect(await getIntegrationMapping(api)).toEqual({ ok: true, data: empty });
  });

  it("maps a role without the settings grant to FORBIDDEN", async () => {
    const { api } = mockApi({ "GET /api/v1/settings/integrations": errorEnvelope("FORBIDDEN") });
    expect(await getIntegrationMapping(api)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});

describe("updateIntegrationMapping", () => {
  it("puts the mapping and returns the saved one from the response", async () => {
    const { api, calls } = mockApi({ "PUT /api/v1/settings/integrations": { body: mapping } });
    const result = await updateIntegrationMapping(api, mapping);
    expect(calls[0]?.body).toEqual(mapping);
    expect(result).toEqual({ ok: true, data: mapping });
  });

  it("sends null for a cleared provider", async () => {
    const saved = { stripe: null, binance: mapping.binance };
    const { api, calls } = mockApi({ "PUT /api/v1/settings/integrations": { body: saved } });
    const result = await updateIntegrationMapping(api, { stripe: null, binance: mapping.binance });
    expect(calls[0]?.body).toEqual({ stripe: null, binance: mapping.binance });
    expect(result).toEqual({ ok: true, data: saved });
  });

  it("maps a role without the settings grant to FORBIDDEN", async () => {
    const { api } = mockApi({ "PUT /api/v1/settings/integrations": errorEnvelope("FORBIDDEN") });
    expect(await updateIntegrationMapping(api, mapping)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("maps an account of the wrong type to a VALIDATION error with its field errors", async () => {
    const { api } = mockApi({
      "PUT /api/v1/settings/integrations": errorEnvelope("VALIDATION", {
        fieldErrors: { "binance.accountId": ["settings.integrations.errors.walletRequired"] },
      }),
    });
    expect(await updateIntegrationMapping(api, mapping)).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fieldErrors: { "binance.accountId": ["settings.integrations.errors.walletRequired"] },
      },
    });
  });

  it("turns a network failure into INTERNAL", async () => {
    const { api } = mockApi({
      "PUT /api/v1/settings/integrations": () => {
        throw new Error("offline");
      },
    });
    expect(await updateIntegrationMapping(api, mapping)).toMatchObject({
      ok: false,
      error: { code: "INTERNAL" },
    });
  });
});
