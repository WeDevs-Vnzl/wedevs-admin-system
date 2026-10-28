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
    <NextIntlClientProvider
      locale={locale}
      messages={{ patterns: locale === "es" ? esPatterns : enPatterns }}
    >
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

    const confirm = await screen.findByRole("button", {
      name: enPatterns.confirm.variants.archive.action,
    });
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
    await userEvent.click(
      await screen.findByRole("button", { name: enPatterns.confirm.variants.archive.action }),
    );
    expect(onConfirm).toHaveBeenCalledWith({ reason: undefined, extraChecked: undefined });
  });

  it("returns one boolean per option, checked or not", async () => {
    const onConfirm = vi.fn();
    function OptionsHarness() {
      const [open, setOpen] = useState(false);
      return (
        <NextIntlClientProvider locale="en" messages={{ patterns: enPatterns }}>
          <button type="button" onClick={() => setOpen(true)}>
            open
          </button>
          <ConfirmDialog
            variant="cancel"
            open={open}
            onOpenChange={setOpen}
            onConfirm={onConfirm}
            options={[
              { id: "cancelPendingInstallments", label: "Cancel pending installments" },
              { id: "finishRecurringCharges", label: "Finish recurring charges" },
            ]}
          />
        </NextIntlClientProvider>
      );
    }
    render(<OptionsHarness />);
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    await userEvent.click(await screen.findByLabelText("Finish recurring charges"));
    await userEvent.click(
      screen.getByRole("button", { name: enPatterns.confirm.variants.cancel.action }),
    );

    expect(onConfirm).toHaveBeenCalledWith({
      reason: undefined,
      extraChecked: undefined,
      options: { cancelPendingInstallments: false, finishRecurringCharges: true },
    });
  });

  it("replaces the variant description with the given one", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ patterns: enPatterns }}>
        <ConfirmDialog
          variant="delete"
          open
          onOpenChange={vi.fn()}
          onConfirm={vi.fn()}
          description="“Acme” will be removed."
        />
      </NextIntlClientProvider>,
    );
    expect(await screen.findByText("“Acme” will be removed.")).toBeInTheDocument();
    expect(
      screen.queryByText(enPatterns.confirm.variants.delete.description),
    ).not.toBeInTheDocument();
  });

  it("renders the delete and unlink variants with their own copy", async () => {
    render(
      <NextIntlClientProvider locale="es" messages={{ patterns: esPatterns }}>
        <ConfirmDialog variant="unlink" open onOpenChange={vi.fn()} onConfirm={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(await screen.findByText(esPatterns.confirm.variants.unlink.title)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: esPatterns.confirm.variants.unlink.action }),
    ).toBeInTheDocument();
  });

  it("unchecks the options every time it opens", async () => {
    function OptionsHarness() {
      const [open, setOpen] = useState(false);
      return (
        <NextIntlClientProvider locale="en" messages={{ patterns: enPatterns }}>
          <button type="button" onClick={() => setOpen(true)}>
            open
          </button>
          <ConfirmDialog
            variant="archive"
            open={open}
            onOpenChange={setOpen}
            onConfirm={vi.fn()}
            options={[{ id: "keep", label: "Keep linked" }]}
          />
        </NextIntlClientProvider>
      );
    }
    render(<OptionsHarness />);
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    await userEvent.click(await screen.findByLabelText("Keep linked"));
    expect(screen.getByLabelText("Keep linked")).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: enPatterns.confirm.dismiss }));

    await userEvent.click(screen.getByRole("button", { name: "open" }));
    expect(await screen.findByLabelText("Keep linked")).not.toBeChecked();
  });
});
