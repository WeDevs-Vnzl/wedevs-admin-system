import { describe, expect, it } from "vitest";
import { listQuerySchema } from "@/lib/validators/common";
import { noteFilterFromUrlState, toNoteFilter } from "./note-table-query";

const base = listQuerySchema.parse({});

describe("toNoteFilter", () => {
  it("maps the facets to the list filter the service reads (the export source's ids)", () => {
    const filter = toNoteFilter({
      ...base,
      q: "contrato",
      filters: {
        authorId: "usr_andres_molina",
        tagId: ["tag_vip", "tag_urgente"],
        linkedEntityType: "CLIENT",
        createdAt: ["2026-01-01", "2026-02-28"],
      },
    });
    expect(filter).toMatchObject({
      q: "contrato",
      authorId: "usr_andres_molina",
      tagId: ["tag_vip", "tag_urgente"],
      linkedEntityType: "CLIENT",
      createdFrom: "2026-01-01",
      createdTo: "2026-02-28",
    });
  });

  it("leaves out an empty date range side and keeps the other one", () => {
    const filter = toNoteFilter({ ...base, filters: { createdAt: ["", "2026-03-01"] } });
    expect(filter).toMatchObject({ createdTo: "2026-03-01" });
    expect(filter).not.toHaveProperty("createdFrom");
  });

  it("falls back to the default list when a facet value is not a note filter", () => {
    expect(toNoteFilter({ ...base, filters: { linkedEntityType: "NOT_A_TYPE" } })).toEqual({});
  });
});

describe("noteFilterFromUrlState", () => {
  it("reads the first server page from the URL state, dropping an unknown page size and sort", () => {
    const filter = noteFilterFromUrlState({
      page: 2,
      pageSize: 7,
      sort: "nonsense",
      q: "acta",
      filters: { linkedEntityType: ["PROJECT"] },
    });
    expect(filter).toMatchObject({ page: 2, q: "acta", linkedEntityType: "PROJECT" });
    expect(filter.pageSize).toBe(25);
    expect(filter.sort).toBeUndefined();
  });
});
