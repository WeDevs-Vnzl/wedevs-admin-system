import { describe, expect, it } from "vitest";
import { noteFilterSchema } from "@/lib/validators/notes";
import { toNoteListQuery } from "./api-query";

const parse = (input: unknown) => noteFilterSchema.parse(input);

describe("toNoteListQuery", () => {
  it("maps the defaults to page, pageSize and archived=exclude", () => {
    expect(toNoteListQuery(parse({}))).toEqual({ page: 1, pageSize: 25, archived: "exclude" });
  });

  it("maps the feed of one record, the facets and the dates to flat keys", () => {
    const query = toNoteListQuery(
      parse({
        entityType: "PROJECT",
        entityId: "pry_1",
        authorId: ["usr_1", "usr_2"],
        tagId: "tag_1",
        linkedEntityType: "CLIENT",
        pinned: true,
        createdFrom: "2026-01-01",
        createdTo: "2026-02-01",
        q: "alcance",
        sort: "pinned:desc",
        pageSize: 50,
      }),
    );
    expect(query).toEqual({
      page: 1,
      pageSize: 50,
      archived: "exclude",
      q: "alcance",
      sort: "pinned:desc",
      entityType: "PROJECT",
      entityId: "pry_1",
      authorId: ["usr_1", "usr_2"],
      tagId: ["tag_1"],
      linkedEntityType: ["CLIENT"],
      pinned: "true",
      createdFrom: "2026-01-01",
      createdTo: "2026-02-01",
    });
  });

  it("asks for archived notes only when the filter includes them", () => {
    expect(toNoteListQuery(parse({ includeArchived: true })).archived).toBe("include");
  });
});
