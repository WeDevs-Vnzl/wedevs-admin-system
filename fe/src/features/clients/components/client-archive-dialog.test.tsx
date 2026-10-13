import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enClients from "@/i18n/messages/en/clients.json";
import enCommon from "@/i18n/messages/en/common.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import { archiveClientsAction } from "@/features/clients/actions";
import { ClientArchiveDialog } from "./client-archive-dialog";

const mocks = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/features/clients/actions", () => ({ archiveClientsAction: vi.fn() }));

const messages = { clients: enClients, common: enCommon, patterns: enPatterns };

function renderDialog(ids: string[], onArchived = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ClientArchiveDialog ids={ids} open onOpenChange={vi.fn()} onArchived={onArchived} />
    </NextIntlClientProvider>,
  );
}

// An opener that is focused before the dialog opens, the way the table's bulk bar and the detail menu are.
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <button type="button" onClick={() => setOpen(true)}>
        open-archive
      </button>
      <ClientArchiveDialog
        ids={["cli_1"]}
        open={open}
        onOpenChange={setOpen}
        onArchived={vi.fn()}
      />
    </NextIntlClientProvider>
  );
}

const LOCK = {
  ok: false,
  error: { code: "INTEGRITY_LOCK", message: "clients.errors.archiveNeedsConfirm" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ClientArchiveDialog", () => {
  it("sends the selected clients without confirm first and archives when there is no lock", async () => {
    vi.mocked(archiveClientsAction).mockResolvedValue({
      ok: true,
      data: { archived: [{ id: "cli_1", archivedContacts: 2 }] },
    } as never);
    const onArchived = vi.fn();
    renderDialog(["cli_1"], onArchived);

    expect(screen.getByText(enClients.archive.cascade)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() =>
      expect(archiveClientsAction).toHaveBeenCalledWith({ ids: ["cli_1"], confirm: false }),
    );
    expect(archiveClientsAction).toHaveBeenCalledTimes(1);
    expect(mocks.toast.success).toHaveBeenCalledWith("1 client archived");
    expect(onArchived).toHaveBeenCalled();
  });

  it("on INTEGRITY_LOCK keeps the dialog open with the lock message and re-sends with confirm: true", async () => {
    vi.mocked(archiveClientsAction)
      .mockResolvedValueOnce(LOCK as never)
      .mockResolvedValueOnce({
        ok: true,
        data: { archived: [{ id: "cli_1", archivedContacts: 0 }] },
      } as never);
    const onArchived = vi.fn();
    renderDialog(["cli_1"], onArchived);
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));

    expect(await screen.findByText(enClients.errors.archiveNeedsConfirm)).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(onArchived).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(archiveClientsAction).toHaveBeenLastCalledWith({ ids: ["cli_1"], confirm: true }),
    );
    await waitFor(() => expect(onArchived).toHaveBeenCalled());
  });

  it("cancelling after the lock message archives nothing and the next opening starts at the first step", async () => {
    vi.mocked(archiveClientsAction).mockResolvedValue(LOCK as never);
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "open-archive" }));
    await userEvent.click(await screen.findByRole("button", { name: "Archive" }));
    expect(await screen.findByText(enClients.errors.archiveNeedsConfirm)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(archiveClientsAction).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "open-archive" }));
    expect(await screen.findByText(enClients.archive.cascade)).toBeInTheDocument();
  });

  it("uses the plural cascade warning for a bulk selection", () => {
    renderDialog(["cli_1", "cli_2"]);
    expect(screen.getByText(enClients.archive.cascadeMany)).toBeInTheDocument();
  });

  it("returns focus to the opener when the dialog closes", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "open-archive" });

    await userEvent.click(opener);
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(opener).toHaveFocus());
  });
});
