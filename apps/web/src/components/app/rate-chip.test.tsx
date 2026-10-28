import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, describe, expect, it } from "vitest";
import enShell from "@/i18n/messages/en/shell.json";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ShellVesRate } from "@/features/shell/queries";
import { RateChip } from "./rate-chip";

const rate = { date: "2026-10-09", usdRate: "755.16", source: "BCV" } as unknown as ShellVesRate;

function renderChip(props: { canManage: boolean; missing?: boolean; rate?: ShellVesRate | null }) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: enShell }}>
      <TooltipProvider>
        <RateChip
          rate={props.rate === undefined ? rate : props.rate}
          missing={props.missing ?? false}
          canManage={props.canManage}
        />
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
}

describe("RateChip", () => {
  beforeAll(() => {
    // Radix measures the tooltip anchor with ResizeObserver, which jsdom does not provide.
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  it("links to the rates catalog for a role that manages rates, named by its visible text (m2, R6)", () => {
    renderChip({ canManage: true });
    const link = screen.getByRole("link", { name: /BCV rate/ });
    expect(link).toHaveAttribute("href", "/settings/rates");
    expect(link).toHaveAccessibleName(/755\.16/);
    expect(link).toHaveAccessibleDescription(enShell.rateChip.link);
  });

  it("renders the same chip without a link for a role that cannot manage rates (m2)", () => {
    renderChip({ canManage: false });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/755\.16/)).toBeInTheDocument();
  });

  it("keeps the non-link chip focusable so the date tooltip opens on focus (R6)", async () => {
    const user = userEvent.setup();
    renderChip({ canManage: false });
    await user.tab();
    expect(screen.getByText(/755\.16/).closest("[tabindex]")).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("As of");
  });

  it("shows the missing-rate tooltip when there is no rate at all", async () => {
    const user = userEvent.setup();
    renderChip({ canManage: false, rate: null, missing: true });
    await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(enShell.rateChip.missing);
  });
});
