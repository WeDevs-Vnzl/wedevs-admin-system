import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOpenableSettingsSection, getCompanySettings, notFound } = vi.hoisted(() => ({
  getOpenableSettingsSection: vi.fn(),
  getCompanySettings: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/features/settings/queries", () => ({ getOpenableSettingsSection, getCompanySettings }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/features/settings/components/company-settings-form", () => ({
  CompanySettingsForm: ({ initial }: { initial: { name: string } }) => <p>form:{initial.name}</p>,
}));

import CompanySettingsPage, { generateMetadata } from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  getCompanySettings.mockResolvedValue({ name: "WeDevs" });
});

describe("/settings/company page", () => {
  it("renders the company form with the stored profile", async () => {
    getOpenableSettingsSection.mockResolvedValue({ slug: "company" });
    render(await CompanySettingsPage());
    expect(getOpenableSettingsSection).toHaveBeenCalledWith("company");
    expect(screen.getByText("form:WeDevs")).toBeInTheDocument();
  });

  it("calls notFound() for roles that cannot open it", async () => {
    getOpenableSettingsSection.mockResolvedValue(null);
    await expect(CompanySettingsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getCompanySettings).not.toHaveBeenCalled();
  });

  it("titles the page through generateMetadata", async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: "title" });
  });
});
