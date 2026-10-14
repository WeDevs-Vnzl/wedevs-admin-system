import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import enDocuments from "@/i18n/messages/en/documents.json";
import esDocuments from "@/i18n/messages/es/documents.json";
import { PrintButton } from "./print-button";
import { PrintRegion } from "./print-region";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PrintButton", () => {
  it("calls window.print with the Spanish label", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(
      <NextIntlClientProvider locale="es" messages={{ documents: esDocuments }}>
        <PrintButton />
      </NextIntlClientProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Imprimir / Guardar como PDF" }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("uses the English label and is excluded from print", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ documents: enDocuments }}>
        <PrintButton />
      </NextIntlClientProvider>,
    );
    const button = screen.getByRole("button", { name: "Print / Save as PDF" });
    expect(button).toHaveAttribute("data-print-hide");
  });
});

describe("PrintRegion", () => {
  it("wraps the content with the WeDevs letterhead shown only in print", () => {
    const { container } = render(
      <NextIntlClientProvider locale="es" messages={{ documents: esDocuments }}>
        <PrintRegion title="Master agreement" subtitle="DOC-0001 · v3">
          <p>Body</p>
        </PrintRegion>
      </NextIntlClientProvider>,
    );
    const region = container.querySelector("[data-print-region]");
    expect(region).not.toBeNull();
    const letterhead = region?.querySelector("[data-print-letterhead]");
    expect(letterhead).not.toBeNull();
    expect(letterhead?.className).toContain("hidden");
    expect(letterhead?.className).toContain("print:flex");
    expect(letterhead?.textContent).toContain("WeDevs");
    expect(letterhead?.textContent).toContain("Master agreement");
    expect(letterhead?.textContent).toContain("DOC-0001 · v3");
    expect(region?.textContent).toContain("Body");
  });
});
