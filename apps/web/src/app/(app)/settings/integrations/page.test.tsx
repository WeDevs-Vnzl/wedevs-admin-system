import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOpenableSettingsSection, getIntegrationsScreen, notFound, getFeatures } = vi.hoisted(
  () => ({
    getFeatures: vi.fn(),
    getOpenableSettingsSection: vi.fn(),
    getIntegrationsScreen: vi.fn(),
    notFound: vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    }),
  }),
);

vi.mock("@/features/settings/queries", () => ({ getOpenableSettingsSection }));
vi.mock("@/features/integrations/queries", () => ({ getIntegrationsScreen }));
vi.mock("@/features/shell/features", () => ({ getFeatures }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "en",
}));
vi.mock("@/features/integrations/components/integrations-form", () => ({
  IntegrationsForm: ({
    initial,
    features,
  }: {
    initial: { binance: { accountId: string } | null };
    features: { stripe: boolean; binance: boolean };
  }) => (
    <p>
      form:{initial.binance?.accountId ?? "none"}|stripe:{String(features.stripe)}|binance:
      {String(features.binance)}
    </p>
  ),
}));

import IntegrationsSettingsPage, { generateMetadata } from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  getFeatures.mockResolvedValue({ stripe: true, binance: true, bankSync: false });
  getIntegrationsScreen.mockResolvedValue({
    mapping: { stripe: null, binance: { accountId: "w1" } },
    accounts: [],
    walletAccounts: [],
    methods: [],
  });
});

describe("/settings/integrations page", () => {
  it("renders the mapping form for Owner and Admin", async () => {
    getOpenableSettingsSection.mockResolvedValue({ slug: "integrations" });
    render(await IntegrationsSettingsPage());
    expect(getOpenableSettingsSection).toHaveBeenCalledWith("integrations");
    expect(getIntegrationsScreen).toHaveBeenCalledWith("en");
    expect(screen.getByText("form:w1|stripe:true|binance:true")).toBeInTheDocument();
  });

  it("passes the provider flags to the form so only the providers that are on render (DT-227)", async () => {
    getOpenableSettingsSection.mockResolvedValue({ slug: "integrations" });
    getFeatures.mockResolvedValue({ stripe: false, binance: true, bankSync: false });
    render(await IntegrationsSettingsPage());
    expect(screen.getByText("form:w1|stripe:false|binance:true")).toBeInTheDocument();
  });

  it("calls notFound() for roles that cannot open it, without reading the mapping", async () => {
    getOpenableSettingsSection.mockResolvedValue(null);
    await expect(IntegrationsSettingsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getIntegrationsScreen).not.toHaveBeenCalled();
  });

  it("titles the page through generateMetadata", async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: "title" });
  });
});
