import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enBilling from "@/i18n/messages/en/billing.json";
import enCommon from "@/i18n/messages/en/common.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enTable from "@/i18n/messages/en/table.json";
import { formatDate } from "@/lib/dates";
import type { RecurringChargeDTO } from "@/lib/validators/billing";
import { RecurringChargesTable } from "./recurring-charges-table";

const { setRecurringChargeStatusAction, generateMissingPeriodsAction, toast } = vi.hoisted(() => ({
  setRecurringChargeStatusAction: vi.fn(),
  generateMissingPeriodsAction: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("../actions", () => ({
  setRecurringChargeStatusAction,
  generateMissingPeriodsAction,
  createRecurringChargeAction: vi.fn(),
  updateRecurringChargeAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast }));

const charge: RecurringChargeDTO = {
  id: "rch_1",
  projectId: "prj_1",
  label: "Hosting",
  amount: "50.00",
  currency: "USD",
  frequency: "MENSUAL",
  startDate: "2026-01-01",
  endDate: null,
  billingDay: 5,
  leadDays: 7,
  status: "ACTIVO",
  lastGeneratedPeriodStart: null,
  resumedOn: null,
  monthlyAmount: "50.00",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function renderTable(row: RecurringChargeDTO) {
  return render(
    <NextIntlClientProvider
      locale="en"
      timeZone="America/Caracas"
      messages={{
        billing: enBilling,
        common: enCommon,
        enums: enEnums,
        patterns: enPatterns,
        table: enTable,
      }}
    >
      <RecurringChargesTable
        projectId="prj_1"
        charges={[row]}
        currencies={[{ code: "USD", name: "US dollar" }]}
        defaultCurrency="USD"
        canEdit
      />
    </NextIntlClientProvider>,
  );
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  setRecurringChargeStatusAction.mockReset().mockResolvedValue({ ok: true, data: {} });
  generateMissingPeriodsAction.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("RecurringChargesTable", () => {
  it("pauses an active charge", async () => {
    renderTable(charge);

    await userEvent.click(screen.getByRole("button", { name: "Pause Hosting" }));

    await waitFor(() =>
      expect(setRecurringChargeStatusAction).toHaveBeenCalledWith({
        id: "rch_1",
        status: "PAUSADO",
      }),
    );
    expect(toast.success).toHaveBeenCalledWith(enBilling.recurring.toast.paused);
  });

  it("resumes a paused charge without generating periods", async () => {
    renderTable({ ...charge, status: "PAUSADO" });

    await userEvent.click(screen.getByRole("button", { name: "Resume Hosting" }));

    await waitFor(() =>
      expect(setRecurringChargeStatusAction).toHaveBeenCalledWith({
        id: "rch_1",
        status: "ACTIVO",
      }),
    );
    expect(generateMissingPeriodsAction).not.toHaveBeenCalled();
  });

  it("generates the missing periods and lists the ones the BE returns", async () => {
    generateMissingPeriodsAction.mockResolvedValue({
      ok: true,
      data: { created: 2, periodStarts: ["2026-02-05", "2026-03-05"] },
    });
    renderTable(charge);

    await userEvent.click(
      screen.getByRole("button", { name: "Generate pending periods of Hosting" }),
    );

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    const [title, options] = toast.success.mock.calls[0] as [string, { description: string }];
    expect(title).toBe("2 periods generated");
    expect(options.description).toBe(
      ["2026-02-05", "2026-03-05"].map((date) => formatDate(date, "en")).join(", "),
    );
  });

  it("says so when there was nothing to generate", async () => {
    generateMissingPeriodsAction.mockResolvedValue({
      ok: true,
      data: { created: 0, periodStarts: [] },
    });
    renderTable(charge);

    await userEvent.click(
      screen.getByRole("button", { name: "Generate pending periods of Hosting" }),
    );

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(enBilling.recurring.toast.nothingToGenerate),
    );
  });
});
