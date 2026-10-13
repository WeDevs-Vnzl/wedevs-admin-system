import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import enPatterns from "@/i18n/messages/en/patterns.json";
import esPatterns from "@/i18n/messages/es/patterns.json";
import { ArchivedBanner } from "./archived-banner";

function wrap(ui: React.ReactNode, locale: "es" | "en" = "es") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ patterns: locale === "es" ? esPatterns : enPatterns }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ArchivedBanner", () => {
  it("announces the archived state as a status with the ES title and description", () => {
    wrap(<ArchivedBanner />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(esPatterns.archived.title);
    expect(status).toHaveTextContent(esPatterns.archived.description);
  });

  it("renders the EN copy under the en locale", () => {
    wrap(<ArchivedBanner onRestore={() => {}} />, "en");

    expect(screen.getByRole("status")).toHaveTextContent("Archived record");
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
  });

  it("hides the restore button when the caller does not pass a handler (non-Owner/Admin roles)", () => {
    wrap(<ArchivedBanner />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("calls the restore handler from the button named with the ES label", async () => {
    const onRestore = vi.fn();
    wrap(<ArchivedBanner onRestore={onRestore} />);

    await userEvent.click(screen.getByRole("button", { name: esPatterns.archived.restore }));

    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("disables the restore button while a restore is pending", () => {
    wrap(<ArchivedBanner onRestore={() => {}} pending />);
    expect(screen.getByRole("button", { name: esPatterns.archived.restore })).toBeDisabled();
  });
});
