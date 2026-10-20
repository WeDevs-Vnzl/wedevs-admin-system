import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, describe, expect, it, vi } from "vitest";
import enForms from "@/i18n/messages/en/forms.json";
import esForms from "@/i18n/messages/es/forms.json";
import { DateField } from "./date-field";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function Harness({
  initial = "",
  locale = "es",
  onChange,
}: {
  initial?: string;
  locale?: "es" | "en";
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <NextIntlClientProvider locale={locale} messages={{ forms: locale === "es" ? esForms : enForms }}>
      <DateField
        aria-label="Fecha"
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
    </NextIntlClientProvider>
  );
}

// Radix focuses the calendar's prev/next controls on open; the arrow keys only move between days
// once the roving day cell (tabindex 0) has focus.
async function openOnDay(user: ReturnType<typeof userEvent.setup>) {
  screen.getByRole("button", { name: "Fecha" }).focus();
  await user.keyboard("{Enter}");
  await screen.findByRole("grid");
  const day = document.querySelector<HTMLElement>('[role="grid"] button[tabindex="0"]');
  if (!day) throw new Error("roving day cell not rendered");
  day.focus();
  return day;
}

describe("DateField keyboard", () => {
  it("opens the calendar from the trigger with Enter", async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-10-10" />);

    screen.getByRole("button", { name: "Fecha" }).focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("grid")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fecha" })).toHaveAttribute("aria-expanded", "true");
  });

  it("moves the focused day with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-10-10" />);

    await openOnDay(user);
    await user.keyboard("{ArrowRight}");

    expect(document.activeElement).toHaveTextContent(/^11$/);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveTextContent(/^18$/);
  });

  it("selects the focused day with Enter, emits YYYY-MM-DD and closes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="2026-10-10" onChange={onChange} />);

    await openOnDay(user);
    await user.keyboard("{ArrowRight}{Enter}");

    expect(onChange).toHaveBeenCalledWith("2026-10-11");
    await waitFor(() => expect(screen.queryByRole("grid")).not.toBeInTheDocument());
  });

  it("closes on Escape without changing the value and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="2026-10-10" onChange={onChange} />);

    await openOnDay(user);
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("grid")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Fecha" })).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });
});
