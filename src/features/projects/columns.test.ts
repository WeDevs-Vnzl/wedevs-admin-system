import { describe, expect, it } from "vitest";
import { PROJECT_SORT_FIELDS, projectFilterSchema } from "@/lib/validators/projects";
import { toModuleQuery } from "@/lib/table-query";
import { listQuerySchema } from "@/lib/validators/common";
import enMessages from "@/i18n/messages/en/projects.json";
import esMessages from "@/i18n/messages/es/projects.json";
import {
  PROJECT_COLUMNS,
  PROJECT_COLUMN_IDS,
  PROJECT_EXPORT_COLUMNS,
  PROJECT_FACETS,
  PROJECT_MONEY_COLUMN_IDS,
} from "./columns";

describe("projects columns", () => {
  it("lists the columns of PRD §8.3 in order", () => {
    expect(PROJECT_COLUMN_IDS).toEqual([
      "code",
      "name",
      "clients",
      "status",
      "startDate",
      "targetEndDate",
      "stack",
      "contractedValueUsd",
      "invoicedUsd",
      "collectedUsd",
      "toInvoiceUsd",
      "tags",
    ]);
    expect(PROJECT_COLUMNS.map((column) => column.id)).toEqual([...PROJECT_COLUMN_IDS]);
  });

  it("flags the four USD columns as money", () => {
    expect(PROJECT_COLUMNS.filter((column) => column.money).map((column) => column.id)).toEqual([
      ...PROJECT_MONEY_COLUMN_IDS,
    ]);
    for (const id of PROJECT_MONEY_COLUMN_IDS)
      expect(PROJECT_EXPORT_COLUMNS[id].type).toBe("money");
  });

  it("marks as sortable exactly the columns the filter schema can sort by", () => {
    const sortable = PROJECT_COLUMNS.filter((column) => column.sortable).map((column) => column.id);
    for (const id of sortable) expect(PROJECT_SORT_FIELDS).toContain(id);
    for (const field of PROJECT_SORT_FIELDS.filter((f) => f !== "createdAt")) {
      expect(sortable).toContain(field);
    }
  });

  it("has a label key under columns.* in ES and EN for every column", () => {
    for (const column of PROJECT_COLUMNS) {
      expect(column.labelKey).toBe(`columns.${column.id}`);
      expect(PROJECT_EXPORT_COLUMNS[column.id].labelKey).toBe(column.labelKey);
      expect(esMessages.columns[column.id]).toBeTypeOf("string");
      expect(enMessages.columns[column.id]).toBeTypeOf("string");
    }
  });

  it("declares facets that flatten into projectFilterSchema", () => {
    const query = listQuerySchema.parse({
      filters: {
        status: ["EN_CURSO"],
        clientId: ["cli_kairos"],
        technologyId: ["tec_next_js", "tec_react"],
        tagId: ["tag_urgente"],
        delivery: ["2026-10-01", "2026-10-31"],
        withoutBillingPlan: ["true"],
      },
    });
    const parsed = projectFilterSchema.parse(toModuleQuery(query, PROJECT_FACETS));
    expect(parsed).toMatchObject({
      status: ["EN_CURSO"],
      clientId: ["cli_kairos"],
      technologyId: ["tec_next_js", "tec_react"],
      tagId: ["tag_urgente"],
      deliveryFrom: "2026-10-01",
      deliveryTo: "2026-10-31",
      withoutBillingPlan: true,
    });
    expect(PROJECT_FACETS.find((facet) => facet.id === "technologyId")).toBeDefined();
  });

  it("reads each export cell from a list row", () => {
    const row = {
      id: "pry_1",
      code: "PRY-0001",
      name: "Sitio",
      clients: [
        { client: { id: "cli_a", label: "Acme", type: "CLIENT" as const }, role: "Contratante" },
        { client: { id: "cli_b", label: "Beta", type: "CLIENT" as const }, role: null },
      ],
      status: "EN_CURSO" as const,
      startDate: "2026-01-01",
      targetEndDate: null,
      stack: [{ name: "Next.js" }, { name: "React" }],
      tags: [{ name: "Urgente" }],
      contractedValueUsd: "10.00",
      invoicedUsd: "1.00",
      collectedUsd: "2.00",
      toInvoiceUsd: "3.00",
      archivedAt: null,
    } as never;
    const cell = (id: (typeof PROJECT_COLUMN_IDS)[number]) => PROJECT_EXPORT_COLUMNS[id].value(row);
    expect(cell("clients")).toBe("Acme (Contratante); Beta");
    expect(cell("stack")).toBe("Next.js; React");
    expect(cell("tags")).toBe("Urgente");
    expect(cell("status")).toBe("EN_CURSO");
    expect(cell("targetEndDate")).toBeNull();
    expect(cell("toInvoiceUsd")).toBe("3.00");
  });
});
