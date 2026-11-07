import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enBilling from "@/i18n/messages/en/billing.json";
import enCommon from "@/i18n/messages/en/common.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import type { BillingPlanDTO } from "@/lib/validators/billing";
import { PlanCard } from "./plan-card";

const { upsertBillingPlanAction, applyInstallmentTemplateAction } = vi.hoisted(() => ({
  upsertBillingPlanAction: vi.fn(),
  applyInstallmentTemplateAction: vi.fn(),
}));
vi.mock("../actions", () => ({ upsertBillingPlanAction, applyInstallmentTemplateAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const plan: BillingPlanDTO = {
  id: "bpl_1",
  projectId: "prj_1",
  model: "PRECIO_FIJO",
  currency: "USD",
  contractAmount: "10000.00",
  notes: null,
  installments: [],
  installmentsTotal: "10000.00",
  scheduleDifference: "0.00",
  scheduleConsistent: true,
  contractedUsd: "10000.00",
  usdRate: "1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const currencies = [
  { code: "USD", name: "US dollar" },
  { code: "EUR", name: "Euro" },
];

function renderCard(ui: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale="en"
      timeZone="America/Caracas"
      messages={{
        billing: enBilling,
        common: enCommon,
        enums: enEnums,
        patterns: enPatterns,
      }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  upsertBillingPlanAction.mockReset();
  applyInstallmentTemplateAction.mockReset();
});

describe("PlanCard", () => {
  it("shows billing.errors.rateMissing on the currency field when the BE refuses the save", async () => {
    upsertBillingPlanAction.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "billing.errors.rateMissing",
        fieldErrors: { currency: ["billing.errors.rateMissing"] },
      },
    });
    renderCard(<PlanCard projectId="prj_1" plan={plan} currencies={currencies} canEdit />);

    await userEvent.click(screen.getByRole("button", { name: "Save plan" }));

    const currency = await screen.findByRole("combobox", { name: "Contract currency" });
    await waitFor(() => expect(currency).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByText(enBilling.errors.rateMissing)).toBeInTheDocument();
  });

  it("previews the 40/30/30 split of 10,000 as a labelled estimate", () => {
    renderCard(<PlanCard projectId="prj_1" plan={plan} currencies={currencies} canEdit />);

    expect(screen.getByText(enBilling.templates.estimate)).toBeInTheDocument();
    const preview = screen.getByRole("list", { name: enBilling.templates.estimate });
    expect(Array.from(preview.querySelectorAll("li")).map((item) => item.textContent)).toEqual([
      expect.stringContaining("4,000.00"),
      expect.stringContaining("3,000.00"),
      expect.stringContaining("3,000.00"),
    ]);
  });

  it("sends the template without any FE-computed amount", async () => {
    applyInstallmentTemplateAction.mockResolvedValue({ ok: true, data: {} });
    renderCard(<PlanCard projectId="prj_1" plan={plan} currencies={currencies} canEdit />);

    await userEvent.click(screen.getByRole("button", { name: "Apply template" }));

    await waitFor(() =>
      expect(applyInstallmentTemplateAction).toHaveBeenCalledWith({
        projectId: "prj_1",
        template: "SPLIT_40_30_30",
        replacePending: true,
      }),
    );
  });
});
