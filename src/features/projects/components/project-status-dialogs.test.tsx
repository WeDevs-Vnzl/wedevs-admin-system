import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/messages/en/common.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enProjects from "@/i18n/messages/en/projects.json";
import enValidation from "@/i18n/messages/en/validation.json";
import { ProjectCancelDialog, ProjectTransitionDialog } from "./project-status-dialogs";

const actions = vi.hoisted(() => ({ setProjectStatusAction: vi.fn() }));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("@/features/projects/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const messages = {
  common: enCommon,
  enums: enEnums,
  patterns: enPatterns,
  projects: enProjects,
  validation: enValidation,
};

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
  actions.setProjectStatusAction.mockReset();
  actions.setProjectStatusAction.mockResolvedValue({ ok: true, data: { project: {}, hints: [] } });
  router.push.mockReset();
  router.refresh.mockReset();
});

function renderTransition(
  status: "PROPUESTA" | "EN_CURSO",
  onRequestCancel = vi.fn(),
  startDate: string | null = null,
) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="America/Caracas">
      <ProjectTransitionDialog
        open
        onOpenChange={vi.fn()}
        project={{ id: "pry_kairos_web", status, startDate, endDate: null }}
        onRequestCancel={onRequestCancel}
      />
    </NextIntlClientProvider>,
  );
  return { onRequestCancel };
}

async function pickTarget(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole("combobox"));
  await user.click(await screen.findByRole("option", { name: label }));
}

describe("ProjectTransitionDialog (HU-08)", () => {
  it("requires the start date to move to In progress (CA1)", async () => {
    const user = userEvent.setup();
    renderTransition("PROPUESTA");
    // The first target of PROPUESTA is EN_CURSO, so the start date field is shown and required.
    await user.click(screen.getByRole("button", { name: "Change status" }));
    expect(await screen.findByText("Moving to In progress requires the start date.")).toBeInTheDocument();
    expect(actions.setProjectStatusAction).not.toHaveBeenCalled();
  });

  it("requires the actual delivery date to move to Delivered (CA2)", async () => {
    const user = userEvent.setup();
    renderTransition("EN_CURSO", vi.fn(), "2026-07-01");
    await pickTarget(user, "Delivered");
    await user.click(screen.getByRole("button", { name: "Change status" }));
    expect(await screen.findByText("Moving to Delivered requires the actual delivery date.")).toBeInTheDocument();
    expect(actions.setProjectStatusAction).not.toHaveBeenCalled();
  });

  it("sends the target with the start date already on the project, and reports hints (CA4)", async () => {
    const user = userEvent.setup();
    actions.setProjectStatusAction.mockResolvedValue({
      ok: true,
      data: { project: {}, hints: ["NO_BILLING_PLAN"] },
    });
    renderTransition("EN_CURSO", vi.fn(), "2026-07-01");
    await pickTarget(user, "Paused");
    await user.click(screen.getByRole("button", { name: "Change status" }));
    await waitFor(() =>
      expect(actions.setProjectStatusAction).toHaveBeenCalledWith({
        id: "pry_kairos_web",
        status: "PAUSADO",
        startDate: "2026-07-01",
        endDate: undefined,
      }),
    );
  });

  it("hands Cancelled to the confirmation instead of submitting it (CA3)", async () => {
    const user = userEvent.setup();
    const { onRequestCancel } = renderTransition("PROPUESTA");
    await pickTarget(user, "Cancelled");
    await user.click(screen.getByRole("button", { name: "Change status" }));
    expect(onRequestCancel).toHaveBeenCalledTimes(1);
    expect(actions.setProjectStatusAction).not.toHaveBeenCalled();
  });
});

describe("ProjectCancelDialog (HU-08 CA3)", () => {
  it("sends the two options as flags and confirm: true", async () => {
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="America/Caracas">
        <ProjectCancelDialog open onOpenChange={vi.fn()} projectId="pry_kairos_web" />
      </NextIntlClientProvider>,
    );
    await user.click(screen.getByRole("checkbox", { name: "Cancel pending installments" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: enPatterns.confirm.variants.cancel.action }));
    await waitFor(() =>
      expect(actions.setProjectStatusAction).toHaveBeenCalledWith({
        id: "pry_kairos_web",
        status: "CANCELADO",
        confirm: true,
        cancelPendingInstallments: true,
        finishRecurringCharges: false,
      }),
    );
  });
});
