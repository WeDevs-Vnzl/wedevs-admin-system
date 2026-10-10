// MOCK — tests for the technology read services.
import { describe, expect, it } from "vitest";
import { technologyFilterSchema } from "@/lib/validators/technologies";
import { makeTestContext } from "../test-helpers";
import { getTechnology, listTechnologies, technologyUsage } from "./technologies";

describe("technologyUsage", () => {
  it("counts non-archived projects that list the technology", () => {
    const { db } = makeTestContext();
    const next = db.technologies.find((t) => t.name === "Next.js")!;
    const projects = db.projects.filter((p) => p.technologyIds.includes(next.id));
    expect(projects.length).toBeGreaterThanOrEqual(2);
    expect(technologyUsage(db, next.id)).toBe(projects.length);

    projects[0]!.archivedAt = "2026-10-01T00:00:00.000Z";
    expect(technologyUsage(db, next.id)).toBe(projects.length - 1);
  });

  it("is zero for a technology no project uses", () => {
    const { db } = makeTestContext();
    expect(technologyUsage(db, "tec_rust")).toBe(0);
  });
});

describe("listTechnologies", () => {
  it("returns the usage of each technology and filters by it through sorting", async () => {
    const { ctx } = makeTestContext();
    const page = await listTechnologies(
      ctx,
      technologyFilterSchema.parse({ sort: "usageCount:desc", pageSize: 100 }),
    );
    expect(page.items[0]!.usageCount).toBeGreaterThanOrEqual(page.items[1]!.usageCount);
    expect(page.items.find((t) => t.name === "Next.js")!.usageCount).toBeGreaterThanOrEqual(2);
    expect(page.items.find((t) => t.name === "Rust")!.usageCount).toBe(0);
  });

  it("filters by category, active facet and text", async () => {
    const { ctx, db } = makeTestContext();
    db.technologies.find((t) => t.name === "Rust")!.active = false;
    const inactive = await listTechnologies(ctx, technologyFilterSchema.parse({ active: "false" }));
    expect(inactive.items.map((t) => t.name)).toEqual(["Rust"]);
    const found = await listTechnologies(ctx, technologyFilterSchema.parse({ q: "next" }));
    expect(found.items.map((t) => t.name)).toContain("Next.js");
    const ia = await listTechnologies(
      ctx,
      technologyFilterSchema.parse({ category: "IA", pageSize: 100 }),
    );
    expect(ia.items.every((t) => t.category === "IA")).toBe(true);
  });
});

describe("getTechnology", () => {
  it("returns one technology with its usage count", async () => {
    const { ctx, db } = makeTestContext();
    const dto = await getTechnology(ctx, { id: "tec_next_js" });
    expect(dto).toMatchObject({ id: "tec_next_js", name: "Next.js", active: true });
    expect(dto.usageCount).toBe(technologyUsage(db, "tec_next_js"));
  });

  it("answers NOT_FOUND for an unknown id", async () => {
    const { ctx } = makeTestContext();
    await expect(getTechnology(ctx, { id: "tec_missing" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
