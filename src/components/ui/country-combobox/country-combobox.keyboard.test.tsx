import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, describe, expect, it, vi } from "vitest";
import enForms from "@/i18n/messages/en/forms.json";
import esForms from "@/i18n/messages/es/forms.json";
import { CountryCombobox } from "./country-combobox";

beforeAll(() => {
  // cmdk and Radix popper need these in jsdom.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
});

function renderIntl(ui: React.ReactNode, locale: "es" | "en" = "es") {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ forms: locale === "es" ? esForms : enForms }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

// The open search input is also role=combobox, so the trigger is found by its slot.
function triggerOf() {
  const trigger = document.querySelector<HTMLElement>("[data-slot=country-combobox]");
  if (!trigger) throw new Error("country combobox trigger not rendered");
  return trigger;
}

describe("CountryCombobox keyboard", () => {
  it("opens from the trigger with Enter", async () => {
    const user = userEvent.setup();
    renderIntl(<CountryCombobox value="" onChange={() => {}} />);

    const trigger = triggerOf();
    trigger.focus();
    await user.keyboard("{Enter}");

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByPlaceholderText("Buscar país…")).toHaveFocus();
  });

  // Known gap: the trigger is a plain Radix Popover trigger, which opens on click and Enter/Space
  // only. The WAI-ARIA combobox pattern expects ArrowDown to open it too. Kept as it.fails so the
  // gap is visible in the run; flip to `it` once the component handles ArrowDown.
  it.fails("opens from the trigger with ArrowDown (WAI-ARIA combobox; source gap)", async () => {
    const user = userEvent.setup();
    renderIntl(<CountryCombobox value="" onChange={() => {}} />);

    triggerOf().focus();
    await user.keyboard("{ArrowDown}");

    expect(triggerOf()).toHaveAttribute("aria-expanded", "true");
  });

  it("filters the list as the user types and selects the first match with Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderIntl(<CountryCombobox value="" onChange={onChange} />);

    triggerOf().focus();
    await user.keyboard("{Enter}");
    await user.keyboard("espa");

    expect(await screen.findByRole("option", { name: /España/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Venezuela/ })).not.toBeInTheDocument();

    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith("ES");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("moves the highlight with ArrowDown before selecting with Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderIntl(<CountryCombobox value="" onChange={onChange} />);

    triggerOf().focus();
    await user.keyboard("{Enter}");
    await user.keyboard("venez");
    await waitFor(() => expect(screen.getByRole("option", { name: /Venezuela/ })).toBeInTheDocument());
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("VE");
  });

  it("closes on Escape and returns focus to the trigger without selecting", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderIntl(<CountryCombobox value="" onChange={onChange} />);

    triggerOf().focus();
    await user.keyboard("{Enter}");
    expect(screen.getByPlaceholderText("Buscar país…")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByPlaceholderText("Buscar país…")).not.toBeInTheDocument());
    expect(triggerOf()).toHaveFocus();
    expect(triggerOf()).toHaveAttribute("aria-expanded", "false");
    expect(onChange).not.toHaveBeenCalled();
  });
});
