import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import enEnums from "@/i18n/messages/en/enums.json";
import enForms from "@/i18n/messages/en/forms.json";
import esEnums from "@/i18n/messages/es/enums.json";
import esForms from "@/i18n/messages/es/forms.json";
import { RateInput, type RateLookup, type RateLookupResult } from "./rate-input";

function renderIntl(ui: React.ReactNode, locale: "es" | "en" = "es") {
  const messages =
    locale === "es" ? { forms: esForms, enums: esEnums } : { forms: enForms, enums: enEnums };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function Harness({
  lookupRate,
  currency = "VES",
  date = "2026-03-15",
  initial = "",
  referenceRate,
  prefillOnMount,
  onChange,
}: {
  lookupRate: RateLookup;
  currency?: string;
  date?: string;
  initial?: string;
  referenceRate?: string | null;
  prefillOnMount?: boolean;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <RateInput
      value={value}
      date={date}
      currency={currency}
      lookupRate={lookupRate}
      referenceRate={referenceRate}
      prefillOnMount={prefillOnMount}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

const bcv = { source: "BCV" as const, usdRate: "755.16", createdAt: "2026-03-12T10:00:00Z" };
const other = { source: "OTRA" as const, usdRate: "770.5", createdAt: "2026-03-12T15:00:00Z" };

function result(overrides: Partial<RateLookupResult> = {}): RateLookupResult {
  return {
    usdRate: "755.16",
    isFallback: false,
    effectiveDate: "2026-03-15",
    source: "BCV",
    options: [bcv],
    ...overrides,
  };
}

describe("RateInput", () => {
  it("prefills the looked-up rate for the date and currency", async () => {
    const lookupRate = vi.fn<RateLookup>().mockResolvedValue(result());
    renderIntl(<Harness lookupRate={lookupRate} />);

    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("755,16"));
    expect(lookupRate).toHaveBeenCalledWith("2026-03-15", "VES");
    expect(screen.queryByText(/Usando tasa del/)).not.toBeInTheDocument();
  });

  it("says which date a fallback rate comes from ('Usando tasa del dd/mm')", async () => {
    const lookupRate = vi
      .fn<RateLookup>()
      .mockResolvedValue(result({ isFallback: true, effectiveDate: "2026-03-12" }));
    renderIntl(<Harness lookupRate={lookupRate} />);

    expect(await screen.findByText("Usando tasa del 12/03")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("755,16");
  });

  it("asks for a manual rate when the lookup finds nothing", async () => {
    const onChange = vi.fn();
    renderIntl(<Harness lookupRate={vi.fn<RateLookup>().mockResolvedValue(null)} onChange={onChange} />);

    expect(await screen.findByText(/Ingrésala manualmente/)).toBeInTheDocument();
    const input = screen.getByRole("textbox");
    expect(input).toBeEnabled();

    await userEvent.type(input, "800,5");
    expect(onChange).toHaveBeenLastCalledWith("800.5");
  });

  it("locks USD at 1 and never looks a rate up", async () => {
    const lookupRate = vi.fn<RateLookup>();
    const onChange = vi.fn();
    renderIntl(<Harness lookupRate={lookupRate} currency="USD" initial="755.16" onChange={onChange} />);

    const input = screen.getByRole("textbox");
    expect(input).toBeDisabled();
    await waitFor(() => expect(input).toHaveValue("1"));
    expect(onChange).toHaveBeenCalledWith("1");
    expect(lookupRate).not.toHaveBeenCalled();
  });

  it("shows a source selector with BCV preselected and switches the value", async () => {
    const lookupRate = vi.fn<RateLookup>().mockResolvedValue(result({ options: [bcv, other] }));
    const onChange = vi.fn();
    renderIntl(<Harness lookupRate={lookupRate} onChange={onChange} />, "en");

    const bcvOption = await screen.findByRole("radio", { name: "BCV" });
    const otherOption = screen.getByRole("radio", { name: "Other" });
    expect(bcvOption).toBeChecked();
    expect(otherOption).not.toBeChecked();
    expect(screen.getByRole("textbox")).toHaveValue("755.16");

    await userEvent.click(otherOption);

    expect(onChange).toHaveBeenLastCalledWith("770.5");
    expect(screen.getByRole("textbox")).toHaveValue("770.5");
    expect(screen.getByRole("radio", { name: "Other" })).toBeChecked();
  });

  it("hides the selector with a single option and drops the selection when typing by hand", async () => {
    const single = vi.fn<RateLookup>().mockResolvedValue(result());
    const { unmount } = renderIntl(<Harness lookupRate={single} />, "en");
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("755.16"));
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    unmount();

    const many = vi.fn<RateLookup>().mockResolvedValue(result({ options: [bcv, other] }));
    renderIntl(<Harness lookupRate={many} />, "en");
    await screen.findByRole("radio", { name: "BCV" });
    await userEvent.type(screen.getByRole("textbox"), "1");
    expect(screen.getByRole("radio", { name: "BCV" })).not.toBeChecked();
  });

  it("warns when the rate deviates more than 10 % from the reference", async () => {
    const lookupRate = vi.fn<RateLookup>().mockResolvedValue(result({ usdRate: "100" }));
    renderIntl(<Harness lookupRate={lookupRate} />, "en");

    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("100"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "110");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); // exactly 10 %

    await userEvent.type(input, "1");
    expect(await screen.findByRole("alert")).toHaveTextContent("more than 10%");
  });

  it("compares against an explicit reference rate when given", async () => {
    const lookupRate = vi.fn<RateLookup>().mockResolvedValue(result({ usdRate: "100" }));
    renderIntl(<Harness lookupRate={lookupRate} referenceRate="50" />, "en");
    expect(await screen.findByRole("alert")).toHaveTextContent("(50)");
  });

  it("keeps the stored rate of an edit form when prefillOnMount is false", async () => {
    const lookupRate = vi.fn<RateLookup>().mockResolvedValue(result({ usdRate: "900" }));
    const onChange = vi.fn();
    renderIntl(
      <Harness lookupRate={lookupRate} initial="755.16" prefillOnMount={false} onChange={onChange} />,
      "en",
    );

    await waitFor(() => expect(lookupRate).toHaveBeenCalled());
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("755.16");
  });

  it("re-prefills when the currency or date changes and clears when nothing is found", async () => {
    const lookupRate = vi
      .fn<RateLookup>()
      .mockImplementation(async (_date, currency) => (currency === "VES" ? result() : null));
    const { rerender } = renderIntl(<Harness lookupRate={lookupRate} />, "en");
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("755.16"));

    rerender(
      <NextIntlClientProvider locale="en" messages={{ forms: enForms, enums: enEnums }}>
        <Harness lookupRate={lookupRate} currency="EUR" />
      </NextIntlClientProvider>,
    );
    await waitFor(() => expect(lookupRate).toHaveBeenCalledWith("2026-03-15", "EUR"));
    expect(await screen.findByText(/Enter it manually/)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
});

describe("RateInput deviation warning (locale)", () => {
  it("formats the reference rate for the locale, not the canonical string", async () => {
    const lookupRate = vi.fn<RateLookup>().mockResolvedValue(result({ usdRate: "755.16" }));
    renderIntl(<Harness lookupRate={lookupRate} referenceRate="1234.5" initial="9999" prefillOnMount={false} />, "es");
    expect(await screen.findByRole("alert")).toHaveTextContent("(1.234,5)");
  });

  it("uses English separators in en", async () => {
    const lookupRate = vi.fn<RateLookup>().mockResolvedValue(result({ usdRate: "1234.5" }));
    renderIntl(<Harness lookupRate={lookupRate} referenceRate="1234.5" initial="9999" prefillOnMount={false} />, "en");
    expect(await screen.findByRole("alert")).toHaveTextContent("(1,234.5)");
  });
});
