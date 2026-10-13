import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import enActivity from "@/i18n/messages/en/activity.json";
import enEnums from "@/i18n/messages/en/enums.json";
import esActivity from "@/i18n/messages/es/activity.json";
import esEnums from "@/i18n/messages/es/enums.json";
import { ActivityDiff, enumNameFor } from "./activity-diff";

function wrap(ui: React.ReactNode, locale: "es" | "en" = "es") {
  const messages =
    locale === "es"
      ? { activity: esActivity, enums: esEnums }
      : { activity: enActivity, enums: enEnums };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ActivityDiff", () => {
  it("renders an enum change as labels, with the before struck through", () => {
    const { container } = wrap(
      <ActivityDiff entityType="INVOICE" changes={{ status: ["EMITIDA", "PAGADA"] }} />,
    );
    const before = container.querySelector("s");
    expect(before).toHaveTextContent("Emitida");
    expect(screen.getByText("Estado")).toBeInTheDocument();
    expect(screen.getByText("Pagada")).toBeInTheDocument();
  });

  it("shows a money string verbatim, never locale-formatted (C15)", () => {
    wrap(<ActivityDiff entityType="PAYMENT" changes={{ amount: ["1350.00", "1500.50"] }} />);
    expect(screen.getByText("1350.00")).toBeInTheDocument();
    expect(screen.getByText("1500.50")).toBeInTheDocument();
  });

  it('shows the "changed" marker as text for a long text, and no values', () => {
    wrap(<ActivityDiff entityType="PROJECT" changes={{ description: "changed" }} />);
    expect(screen.getByText("Descripción")).toBeInTheDocument();
    expect(screen.getByText("Contenido modificado")).toBeInTheDocument();
  });

  it("labels booleans, nulls and plain text, and falls back to the raw field name", () => {
    wrap(
      <ActivityDiff
        entityType="CLIENT"
        changes={{ tradeName: [null, "Kairos"], x_custom: [true, false] }}
      />,
    );
    expect(screen.getByText("Kairos")).toBeInTheDocument();
    expect(screen.getByText("Sí")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
    expect(screen.getByText("—", { exact: false, selector: "s" })).toBeInTheDocument();
    expect(screen.getByText("x_custom")).toBeInTheDocument();
  });

  it("renders the same diff in EN", () => {
    const { container } = wrap(
      <ActivityDiff entityType="CLIENT" changes={{ status: ["PROSPECTO", "ACTIVO"] }} />,
      "en",
    );
    expect(container.querySelector("s")).toHaveTextContent("Prospect");
    expect(within(container).getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
  });

  it("maps fields to their enum by record type", () => {
    expect(enumNameFor("CLIENT", "status")).toBe("ClientStatus");
    expect(enumNameFor("PROJECT", "status")).toBe("ProjectStatus");
    expect(enumNameFor("DOCUMENT", "format")).toBe("DocumentFormat");
    expect(enumNameFor("NOTE", "status")).toBeNull();
  });

  it("labels a technology category from enums.TechCategory", () => {
    expect(enumNameFor("SETTING", "category")).toBe("TechCategory");
    wrap(
      <ActivityDiff entityType="SETTING" changes={{ category: ["FRONTEND", "BASE_DE_DATOS"] }} />,
    );
    expect(screen.getByText("Categoría")).toBeInTheDocument();
    expect(screen.getByText("Base de datos")).toBeInTheDocument();
  });

  it.each(["es", "en"] as const)("labels every field the W2 services log (%s)", (locale) => {
    const fields = locale === "es" ? esActivity.fields : enActivity.fields;
    for (const field of LOGGED_FIELDS) {
      expect(fields, `unlabelled field: ${field}`).toHaveProperty(field);
    }
  });
});

/** Every field key the W2 services (clients, contacts, projects, notes, tags, technologies) put in `changes`. */
const LOGGED_FIELDS = [
  "kind",
  "tradeName",
  "legalName",
  "taxId",
  "country",
  "address",
  "phone",
  "email",
  "website",
  "tagIds",
  "fullName",
  "position",
  "isPrimary",
  "name",
  "summary",
  "description",
  "startDate",
  "targetEndDate",
  "endDate",
  "technologyIds",
  "status",
  "title",
  "content",
  "pinned",
  "nameEn",
  "slug",
  "category",
  "iconSlug",
  "color",
  "active",
  "technology",
  "clientRole",
  "links",
];
