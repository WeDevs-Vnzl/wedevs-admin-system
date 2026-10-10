import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import enShell from "@/i18n/messages/en/shell.json";
import esShell from "@/i18n/messages/es/shell.json";
import { SkipLink } from "./skip-link";

function renderShell(locale: "en" | "es" = "en") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ shell: locale === "en" ? enShell : esShell }}
    >
      <SkipLink targetId="main-content" />
      <button type="button">First control</button>
      <div id="main-content" tabIndex={-1}>
        Page content
      </div>
    </NextIntlClientProvider>,
  );
}

describe("SkipLink", () => {
  it("is the first element Tab reaches and carries the translated label (WCAG 2.4.1)", async () => {
    const user = userEvent.setup();
    renderShell("es");
    await user.tab();
    expect(screen.getByRole("link", { name: esShell.skipLink.label })).toHaveFocus();
  });

  it("moves focus to the content container when activated", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(document.getElementById("main-content")).toHaveFocus();
  });

  it("points at the container so the plain anchor works without JavaScript", () => {
    renderShell();
    expect(screen.getByRole("link", { name: enShell.skipLink.label })).toHaveAttribute(
      "href",
      "#main-content",
    );
  });
});
