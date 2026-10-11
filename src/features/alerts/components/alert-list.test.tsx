import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enAlerts from "@/i18n/messages/en/alerts.json";
import enCommon from "@/i18n/messages/en/common.json";
import type { AlertDTO } from "@/lib/validators/alerts";
import {
  dismissAlertAction,
  listAlertsAction,
  restoreAlertAction,
  snoozeAlertAction,
} from "../actions";
import { AlertList } from "./alert-list";

const mocks = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("../actions", () => ({
  listAlertsAction: vi.fn(),
  dismissAlertAction: vi.fn(),
  snoozeAlertAction: vi.fn(),
  restoreAlertAction: vi.fn(),
}));

const overdue: AlertDTO = {
  alertKey: "INVOICE_OVERDUE:inv_1",
  type: "INVOICE_OVERDUE",
  entity: { type: "INVOICE", id: "inv_1", label: "A-0001", code: "FAC-0001" },
  date: "2026-10-01",
  days: -8,
  amount: { amount: "1250.50", currency: "USD" },
  context: "Cliente Prueba",
};
const rate: AlertDTO = {
  alertKey: "MISSING_RATE:VES:2026-10-09",
  type: "MISSING_RATE",
  entity: null,
  date: "2026-10-09",
  days: 0,
  amount: null,
  context: null,
};

const summary = (items: AlertDTO[]) =>
  ({ ok: true, data: { total: items.length, byType: {}, items } }) as never;

function renderList(props: Partial<React.ComponentProps<typeof AlertList>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ alerts: enAlerts, common: enCommon }}>
      <AlertList {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listAlertsAction).mockResolvedValue(summary([overdue, rate]));
  vi.mocked(dismissAlertAction).mockResolvedValue({ ok: true, data: {} } as never);
  vi.mocked(snoozeAlertAction).mockResolvedValue({ ok: true, data: {} } as never);
  vi.mocked(restoreAlertAction).mockResolvedValue({ ok: true, data: {} } as never);
});

describe("AlertList", () => {
  it("loads through listAlertsAction with types and limit, and renders title, ICU days, money and link", async () => {
    renderList({ types: ["INVOICE_OVERDUE", "MISSING_RATE"], limit: 5 });
    expect(await screen.findByRole("link", { name: "Overdue invoice" })).toHaveAttribute(
      "href",
      "/invoices/inv_1",
    );
    expect(listAlertsAction).toHaveBeenCalledWith({
      types: ["INVOICE_OVERDUE", "MISSING_RATE"],
      limit: 5,
    });
    expect(screen.getByText(/Overdue by 8 days/)).toBeInTheDocument();
    expect(screen.getByText(/\$1,250\.50/)).toBeInTheDocument();
    expect(screen.getByText(/A-0001 · Cliente Prueba/)).toBeInTheDocument();
    // the missing rate points at the rates screen
    expect(screen.getByRole("link", { name: "Missing VES rate" })).toHaveAttribute(
      "href",
      "/settings/rates",
    );
  });

  it("shows the empty state and the load error", async () => {
    vi.mocked(listAlertsAction).mockResolvedValueOnce(summary([]));
    const { unmount } = renderList();
    expect(await screen.findByText(enAlerts.list.empty)).toBeInTheDocument();
    unmount();
    vi.mocked(listAlertsAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "INTERNAL" },
    } as never);
    renderList();
    expect(await screen.findByText(enAlerts.list.loadFailed)).toBeInTheDocument();
  });

  it("dismisses, reloads and offers an undo that calls restoreAlertAction", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByRole("link", { name: "Overdue invoice" });
    vi.mocked(listAlertsAction).mockResolvedValue(summary([rate]));

    await user.click(
      screen.getByRole("button", { name: "Dismiss: Overdue invoice · A-0001 · Cliente Prueba" }),
    );
    expect(dismissAlertAction).toHaveBeenCalledWith({ alertKey: overdue.alertKey });
    await waitFor(() => expect(screen.queryByRole("link", { name: "Overdue invoice" })).toBeNull());

    const [message, options] = mocks.toast.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe(enAlerts.toasts.dismissed);
    expect(options.action.label).toBe("Undo");
    options.action.onClick();
    await waitFor(() =>
      expect(restoreAlertAction).toHaveBeenCalledWith({ alertKey: overdue.alertKey }),
    );
  });

  it("snoozes for 1, 3 or 7 days from the menu", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByRole("link", { name: "Overdue invoice" });
    await user.click(
      screen.getByRole("button", { name: "Snooze: Overdue invoice · A-0001 · Cliente Prueba" }),
    );
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["1 day", "3 days", "7 days"]);
    await user.click(within(menu).getByRole("menuitem", { name: "3 days" }));
    expect(snoozeAlertAction).toHaveBeenCalledWith({ alertKey: overdue.alertKey, days: 3 });
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("Alert snoozed for 3 days", expect.anything()),
    );
  });

  it("reports the active total to the parent", async () => {
    const onTotalChange = vi.fn();
    renderList({ onTotalChange });
    await screen.findByRole("link", { name: "Overdue invoice" });
    expect(onTotalChange).toHaveBeenCalledWith(2);
  });

  it("toasts the error code when a dismissal fails", async () => {
    const user = userEvent.setup();
    vi.mocked(dismissAlertAction).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL" },
    } as never);
    renderList();
    await screen.findByRole("link", { name: "Overdue invoice" });
    await user.click(
      screen.getByRole("button", { name: "Dismiss: Overdue invoice · A-0001 · Cliente Prueba" }),
    );
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(enCommon.errors.INTERNAL));
  });

  it("moves focus to the next alert after a dismissal, and to the list when none is left", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByRole("link", { name: "Overdue invoice" });
    vi.mocked(listAlertsAction).mockResolvedValue(summary([rate]));
    await user.click(screen.getByRole("button", { name: /^Dismiss: Overdue invoice/ }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Missing VES rate" })).toHaveFocus(),
    );

    vi.mocked(listAlertsAction).mockResolvedValue(summary([]));
    await user.click(screen.getByRole("button", { name: "Dismiss: Missing VES rate" }));
    const empty = await screen.findByText(enAlerts.list.empty);
    await waitFor(() => expect(empty.closest("[tabindex='-1']")).toHaveFocus());
  });

  it("moves focus to the next alert after a snooze", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByRole("link", { name: "Overdue invoice" });
    vi.mocked(listAlertsAction).mockResolvedValue(summary([rate]));
    await user.click(screen.getByRole("button", { name: /^Snooze: Overdue invoice/ }));
    await user.click(await screen.findByRole("menuitem", { name: "1 day" }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Missing VES rate" })).toHaveFocus(),
    );
  });
});
