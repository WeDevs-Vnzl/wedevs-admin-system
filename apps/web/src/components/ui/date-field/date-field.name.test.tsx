import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import enForms from "@/i18n/messages/en/forms.json";
import esForms from "@/i18n/messages/es/forms.json";
import { DateField } from "./date-field";

function renderField(props: Partial<React.ComponentProps<typeof DateField>>, locale: "es" | "en" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ forms: locale === "es" ? esForms : enForms }}>
      <DateField value="" onChange={() => undefined} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("DateField accessible name", () => {
  it("falls back to an i18n name when it has neither aria-label nor id", () => {
    renderField({});
    expect(screen.getByRole("button", { name: "Date" })).toBeInTheDocument();
  });

  it("includes the selected date in the default name", () => {
    renderField({ value: "2026-03-15" }, "es");
    expect(screen.getByRole("button", { name: /^Fecha: 15 mar 2026$/ })).toBeInTheDocument();
  });

  it("leaves the name to the label when there is an id, and honours aria-label", () => {
    const view = renderField({ id: "due" });
    expect(screen.getByRole("button")).not.toHaveAttribute("aria-label");
    view.unmount();
    renderField({ "aria-label": "Due date" });
    expect(screen.getByRole("button", { name: "Due date" })).toBeInTheDocument();
  });
});
