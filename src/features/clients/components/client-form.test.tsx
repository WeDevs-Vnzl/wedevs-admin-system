import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enClients from "@/i18n/messages/en/clients.json";
import enCommon from "@/i18n/messages/en/common.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enForms from "@/i18n/messages/en/forms.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enTable from "@/i18n/messages/en/table.json";
import enTags from "@/i18n/messages/en/tags.json";
import enValidation from "@/i18n/messages/en/validation.json";
import { createClientAction, updateClientAction } from "@/features/clients/actions";
import type { ClientFormSource } from "./client-form";
import { ClientForm } from "./client-form";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/features/clients/actions", () => ({
  createClientAction: vi.fn(),
  updateClientAction: vi.fn(),
}));
// The combobox and phone inputs have their own tests; here they are plain fields so the form rules stay the subject.
vi.mock("@/components/ui/country-combobox/country-combobox", () => ({
  CountryCombobox: ({ id, value }: { id?: string; value: string }) => (
    <input id={id} aria-label="country" defaultValue={value} />
  ),
}));
vi.mock("@/components/ui/phone-input/phone-input", () => ({
  PhoneInput: ({
    id,
    value,
    onChange,
  }: {
    id?: string;
    value: string;
    onChange: (v: string) => void;
  }) => (
    <input
      id={id}
      aria-label="phone"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("@/features/tags/components/tag-picker", () => ({
  TagPicker: ({ id }: { id?: string }) => <div id={id} data-testid="tag-picker" />,
}));

const messages = {
  clients: enClients,
  common: enCommon,
  enums: enEnums,
  forms: enForms,
  patterns: enPatterns,
  table: enTable,
  tags: enTags,
  validation: enValidation,
};

// An existing Venezuelan company with no legal name yet: the EMPRESA rule has something to refuse.
const company: ClientFormSource = {
  id: "cli_nube",
  code: "CLI-0002",
  kind: "EMPRESA",
  tradeName: "Nube Austral",
  legalName: "",
  taxId: "J-40111222-3",
  country: "VE",
  address: "Av. Libertador, Caracas",
  phone: "+584121234567",
  email: null,
  website: null,
  status: "ACTIVO",
  tags: [],
};

function renderForm(client?: ClientFormSource) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ClientForm client={client} canCreateTags={false} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ClientForm", () => {
  it("requires the legal name of an EMPRESA client and does not call the action (HU-03 CA1)", async () => {
    renderForm(company);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Required field")).toBeInTheDocument();
    expect(updateClientAction).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Legal name")).toHaveAttribute("aria-invalid", "true");
  });

  it("links a CONFLICT on the tax id to the record that holds it (HU-03 CA3)", async () => {
    vi.mocked(updateClientAction).mockResolvedValue({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "clients.errors.duplicateTaxId",
        entity: { type: "CLIENT", id: "cli_kairos", code: "CLI-0001", label: "Kairos Studio" },
      },
    } as never);
    renderForm({ ...company, legalName: "Nube Austral C.A." });

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    const link = await screen.findByRole("link", { name: "Open CLI-0001" });
    expect(link).toHaveAttribute("href", "/clients/cli_kairos");
    expect(
      screen.getByText("An active client with this tax ID and country already exists"),
    ).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("toasts and opens the detail page after a successful save", async () => {
    vi.mocked(updateClientAction).mockResolvedValue({
      ok: true,
      data: { id: "cli_nube" },
    } as never);
    renderForm({ ...company, legalName: "Nube Austral C.A." });

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/clients/cli_nube"));
    expect(mocks.toast.success).toHaveBeenCalledWith("Client updated");
    expect(createClientAction).not.toHaveBeenCalled();
  });
});
