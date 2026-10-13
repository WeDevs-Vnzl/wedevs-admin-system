import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/messages/en/common.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enProjects from "@/i18n/messages/en/projects.json";
import { archiveProjectsAction } from "@/features/projects/actions";
import { ProjectsBulkActions } from "./projects-bulk-actions";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/projects/actions", () => ({
  archiveProjectAction: vi.fn(),
  archiveProjectsAction: vi.fn(),
}));
vi.mock("@/features/tags/actions", () => ({ assignTagsAction: vi.fn() }));
vi.mock("@/features/tags/components/tag-picker", () => ({
  TagPicker: () => <div data-testid="tag-picker" />,
}));

const messages = { common: enCommon, patterns: enPatterns, projects: enProjects };

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

function renderBulk(onDone = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ProjectsBulkActions
        ids={["pry_1", "pry_2"]}
        canTag
        canArchive
        canCreateTags
        onDone={onDone}
      />
    </NextIntlClientProvider>,
  );
  return { onDone };
}

describe("ProjectsBulkActions", () => {
  it("archives without confirm first and asks for confirmation on INTEGRITY_LOCK (B2)", async () => {
    vi.mocked(archiveProjectsAction)
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "INTEGRITY_LOCK", message: "projects.errors.archiveNeedsConfirm" },
      } as never)
      .mockResolvedValueOnce({ ok: true, data: { archived: [] } } as never);
    const { onDone } = renderBulk();
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Archive" }));

    expect(await screen.findByText(enProjects.errors.archiveNeedsConfirm)).toBeInTheDocument();
    expect(archiveProjectsAction).toHaveBeenCalledWith({ ids: ["pry_1", "pry_2"], confirm: false });
    expect(onDone).not.toHaveBeenCalled();

    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Archive" }),
    );
    await waitFor(() =>
      expect(archiveProjectsAction).toHaveBeenLastCalledWith({
        ids: ["pry_1", "pry_2"],
        confirm: true,
      }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("returns focus to the Tag button when the tag dialog closes (m1)", async () => {
    renderBulk();
    const opener = screen.getByRole("button", { name: enProjects.list.bulk.tag });
    await userEvent.click(opener);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: enProjects.form.cancel }));
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
