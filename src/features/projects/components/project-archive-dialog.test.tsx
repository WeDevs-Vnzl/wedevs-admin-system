import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/messages/en/common.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enProjects from "@/i18n/messages/en/projects.json";
import { archiveProjectAction, archiveProjectsAction } from "@/features/projects/actions";
import { ProjectArchiveDialog } from "./project-archive-dialog";

const mocks = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/features/projects/actions", () => ({
  archiveProjectAction: vi.fn(),
  archiveProjectsAction: vi.fn(),
}));

const messages = { common: enCommon, patterns: enPatterns, projects: enProjects };

const LOCK = {
  ok: false,
  error: { code: "INTEGRITY_LOCK", message: "projects.errors.archiveNeedsConfirm" },
};

function Harness({ ids, onArchived }: { ids: string[]; onArchived: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <button type="button" onClick={() => setOpen(true)}>
        open-archive
      </button>
      <ProjectArchiveDialog
        ids={ids}
        open={open}
        onOpenChange={setOpen}
        description="First step copy"
        onArchived={onArchived}
      />
    </NextIntlClientProvider>
  );
}

async function openDialog() {
  await userEvent.click(screen.getByRole("button", { name: "open-archive" }));
  return screen.findByRole("alertdialog");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProjectArchiveDialog (B2)", () => {
  it("sends one project without confirm first, so the active-billing guard runs", async () => {
    vi.mocked(archiveProjectAction).mockResolvedValue({ ok: true, data: { id: "pry_1" } } as never);
    const onArchived = vi.fn();
    render(<Harness ids={["pry_1"]} onArchived={onArchived} />);
    await openDialog();
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() =>
      expect(archiveProjectAction).toHaveBeenCalledWith({ id: "pry_1", confirm: false }),
    );
    expect(onArchived).toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalledWith("Project archived");
  });

  it("on INTEGRITY_LOCK keeps the dialog open with the needs-confirm text and re-sends with confirm: true", async () => {
    vi.mocked(archiveProjectAction)
      .mockResolvedValueOnce(LOCK as never)
      .mockResolvedValueOnce({ ok: true, data: { id: "pry_1" } } as never);
    const onArchived = vi.fn();
    render(<Harness ids={["pry_1"]} onArchived={onArchived} />);
    await openDialog();
    expect(screen.getByText("First step copy")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));

    expect(await screen.findByText(enProjects.errors.archiveNeedsConfirm)).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(onArchived).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(archiveProjectAction).toHaveBeenLastCalledWith({ id: "pry_1", confirm: true }),
    );
    await waitFor(() => expect(onArchived).toHaveBeenCalled());
  });

  it("does the same for a bulk selection", async () => {
    vi.mocked(archiveProjectsAction)
      .mockResolvedValueOnce(LOCK as never)
      .mockResolvedValueOnce({ ok: true, data: { archived: [] } } as never);
    render(<Harness ids={["pry_1", "pry_2"]} onArchived={vi.fn()} />);
    await openDialog();
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(await screen.findByText(enProjects.errors.archiveNeedsConfirm)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() =>
      expect(vi.mocked(archiveProjectsAction).mock.calls).toEqual([
        [{ ids: ["pry_1", "pry_2"], confirm: false }],
        [{ ids: ["pry_1", "pry_2"], confirm: true }],
      ]),
    );
  });

  it("toasts any other failure and starts over at the first step on the next opening", async () => {
    vi.mocked(archiveProjectAction)
      .mockResolvedValueOnce(LOCK as never)
      .mockResolvedValueOnce({ ok: false, error: { code: "FORBIDDEN" } } as never);
    render(<Harness ids={["pry_1"]} onArchived={vi.fn()} />);
    await openDialog();
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    await screen.findByText(enProjects.errors.archiveNeedsConfirm);
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await openDialog();
    expect(screen.getByText("First step copy")).toBeInTheDocument();
  });

  it("returns focus to the opener when the dialog closes (m1)", async () => {
    render(<Harness ids={["pry_1"]} onArchived={vi.fn()} />);
    const opener = screen.getByRole("button", { name: "open-archive" });
    await openDialog();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
