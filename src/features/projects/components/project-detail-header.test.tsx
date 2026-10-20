import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/messages/en/common.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enProjects from "@/i18n/messages/en/projects.json";
import enTags from "@/i18n/messages/en/tags.json";
import enValidation from "@/i18n/messages/en/validation.json";
import { archiveProjectAction } from "@/features/projects/actions";
import { formatDate } from "@/lib/dates";
import { ProjectDetailHeader, type ProjectDetailHeaderProps } from "./project-detail-header";

vi.mock("@/features/projects/actions", () => ({
  archiveProjectAction: vi.fn(),
  archiveProjectsAction: vi.fn(),
  setProjectStatusAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const messages = {
  common: enCommon,
  enums: enEnums,
  patterns: enPatterns,
  projects: enProjects,
  tags: enTags,
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
});

const BASE: ProjectDetailHeaderProps = {
  id: "pry_kairos_web",
  code: "PRY-0001",
  name: "Sitio web Kairos",
  status: "EN_CURSO",
  startDate: "2026-07-01",
  endDate: null,
  archived: false,
  tags: [],
  canEdit: false,
  canArchive: false,
};

function renderHeader(props: Partial<ProjectDetailHeaderProps>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="America/Caracas">
      <ProjectDetailHeader {...BASE} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("ProjectDetailHeader dates (m6)", () => {
  it("shows the start and end dates formatted for the locale, never as raw ISO", () => {
    const { container } = renderHeader({ startDate: "2026-07-01", endDate: "2026-12-15" });
    const text = container.textContent ?? "";
    expect(text).toContain(formatDate("2026-07-01", "en"));
    expect(text).toContain(formatDate("2026-12-15", "en"));
    expect(text).not.toContain("2026-07-01");
    expect(text).not.toContain("2026-12-15");
  });
});

describe("ProjectDetailHeader role gating", () => {
  it("Viewer sees the record without Edit, status change or More actions", () => {
    renderHeader({ canEdit: false, canArchive: false });
    expect(screen.getByRole("heading", { name: "Sitio web Kairos" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
  });

  it("Member can edit and change status but gets no archive action", () => {
    renderHeader({ canEdit: true, canArchive: false });
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/projects/pry_kairos_web/edit",
    );
    expect(screen.getByRole("button", { name: "Change status" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
  });

  it("Owner and Admin get the archive action in the More menu", async () => {
    const user = userEvent.setup();
    renderHeader({ canEdit: true, canArchive: true });
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("menuitem", { name: "Archive project" })).toBeInTheDocument();
  });

  it("hides the status change for a project with no transitions left (CANCELADO)", () => {
    renderHeader({ canEdit: true, status: "CANCELADO" });
    expect(screen.queryByRole("button", { name: "Change status" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit" })).toBeInTheDocument();
  });
});

describe("ProjectDetailHeader archive (B2)", () => {
  async function openArchive() {
    const user = userEvent.setup();
    renderHeader({ canEdit: true, canArchive: true });
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive project" }));
    return { user, dialog: await screen.findByRole("alertdialog") };
  }

  it("sends without confirm first, then asks for confirmation on INTEGRITY_LOCK and re-sends with confirm: true", async () => {
    vi.mocked(archiveProjectAction)
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "INTEGRITY_LOCK", message: "projects.errors.archiveNeedsConfirm" },
      } as never)
      .mockResolvedValueOnce({ ok: true, data: { id: "pry_kairos_web" } } as never);
    const { user, dialog } = await openArchive();
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));

    expect(await screen.findByText(enProjects.errors.archiveNeedsConfirm)).toBeInTheDocument();
    expect(archiveProjectAction).toHaveBeenCalledWith({ id: "pry_kairos_web", confirm: false });

    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Archive" }),
    );
    await waitFor(() =>
      expect(archiveProjectAction).toHaveBeenLastCalledWith({
        id: "pry_kairos_web",
        confirm: true,
      }),
    );
  });

  it("returns focus to the More trigger when the archive dialog is dismissed", async () => {
    const { user, dialog } = await openArchive();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "More actions" })).toHaveFocus());
  });
});
