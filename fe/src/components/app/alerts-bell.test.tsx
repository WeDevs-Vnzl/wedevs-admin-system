import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listAlertsAction } from "@/features/alerts/actions";
import enAlerts from "@/i18n/messages/en/alerts.json";
import enCommon from "@/i18n/messages/en/common.json";
import enShell from "@/i18n/messages/en/shell.json";
import { ALERTS_BADGE_CLASSES, AlertsBell } from "./alerts-bell";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/features/alerts/actions", () => ({
  listAlertsAction: vi.fn(),
  dismissAlertAction: vi.fn(),
  snoozeAlertAction: vi.fn(),
  restoreAlertAction: vi.fn(),
}));

function renderBell(count: number) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ shell: enShell, alerts: enAlerts, common: enCommon }}
    >
      <AlertsBell count={count} />
    </NextIntlClientProvider>,
  );
}

const alert = {
  alertKey: "DOCUMENT_EXPIRED:doc_1",
  type: "DOCUMENT_EXPIRED",
  entity: { type: "DOCUMENT", id: "doc_1", label: "Propuesta", code: "DOC-0001" },
  date: "2026-09-27",
  days: -12,
  amount: null,
  context: "Propuesta",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listAlertsAction).mockResolvedValue({
    ok: true,
    data: { total: 1, byType: { DOCUMENT_EXPIRED: 1 }, items: [alert] },
  } as never);
});

describe("AlertsBell", () => {
  it("does not load anything until the panel opens, then lists the alerts", async () => {
    const user = userEvent.setup();
    renderBell(1);
    expect(listAlertsAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Alerts: 1 alert" }));
    expect(await screen.findByRole("link", { name: "Expired document" })).toHaveAttribute(
      "href",
      "/documents/doc_1",
    );
    expect(listAlertsAction).toHaveBeenCalledWith({ limit: 20 });
    expect(screen.getByRole("button", { name: enShell.alerts.markAllRead })).toBeDisabled();
    // the panel is labelled by its visible title
    const panel = screen.getByRole("dialog");
    expect(panel).toHaveAccessibleName(enShell.alerts.title);
    expect(
      screen.getByRole("button", { name: "Dismiss: Expired document · Propuesta · Propuesta" }),
    ).toBeInTheDocument();
  });

  it("keeps the empty state when there are no alerts and disables 'mark all read'", async () => {
    vi.mocked(listAlertsAction).mockResolvedValue({
      ok: true,
      data: { total: 0, byType: {}, items: [] },
    } as never);
    const user = userEvent.setup();
    renderBell(0);
    await user.click(screen.getByRole("button", { name: "Alerts" }));
    expect(await screen.findByText(enAlerts.list.empty)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: enShell.alerts.markAllRead })).toBeDisabled();
    expect(document.querySelector('[data-slot="alerts-badge"]')).toBeNull();
  });

  it("shows the counter badge and syncs it with the loaded total", async () => {
    const user = userEvent.setup();
    renderBell(5);
    expect(document.querySelector('[data-slot="alerts-badge"]')?.textContent).toBe("5");
    await user.click(screen.getByRole("button", { name: /Alerts/ }));
    await waitFor(() =>
      expect(document.querySelector('[data-slot="alerts-badge"]')?.textContent).toBe("1"),
    );
  });

  it("R16: the badge is white on the light destructive and uses the dark background on the dark one", () => {
    // Measured: #fff on #c2362f = 5.44:1 (light); #0b0b0f on #ef6a62 = 6.46:1 (dark). Both ≥ 4.5:1.
    expect(ALERTS_BADGE_CLASSES).toContain("bg-destructive");
    expect(ALERTS_BADGE_CLASSES).toContain("text-white");
    expect(ALERTS_BADGE_CLASSES).toContain("dark:text-background");
    expect(ALERTS_BADGE_CLASSES).not.toContain("text-[10px]");
    renderBell(3);
    expect(document.querySelector('[data-slot="alerts-badge"]')?.className).toBe(
      ALERTS_BADGE_CLASSES,
    );
  });
});
