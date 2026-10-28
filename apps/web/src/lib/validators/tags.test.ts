import type { TagsService } from "./tags";
import { describe, expect, it } from "vitest";
import { z } from "./zod";
import { VALIDATION_MESSAGES } from "./common";
import {
  TAGGABLE_ENTITY_TYPE_VALUES,
  assignTagsInputSchema,
  bulkIdsSchema,
  createTagInputSchema,
  facetOf,
  hexColorSchema,
  httpUrlSchema,
  isHttpUrl,
  optionalEmailSchema,
  optionalHttpUrlSchema,
  optionalText,
  sortsBy,
  tagFilterSchema,
  tagListRowSchema,
  timestampSchema,
  unassignTagInputSchema,
  uniqueIds,
  updateTagInputSchema,
  withSortFields,
} from "./tags";

const messages = (result: { error?: { issues: { message: string; path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((i) => `${i.path.join(".")}:${i.message}`);

describe("shared primitives", () => {
  it("timestampSchema accepts ISO UTC and rejects other shapes", () => {
    expect(timestampSchema.safeParse("2026-10-09T14:30:00.000Z").success).toBe(true);
    expect(timestampSchema.safeParse("2026-10-09").success).toBe(false);
    expect(timestampSchema.safeParse("2026-10-09T14:30:00+02:00").success).toBe(false);
  });

  it("optionalText trims, bounds and turns empty into undefined", () => {
    const schema = z.object({ note: optionalText(5) });
    expect(schema.parse({ note: "  hi " })).toEqual({ note: "hi" });
    expect(schema.parse({ note: "   " })).toEqual({ note: undefined });
    expect(schema.parse({})).toEqual({});
    expect(schema.safeParse({ note: "toolong" }).success).toBe(false);
  });

  it("optionalEmailSchema accepts empty or a real e-mail", () => {
    const schema = z.object({ email: optionalEmailSchema });
    expect(schema.parse({ email: "" })).toEqual({ email: undefined });
    expect(schema.parse({ email: " ana@example.com " })).toEqual({ email: "ana@example.com" });
    expect(messages(schema.safeParse({ email: "nope" }))).toEqual([
      `email:${VALIDATION_MESSAGES.invalidEmail}`,
    ]);
  });

  it("http(s) URLs only: javascript:, data: and file: are rejected (C4)", () => {
    expect(isHttpUrl("https://example.com/path?q=1")).toBe(true);
    expect(isHttpUrl("http://localhost:3000")).toBe(true);
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "file:///etc/passwd",
      "ftp://example.com",
      "example.com",
      "",
      `https://example.com/${"a".repeat(2100)}`,
    ]) {
      expect(isHttpUrl(bad), bad).toBe(false);
      expect(httpUrlSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(optionalHttpUrlSchema.parse("")).toBeUndefined();
    expect(optionalHttpUrlSchema.safeParse("javascript:1").success).toBe(false);
  });

  it("hexColorSchema accepts #RRGGBB only", () => {
    expect(hexColorSchema.safeParse("#1A2b3C").success).toBe(true);
    for (const bad of ["1A2B3C", "#123", "#GGGGGG", "red"]) {
      expect(hexColorSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("uniqueIds enforces bounds and no repeats", () => {
    const schema = uniqueIds({ min: 1, max: 2 });
    expect(schema.safeParse(["a"]).success).toBe(true);
    expect(schema.safeParse([]).success).toBe(false);
    expect(schema.safeParse(["a", "b", "c"]).success).toBe(false);
    expect(schema.safeParse(["a", "a"]).success).toBe(false);
    expect(schema.safeParse(["bad id"]).success).toBe(false);
  });

  it("bulkIdsSchema requires at least one id", () => {
    expect(bulkIdsSchema.safeParse(["a", "b"]).success).toBe(true);
    expect(bulkIdsSchema.safeParse([]).success).toBe(false);
  });

  it("facetOf normalizes a single value or a list, keeps undefined", () => {
    const schema = z.object({ status: facetOf(z.enum(["A", "B"])) });
    expect(schema.parse({ status: "A" })).toEqual({ status: ["A"] });
    expect(schema.parse({ status: ["A", "B"] })).toEqual({ status: ["A", "B"] });
    expect(schema.parse({})).toEqual({ status: undefined });
    expect(schema.safeParse({ status: "C" }).success).toBe(false);
  });

  it("sortsBy / withSortFields whitelist the sort field", () => {
    expect(sortsBy(undefined, ["name"])).toBe(true);
    expect(sortsBy("name:asc", ["name"])).toBe(true);
    expect(sortsBy("secret:asc", ["name"])).toBe(false);
    const schema = withSortFields(z.object({ sort: z.string().optional() }), ["name"]);
    expect(schema.safeParse({ sort: "name:desc" }).success).toBe(true);
    expect(messages(schema.safeParse({ sort: "other:desc" }))).toEqual([
      `sort:${VALIDATION_MESSAGES.invalidSort}`,
    ]);
  });
});

describe("tags", () => {
  it("lists exactly the taggable entities of PRD §7.5", () => {
    expect([...TAGGABLE_ENTITY_TYPE_VALUES]).toEqual([
      "CLIENT",
      "CONTACT",
      "PROJECT",
      "INVOICE",
      "PAYMENT",
      "EXPENSE",
      "DOCUMENT",
      "NOTE",
    ]);
  });

  it("createTag accepts name + colour and rejects blank names or bad colours", () => {
    expect(createTagInputSchema.parse({ name: " Prioritario ", color: "#FF8800" })).toEqual({
      name: "Prioritario",
      color: "#FF8800",
    });
    expect(createTagInputSchema.safeParse({ name: "  ", color: "#FF8800" }).success).toBe(false);
    expect(createTagInputSchema.safeParse({ name: "x".repeat(41), color: "#FF8800" }).success).toBe(
      false,
    );
    expect(createTagInputSchema.safeParse({ name: "ok", color: "orange" }).success).toBe(false);
  });

  it("updateTag takes an id and optional fields", () => {
    expect(updateTagInputSchema.safeParse({ id: "tag_1", color: "#000000" }).success).toBe(true);
    expect(updateTagInputSchema.safeParse({ name: "x" }).success).toBe(false);
  });

  it("assignTags needs a taggable entity and at least one distinct tag", () => {
    const ok = { entityType: "CLIENT", entityId: "cli_1", tagIds: ["t1", "t2"] };
    expect(assignTagsInputSchema.safeParse(ok).success).toBe(true);
    expect(assignTagsInputSchema.safeParse({ ...ok, tagIds: [] }).success).toBe(false);
    expect(assignTagsInputSchema.safeParse({ ...ok, tagIds: ["t1", "t1"] }).success).toBe(false);
    expect(assignTagsInputSchema.safeParse({ ...ok, entityType: "ACCOUNT" }).success).toBe(false);
    expect(
      unassignTagInputSchema.safeParse({ entityType: "NOTE", entityId: "n1", tagId: "t1" }).success,
    ).toBe(true);
  });

  it("tagFilterSchema extends the list query and whitelists sorting", () => {
    const parsed = tagFilterSchema.parse({ entityType: "CLIENT", sort: "usageCount:desc" });
    expect(parsed.page).toBe(1);
    expect(parsed.entityType).toEqual(["CLIENT"]);
    expect(tagFilterSchema.safeParse({ sort: "color:asc" }).success).toBe(false);
  });

  it("tagListRowSchema carries the usage count", () => {
    expect(
      tagListRowSchema.safeParse({
        id: "t1",
        name: "VIP",
        color: "#00FF00",
        usageCount: 3,
        createdAt: "2026-10-01T10:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});

describe("TagsService (PRD §12 service names)", () => {
  it("declares every service of the module with its exact name", () => {
    const names = [
      "createTag",
      "updateTag",
      "assignTags",
      "unassignTag",
    ] as const satisfies readonly (keyof TagsService)[];
    expect(new Set(names).size).toBe(names.length);
  });
});
