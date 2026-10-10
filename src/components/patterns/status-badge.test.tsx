import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import enums from "@/i18n/messages/en/enums.json";
import patterns from "@/i18n/messages/en/patterns.json";
import { ENUM_REGISTRY, type EnumName } from "@/lib/validators/enums";
import { STATUS_TONES, StatusBadge } from "./status-badge";

function renderBadge(enumName: EnumName, value: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ enums, patterns }}>
      {/* Typed per enum at the call site; this helper only erases the union for iteration. */}
      <StatusBadge enumName={enumName} value={value as never} />
    </NextIntlClientProvider>,
  );
}

describe("StatusBadge", () => {
  const cases = (Object.entries(ENUM_REGISTRY) as [EnumName, readonly string[]][]).flatMap(
    ([enumName, values]) => values.map((value) => [enumName, value] as const),
  );

  it.each(cases)("renders %s.%s with its enums label and a tone", (enumName, value) => {
    const tones = STATUS_TONES[enumName] as Record<string, string>;
    expect(tones[value]).toBeDefined();

    renderBadge(enumName, value);
    const labels = enums[enumName] as Record<string, string>;
    expect(screen.getByText(labels[value]!)).toBeInTheDocument();
  });

  it("covers every enum value of the registry", () => {
    expect(cases.length).toBeGreaterThan(0);
    for (const [enumName, value] of cases) {
      expect(STATUS_TONES[enumName]).toHaveProperty([value]);
    }
  });

  it("adds the secondary 'Pago parcial' indicator for partial values only", () => {
    const { unmount } = renderBadge("InvoiceStatus", "PARCIAL");
    expect(screen.getByText(patterns.statusBadge.partial)).toBeInTheDocument();
    unmount();

    renderBadge("InvoiceStatus", "EMITIDA");
    expect(screen.queryByText(patterns.statusBadge.partial)).not.toBeInTheDocument();
  });
});
