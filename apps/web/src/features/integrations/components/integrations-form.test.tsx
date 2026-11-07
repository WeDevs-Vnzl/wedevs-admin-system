import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import enAccounts from "@/i18n/messages/en/accounts.json";
import enCommon from "@/i18n/messages/en/common.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enSettings from "@/i18n/messages/en/settings.json";
import enValidation from "@/i18n/messages/en/validation.json";
import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import type { IntegrationMappingDto } from "@/lib/api/types/integrations";

const mocks = vi.hoisted(() => ({
  api: null as unknown,
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  useApiClient: () => mocks.api,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { IntegrationsForm } from "./integrations-form";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(() => vi.clearAllMocks());

const accounts = [
  { id: "acc_usd", name: "Stripe USD", currency: "USD" },
  { id: "acc_eur", name: "Bank EUR", currency: "EUR" },
];
const walletAccounts = [{ id: "acc_wallet", name: "Binance wallet", currency: "USDT" }];
const methods = [
  { id: "pm_stripe", label: "Stripe" },
  { id: "pm_cash", label: "Cash" },
];
const saved: IntegrationMappingDto = {
  stripe: { accountId: "acc_usd", paymentMethodId: "pm_stripe" },
  binance: { accountId: "acc_wallet" },
};

function setup(
  routes: RouteTable,
  initial: IntegrationMappingDto = saved,
  wallets = walletAccounts,
) {
  const mock = mockApi(routes);
  mocks.api = mock.api;
  render(
    <NextIntlClientProvider
      locale="en"
      timeZone="America/Caracas"
      messages={{
        accounts: enAccounts,
        settings: enSettings,
        common: enCommon,
        validation: enValidation,
        patterns: enPatterns,
      }}
    >
      <IntegrationsForm
        initial={initial}
        accounts={accounts}
        walletAccounts={wallets}
        methods={methods}
      />
    </NextIntlClientProvider>,
  );
  return mock;
}

async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("IntegrationsForm", () => {
  it("renders the saved mapping, with the account's currency beside the Stripe account", () => {
    setup({});
    expect(screen.getByRole("combobox", { name: "Target account" })).toHaveTextContent(
      "Stripe USD (USD)",
    );
    expect(screen.getByRole("combobox", { name: "Payment method" })).toHaveTextContent("Stripe");
    expect(screen.getByRole("combobox", { name: "Wallet account" })).toHaveTextContent(
      "Binance wallet (USDT)",
    );
    expect(screen.getByText("Currency: USD")).toBeInTheDocument();
  });

  it("shows an inactive mapped account as a labelled option", async () => {
    const inactive = { id: "acc_old", name: "Old Stripe", currency: "USD", inactive: true };
    const mock = mockApi({});
    mocks.api = mock.api;
    render(
      <NextIntlClientProvider
        locale="en"
        timeZone="America/Caracas"
        messages={{
          accounts: enAccounts,
          settings: enSettings,
          common: enCommon,
          validation: enValidation,
          patterns: enPatterns,
        }}
      >
        <IntegrationsForm
          initial={{
            stripe: { accountId: "acc_old", paymentMethodId: "pm_stripe" },
            binance: null,
          }}
          accounts={[...accounts, inactive]}
          walletAccounts={walletAccounts}
          methods={methods}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("combobox", { name: "Target account" })).toHaveTextContent(
      "Old Stripe (USD) · Inactive",
    );
  });

  it("saves the picked mapping and shows the one the response returned", async () => {
    const user = userEvent.setup();
    const response = { ...saved, stripe: { accountId: "acc_eur", paymentMethodId: "pm_cash" } };
    const { calls } = setup({ "PUT /api/v1/settings/integrations": { body: response } });
    await choose(user, "Target account", "Bank EUR (EUR)");
    await choose(user, "Payment method", "Cash");
    await user.click(screen.getByRole("button", { name: "Save mapping" }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith("Mapping saved"));
    expect(calls[0]?.body).toEqual({
      stripe: { accountId: "acc_eur", paymentMethodId: "pm_cash" },
      binance: { accountId: "acc_wallet" },
    });
    expect(screen.getByRole("combobox", { name: "Target account" })).toHaveTextContent(
      "Bank EUR (EUR)",
    );
    expect(screen.getByText("Currency: EUR")).toBeInTheDocument();
  });

  it("sends null for a provider cleared to 'Not mapped'", async () => {
    const user = userEvent.setup();
    const { calls } = setup({
      "PUT /api/v1/settings/integrations": { body: { stripe: saved.stripe, binance: null } },
    });
    await choose(user, "Wallet account", "Not mapped");
    await user.click(screen.getByRole("button", { name: "Save mapping" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual({ stripe: saved.stripe, binance: null });
    expect(screen.getByRole("combobox", { name: "Wallet account" })).toHaveTextContent(
      "Not mapped",
    );
  });

  it("clears Stripe by dropping both of its pickers", async () => {
    const user = userEvent.setup();
    const { calls } = setup({
      "PUT /api/v1/settings/integrations": { body: { stripe: null, binance: saved.binance } },
    });
    await choose(user, "Target account", "Not mapped");
    await choose(user, "Payment method", "Not mapped");
    await user.click(screen.getByRole("button", { name: "Save mapping" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual({ stripe: null, binance: saved.binance });
  });

  it("does not call the BE when Stripe has only one of its two pickers", async () => {
    const user = userEvent.setup();
    const { calls } = setup({}, { stripe: null, binance: null });
    await choose(user, "Target account", "Bank EUR (EUR)");
    await user.click(screen.getByRole("button", { name: "Save mapping" }));
    expect(
      await screen.findByText(
        "Choose both the account and the payment method, or leave Stripe unmapped.",
      ),
    ).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("shows the no-permission message when the BE answers FORBIDDEN", async () => {
    const user = userEvent.setup();
    setup({ "PUT /api/v1/settings/integrations": errorEnvelope("FORBIDDEN") });
    await choose(user, "Wallet account", "Not mapped");
    await user.click(screen.getByRole("button", { name: "Save mapping" }));
    expect(
      await screen.findByText("You do not have permission to change the integrations."),
    ).toBeInTheDocument();
  });

  it("shows a 422 on the wrong-type account next to the Binance picker", async () => {
    const user = userEvent.setup();
    setup({
      "PUT /api/v1/settings/integrations": errorEnvelope("VALIDATION", {
        fieldErrors: { "binance.accountId": ["settings.integrations.errors.walletRequired"] },
      }),
    });
    await choose(user, "Payment method", "Cash");
    await user.click(screen.getByRole("button", { name: "Save mapping" }));
    const alert = await screen.findByText("Choose a crypto wallet account.");
    expect(alert).toBeInTheDocument();
    expect(within(alert.closest("[data-slot='field']")!).getByRole("combobox")).toBeInTheDocument();
  });

  it("explains when there are no wallet accounts to map", () => {
    setup({}, { stripe: null, binance: null }, []);
    expect(screen.getByText(/no crypto wallet accounts yet/i)).toBeInTheDocument();
  });
});
