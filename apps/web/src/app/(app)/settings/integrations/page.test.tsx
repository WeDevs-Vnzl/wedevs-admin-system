import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOpenableSettingsSection, getIntegrationsScreen, notFound } = vi.hoisted(() => ({
  getOpenableSettingsSection: vi.fn(),
  getIntegrationsScreen: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/features/settings/queries", () => ({ getOpenableSettingsSection }));
vi.mock("@/features/integrations/queries", () => ({ getIntegrationsScreen }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "en",
}));
vi.mock("@/features/integrations/components/integrations-form", () => ({
  IntegrationsForm: ({ initial }: { initial: { binance: { accountId: string } | null } }) => (
    <p>form:{initial.binance?.accountId ?? "none"}</p>
  ),
}));

import IntegrationsSettingsPage, { generateMetadata } from "./page";

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(screen.getByText("form:w1")).toBeInTheDocument();
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
