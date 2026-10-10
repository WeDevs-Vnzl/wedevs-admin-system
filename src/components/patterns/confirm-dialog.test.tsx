import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import enPatterns from "@/i18n/messages/en/patterns.json";
import esPatterns from "@/i18n/messages/es/patterns.json";
import { ConfirmDialog, type ConfirmResult, type ConfirmVariant } from "./confirm-dialog";

function Harness({
  variant = "archive",
  locale = "en",
  onConfirm = vi.fn(),
  requireReason = true,
  extra = "Also void issued invoices",
}: {
  variant?: ConfirmVariant;
  locale?: "es" | "en";
  onConfirm?: (result: ConfirmResult) => void;
  requireReason?: boolean;
  extra?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <NextIntlClientProvider locale={locale} messages={{ patterns: locale === "es" ? esPatterns : enPatterns }}>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <ConfirmDialog
        variant={variant}
        open={open}
        onOpenChange={setOpen}
        onConfirm={onConfirm}
        requireReason={requireReason}
        extraCheckboxLabel={extra}
      />
    </NextIntlClientProvider>
  );
}

describe("ConfirmDialog", () => {
  it("shows the destructive copy of the variant in both languages", async () => {
    const en = render(<Harness variant="void" />);
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    expect(await screen.findByText(enPatterns.confirm.variants.void.title)).toBeInTheDocument();
    en.unmount();

    render(<Harness variant="cancel" locale="es" />);
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    expect(await screen.findByText(esPatterns.confirm.variants.cancel.title)).toBeInTheDocument();
  });

  it("keeps confirm disabled until the reason is not blank, then trims it", async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole("button", { name: "open" }));

    const confirm = await screen.findByRole("button", { name: enPatterns.confirm.variants.archive.action });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(enPatterns.confirm.reason), "   ");
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(enPatterns.confirm.reason), " duplicate ");
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledWith({ reason: "duplicate", extraChecked: true });
  });

  it("resets the reason and the checkbox every time it opens", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    await userEvent.type(await screen.findByLabelText(enPatterns.confirm.reason), "stale reason");
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: enPatterns.confirm.dismiss }));

    await userEvent.click(screen.getByRole("button", { name: "open" }));
    expect(await screen.findByLabelText(enPatterns.confirm.reason)).toHaveValue("");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("uses generated ids for the reason and the extra checkbox", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    const reason = await screen.findByLabelText(enPatterns.confirm.reason);
    expect(reason.id).not.toBe("confirm-dialog-reason");
    expect(screen.getByRole("checkbox").id).not.toBe("confirm-dialog-extra");
  });

  it("omits reason and extra when they are not requested", async () => {
    const onConfirm = vi.fn();
    render(<Harness requireReason={false} extra="" onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    await userEvent.click(await screen.findByRole("button", { name: enPatterns.confirm.variants.archive.action }));
    expect(onConfirm).toHaveBeenCalledWith({ reason: undefined, extraChecked: undefined });
  });
});
