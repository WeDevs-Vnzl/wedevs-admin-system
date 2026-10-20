import { describe, expect, it } from "vitest";
import { CLIENT_SORT_FIELDS } from "@/lib/validators/clients";
import en from "@/i18n/messages/en/clients.json";
import es from "@/i18n/messages/es/clients.json";
import { CLIENT_COLUMNS, CLIENT_COLUMN_IDS, CLIENT_EXPORT_COLUMNS, CLIENT_FACETS } from "./columns";

describe("clients columns", () => {
  it("follows PRD §8.2 'Tabla' order", () => {
    expect(CLIENT_COLUMN_IDS).toEqual([
      "code",
      "tradeName",
      "kind",
      "country",
      "status",
      "projectCount",
      "totalInvoicedUsd",
      "receivableUsd",
      "tags",
      "lastActivityAt",
    ]);
    expect(CLIENT_COLUMNS.map((c) => c.id)).toEqual([...CLIENT_COLUMN_IDS]);
  });

  it("flags the USD columns as money and only sortable columns are sort fields", () => {
    expect(CLIENT_COLUMNS.filter((c) => c.money).map((c) => c.id)).toEqual([
      "totalInvoicedUsd",
      "receivableUsd",
    ]);
    for (const column of CLIENT_COLUMNS) {
      expect((CLIENT_SORT_FIELDS as readonly string[]).includes(column.id)).toBe(column.sortable);
    }
  });

  it("has a label key in both languages for every column, matching the export labelKeys", () => {
    for (const column of CLIENT_COLUMNS) {
      const id = column.id;
      expect(column.labelKey).toBe(`columns.${id}`);
      expect(CLIENT_EXPORT_COLUMNS[id].labelKey).toBe(column.labelKey);
      expect(es.columns[id]).toBeTruthy();
      expect(en.columns[id]).toBeTruthy();
      expect(CLIENT_EXPORT_COLUMNS[id].type === "money").toBe(column.money);
    }
  });

  it("declares the facets that map onto the filter schema", () => {
    expect(CLIENT_FACETS.map((f) => f.id)).toEqual([
      "status",
      "kind",
      "country",
      "tagId",
      "created",
    ]);
  });

  it("reads each cell from the row", () => {
    const row = {
      id: "cli_x",
      code: "CLI-0001",
      tradeName: "X",
      kind: "EMPRESA" as const,
      country: "VE" as const,
      status: "ACTIVO" as const,
      projectCount: 2,
      totalInvoicedUsd: "10.50",
      receivableUsd: "0.00",
      tags: [
        { id: "a", name: "VIP", color: "#112233" },
        { id: "b", name: "Web", color: "#112233" },
      ],
      lastActivityAt: null,
      archivedAt: null,
    };
    expect(CLIENT_EXPORT_COLUMNS.tags.value(row)).toBe("VIP; Web");
    expect(CLIENT_EXPORT_COLUMNS.totalInvoicedUsd.value(row)).toBe("10.50");
    expect(CLIENT_EXPORT_COLUMNS.lastActivityAt.value(row)).toBeNull();
    expect(CLIENT_EXPORT_COLUMNS.projectCount.value(row)).toBe(2);
  });
});
