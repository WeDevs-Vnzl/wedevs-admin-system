import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, describe, expect, it } from "vitest";
import enPatterns from "@/i18n/messages/en/patterns.json";
import { FieldInfo, OptionalMark } from "./field-hint";

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ patterns: enPatterns }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FieldInfo", () => {
  beforeAll(() => {
    // Radix measures the tooltip with ResizeObserver, which jsdom does not provide.
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  it("is a button named after its field that shows the explanation on focus", async () => {
    wrap(<FieldInfo field="Legal name">Registered legal name.</FieldInfo>);

    const trigger = screen.getByRole("button", { name: "More about Legal name" });
    expect(trigger).toHaveAttribute("type", "button");
    await userEvent.tab();
    expect(trigger).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Registered legal name.");
  });
});

describe("OptionalMark", () => {
  it("shows the optional text without changing the label's accessible name", () => {
    wrap(
      <>
        <label htmlFor="email">
          Email <OptionalMark />
        </label>
        <input id="email" />
      </>,
    );

    expect(screen.getByText("(optional)")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("textbox", { name: "Email" })).toBeInTheDocument();
  });
});
