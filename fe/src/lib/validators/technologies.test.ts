import { describe, expect, it } from "vitest";
import {
  createTechnologyInputSchema,
  deleteTechnologyInputSchema,
  setTechnologyActiveInputSchema,
  technologyChipSchema,
  technologyFilterSchema,
  technologyListRowSchema,
  updateTechnologyInputSchema,
} from "./technologies";

describe("technologies", () => {
  const valid = { name: "Next.js", category: "FRONTEND" };

  it("accepts name + category with optional nameEn/slug/icon/colour and defaults to active", () => {
    const parsed = createTechnologyInputSchema.parse(valid);
    expect(parsed.active).toBe(true);
    expect(
      createTechnologyInputSchema.safeParse({
        ...valid,
        nameEn: "Next.js",
        slug: "next-js",
        iconSlug: "nextdotjs",
        color: "#000000",
      }).success,
    ).toBe(true);
  });

  it("rejects blank names, unknown categories, bad slugs, icon slugs and colours", () => {
    expect(createTechnologyInputSchema.safeParse({ ...valid, name: " " }).success).toBe(false);
    expect(createTechnologyInputSchema.safeParse({ ...valid, category: "FRAMEWORK" }).success).toBe(
      false,
    );
    expect(createTechnologyInputSchema.safeParse({ ...valid, slug: "Next JS" }).success).toBe(
      false,
    );
    expect(createTechnologyInputSchema.safeParse({ ...valid, iconSlug: "Next.js" }).success).toBe(
      false,
    );
    expect(createTechnologyInputSchema.safeParse({ ...valid, color: "black" }).success).toBe(false);
    expect(createTechnologyInputSchema.safeParse({ category: "FRONTEND" }).success).toBe(false);
  });

  it("update / activate / delete inputs", () => {
    expect(updateTechnologyInputSchema.safeParse({ id: "tech_1", ...valid }).success).toBe(true);
    expect(updateTechnologyInputSchema.safeParse(valid).success).toBe(false);
    expect(setTechnologyActiveInputSchema.safeParse({ id: "tech_1", active: false }).success).toBe(
      true,
    );
    expect(setTechnologyActiveInputSchema.safeParse({ id: "tech_1" }).success).toBe(false);
    expect(deleteTechnologyInputSchema.safeParse({ id: "tech_1" }).success).toBe(true);
  });

  it("filters by category and active, whitelisting the sort", () => {
    const parsed = technologyFilterSchema.parse({
      category: "BACKEND",
      active: "false",
      sort: "usageCount:desc",
    });
    expect(parsed.category).toEqual(["BACKEND"]);
    expect(parsed.active).toBe(false);
    expect(technologyFilterSchema.safeParse({ sort: "color:asc" }).success).toBe(false);
  });

  it("chip and row DTOs", () => {
    const chip = {
      id: "tech_1",
      name: "Next.js",
      nameEn: null,
      slug: "next-js",
      category: "FRONTEND",
      iconSlug: "nextdotjs",
      color: null,
    };
    expect(technologyChipSchema.safeParse(chip).success).toBe(true);
    expect(
      technologyListRowSchema.safeParse({ ...chip, active: true, usageCount: 4 }).success,
    ).toBe(true);
    expect(
      technologyListRowSchema.safeParse({ ...chip, active: true, usageCount: -1 }).success,
    ).toBe(false);
  });
});
