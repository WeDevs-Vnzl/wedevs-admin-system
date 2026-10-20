import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/messages/en/common.json";
import enForms from "@/i18n/messages/en/forms.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enSettings from "@/i18n/messages/en/settings.json";
import enValidation from "@/i18n/messages/en/validation.json";
import esSettings from "@/i18n/messages/es/settings.json";

const mocks = vi.hoisted(() => ({
  updateCompanySettingsAction: vi.fn(),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("../actions", () => ({ updateCompanySettingsAction: mocks.updateCompanySettingsAction }));
vi.mock("@/features/files/upload-adapter", () => ({ uploadAdapter: {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { CompanySettingsForm } from "./company-settings-form";

const initial = {
  name: "WeDevs",
  legalName: "WeDevs C.A.",
  taxId: "J-12345678-9",
  address: undefined,
  logoFileId: "fil_logo",
};

function renderForm(locale: "en" | "es" = "en") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      timeZone="America/Caracas"
      messages={{
        common: enCommon,
        forms: enForms,
        patterns: enPatterns,
        settings: locale === "en" ? enSettings : esSettings,
        validation: enValidation,
      }}
    >
      <CompanySettingsForm initial={initial} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("CompanySettingsForm (PRD §8.15 Empresa)", () => {
  it("shows name, legal name, RIF, address and logo", () => {
    renderForm();
    expect(screen.getByLabelText("Name")).toHaveValue("WeDevs");
    expect(screen.getByLabelText("Legal name")).toHaveValue("WeDevs C.A.");
    expect(screen.getByLabelText("Tax ID (RIF)")).toHaveValue("J-12345678-9");
    expect(screen.getByLabelText("Address")).toHaveValue("");
    expect(screen.getByText("Logo")).toBeInTheDocument();
    expect(screen.getByText(/A logo is set/)).toBeInTheDocument();
  });

  it("uses the Spanish copy", () => {
    renderForm("es");
    expect(screen.getByLabelText("Razón social")).toBeInTheDocument();
    expect(screen.getByLabelText("RIF")).toBeInTheDocument();
  });

  it("saves the profile through the action", async () => {
    const user = userEvent.setup();
    mocks.updateCompanySettingsAction.mockResolvedValue({
      ok: true,
      data: { ...initial, address: "Caracas" },
    });
    renderForm();
    await user.type(screen.getByLabelText("Address"), "Caracas");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.updateCompanySettingsAction).toHaveBeenCalledWith({
        name: "WeDevs",
        legalName: "WeDevs C.A.",
        taxId: "J-12345678-9",
        address: "Caracas",
        logoFileId: "fil_logo",
      }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Company profile saved");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("removes the logo", async () => {
    const user = userEvent.setup();
    mocks.updateCompanySettingsAction.mockResolvedValue({ ok: true, data: initial });
    renderForm();
    await user.click(screen.getByRole("button", { name: "Remove logo" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.updateCompanySettingsAction).toHaveBeenCalledWith(
        expect.objectContaining({ logoFileId: undefined }),
      ),
    );
  });

  it("requires a name", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.clear(screen.getByLabelText("Name"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(enValidation.required)).toBeInTheDocument();
    expect(mocks.updateCompanySettingsAction).not.toHaveBeenCalled();
  });
});
