import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { listAlertsAction, markAlertsReadAction } from "@/features/alerts/actions";
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
  markAlertsReadAction: vi.fn(),
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
    data: {
      total: 1,
      byType: { DOCUMENT_EXPIRED: 1 },
      items: [alert],
      unread: 1,
      readKeys: [],
    },
  } as never);
  vi.mocked(markAlertsReadAction).mockResolvedValue({
    ok: true,
    data: { alertKeys: [alert.alertKey] },
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
    expect(screen.getByRole("button", { name: enShell.alerts.markAllRead })).toBeEnabled();
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
      data: { total: 0, byType: {}, items: [], unread: 0, readKeys: [] },
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

  it("counts only unread alerts once the panel loads (A2)", async () => {
    const other = { ...alert, alertKey: "DOCUMENT_EXPIRED:doc_2" };
    vi.mocked(listAlertsAction).mockResolvedValue({
      ok: true,
      data: {
        total: 2,
        byType: { DOCUMENT_EXPIRED: 2 },
        items: [alert, other],
        unread: 1,
        readKeys: [other.alertKey],
      },
    } as never);
    const user = userEvent.setup();
    renderBell(2);
    await user.click(screen.getByRole("button", { name: "Alerts: 2 alerts" }));
    expect(await screen.findAllByRole("link", { name: "Expired document" })).toHaveLength(2);
    await waitFor(() =>
      expect(document.querySelector('[data-slot="alerts-badge"]')?.textContent).toBe("1"),
    );
  });

  it("'Mark all as read' marks the listed unread alerts and clears the counter; they stay listed", async () => {
    const user = userEvent.setup();
    renderBell(1);
    await user.click(screen.getByRole("button", { name: "Alerts: 1 alert" }));
    await screen.findByRole("link", { name: "Expired document" });

    await user.click(screen.getByRole("button", { name: enShell.alerts.markAllRead }));
    expect(markAlertsReadAction).toHaveBeenCalledWith({ alertKeys: [alert.alertKey] });
    await waitFor(() => expect(document.querySelector('[data-slot="alerts-badge"]')).toBeNull());
    expect(screen.getByRole("button", { name: "Alerts" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Expired document" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: enShell.alerts.markAllRead })).toBeDisabled();
    expect(toast.success).toHaveBeenCalledWith(enShell.alerts.markedRead);
  });

  it("keeps the counter and reports the error when marking fails", async () => {
    vi.mocked(markAlertsReadAction).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL" },
    } as never);
    const user = userEvent.setup();
    renderBell(1);
    await user.click(screen.getByRole("button", { name: "Alerts: 1 alert" }));
    await screen.findByRole("link", { name: "Expired document" });
    await user.click(screen.getByRole("button", { name: enShell.alerts.markAllRead }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(enCommon.errors.INTERNAL));
    expect(document.querySelector('[data-slot="alerts-badge"]')?.textContent).toBe("1");
    expect(screen.getByRole("button", { name: enShell.alerts.markAllRead })).toBeEnabled();
  });
});
