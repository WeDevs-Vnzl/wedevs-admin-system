import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);

import type { UserRole } from "@/lib/validators/enums";
import { makeSessionUser } from "@/mocks/test-helpers";
import { getProject, getProjectsOverview, listProjects } from "./queries";

const as = (role: UserRole) => session.getMockSessionUser.mockResolvedValue(makeSessionUser(role));

beforeEach(() => session.getMockSessionUser.mockReset());
afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("projects queries", () => {
  it("lists with the default filter and parses a raw one", async () => {
    as("VIEWER");
    const page = await listProjects();
    expect(page.items.length).toBeGreaterThan(0);
    const filtered = await listProjects({ technologyId: "tec_next_js", status: "EN_CURSO" });
    expect(filtered.items.every((p) => p.status === "EN_CURSO")).toBe(true);
    expect(filtered.items.every((p) => p.stack.some((t) => t.id === "tec_next_js"))).toBe(true);
  });

  it("returns a project, and NOT_FOUND lets the page call notFound()", async () => {
    as("MEMBER");
    expect(await getProject("pry_kairos_web")).toMatchObject({ code: "PRY-0001" });
    await expect(getProject("pry_nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns the overview", async () => {
    as("OWNER");
    const overview = await getProjectsOverview();
    expect(overview.countByStatus.EN_CURSO).toBeGreaterThan(0);
  });
});
