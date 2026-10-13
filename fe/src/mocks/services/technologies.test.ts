// MOCK — tests for the technology catalog services (reads, writes, lock, activity).
import { describe, expect, it } from "vitest";
import type { TechnologiesService } from "@/lib/validators/technologies";
import { technologyFilterSchema } from "@/lib/validators/technologies";
import type { MockServiceContext } from "../ctx";
import { makeTestContext } from "../test-helpers";
import {
  createTechnology,
  deleteTechnology,
  getTechnology,
  listTechnologies,
  setTechnologyActive,
  technologyUsage,
  updateTechnology,
} from "./technologies";

// Compile-time check: the mock implements the contract (C8, C9).
export const technologiesContract = {
  createTechnology,
  updateTechnology,
  setTechnologyActive,
  deleteTechnology,
  listTechnologies,
  getTechnology,
} satisfies TechnologiesService<MockServiceContext>;

const base = { nameEn: undefined, iconSlug: undefined, color: undefined, active: true };

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

describe("createTechnology", () => {
  it("derives the slug from the name when omitted and logs a SETTINGS_CHANGE", async () => {
    const { ctx, db } = makeTestContext();
    const dto = await createTechnology(ctx, { ...base, name: "Odin Lang", category: "LENGUAJE" });
    expect(dto).toMatchObject({ name: "Odin Lang", slug: "odin-lang", nameEn: null, usageCount: 0 });
    expect(db.technologies.some((t) => t.id === dto.id)).toBe(true);
    const entry = db.activity.at(-1)!;
    expect(entry).toMatchObject({
      action: "SETTINGS_CHANGE",
      entityType: "SETTING",
      entityId: dto.id,
      actorId: ctx.user.id,
    });
  });

  it("answers CONFLICT with the field when the name exists, ignoring case", async () => {
    const { ctx } = makeTestContext();
    await expect(
      createTechnology(ctx, { ...base, name: "next.js", category: "FRONTEND" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      fieldErrors: { name: ["catalogs.technologies.errors.nameTaken"] },
    });
  });

  it("answers CONFLICT when an explicit slug is taken", async () => {
    const { ctx } = makeTestContext();
    await expect(
      createTechnology(ctx, { ...base, name: "Nexty", slug: "next-js", category: "FRONTEND" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      fieldErrors: { slug: ["catalogs.technologies.errors.slugTaken"] },
    });
  });

  it("rejects a derived slug that is empty", async () => {
    const { ctx } = makeTestContext();
    await expect(
      createTechnology(ctx, { ...base, name: "***", category: "OTRO" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("updateTechnology", () => {
  it("keeps its own name and slug, and logs only the changed fields", async () => {
    const { ctx, db } = makeTestContext();
    const next = db.technologies.find((t) => t.id === "tec_next_js")!;
    const dto = await updateTechnology(ctx, {
      ...base,
      id: next.id,
      name: "Next.js",
      nameEn: "Next",
      slug: next.slug,
      category: "FRONTEND",
      iconSlug: next.iconSlug ?? undefined,
    });
    expect(dto).toMatchObject({ nameEn: "Next" });
    expect(db.activity.at(-1)!.changes).toEqual({ nameEn: [null, "Next"] });
  });

  it("answers CONFLICT when another technology has the name", async () => {
    const { ctx } = makeTestContext();
    await expect(
      updateTechnology(ctx, { ...base, id: "tec_rust", name: "React", category: "LENGUAJE" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("answers NOT_FOUND for an unknown id", async () => {
    const { ctx } = makeTestContext();
    await expect(
      updateTechnology(ctx, { ...base, id: "tec_missing", name: "X", category: "OTRO" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("setTechnologyActive", () => {
  it("deactivates and reactivates, logging the change", async () => {
    const { ctx, db } = makeTestContext();
    const off = await setTechnologyActive(ctx, { id: "tec_next_js", active: false });
    expect(off.active).toBe(false);
    expect(db.activity.at(-1)!.changes).toEqual({ active: [true, false] });
    const on = await setTechnologyActive(ctx, { id: "tec_next_js", active: true });
    expect(on.active).toBe(true);
  });
});

describe("deleteTechnology", () => {
  it("locks a technology that a non-archived project uses (HU-06 CA3)", async () => {
    const { ctx, db } = makeTestContext();
    await expect(deleteTechnology(ctx, { id: "tec_next_js" })).rejects.toMatchObject({
      code: "INTEGRITY_LOCK",
      message: "catalogs.technologies.errors.inUse",
    });
    expect(db.technologies.some((t) => t.id === "tec_next_js")).toBe(true);
  });

  it("removes an unused technology and logs it", async () => {
    const { ctx, db } = makeTestContext();
    await expect(deleteTechnology(ctx, { id: "tec_rust" })).resolves.toEqual({ id: "tec_rust" });
    expect(db.technologies.some((t) => t.id === "tec_rust")).toBe(false);
    expect(db.activity.at(-1)).toMatchObject({ action: "SETTINGS_CHANGE", entityId: "tec_rust" });
  });

  it("answers NOT_FOUND for an unknown id", async () => {
    const { ctx } = makeTestContext();
    await expect(deleteTechnology(ctx, { id: "tec_missing" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
