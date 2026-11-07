import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const queries = vi.hoisted(() => ({ getProject: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("./queries", () => queries);

import { ServiceError } from "@/lib/service-error";
import { loadProjectOr404 } from "./load-project";

const project = { id: "pry_1", code: "PRY-0001", name: "Sitio", archivedAt: null };

beforeEach(() => {
  queries.getProject.mockReset();
});

describe("loadProjectOr404", () => {
  it("returns the project the BE read", async () => {
    queries.getProject.mockResolvedValue(project);
    await expect(loadProjectOr404("pry_1")).resolves.toBe(project);
  });

  it.each(["NOT_FOUND", "VALIDATION"] as const)(
    "renders the not-found page for %s",
    async (code) => {
      queries.getProject.mockRejectedValue(new ServiceError(code));
      await expect(loadProjectOr404("pry_x")).rejects.toThrow("NEXT_NOT_FOUND");
    },
  );

  it("renders the not-found page for a malformed id (ZodError)", async () => {
    const error = new Error("bad id");
    error.name = "ZodError";
    queries.getProject.mockRejectedValue(error);
    await expect(loadProjectOr404("")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("lets FORBIDDEN and other failures propagate", async () => {
    queries.getProject.mockRejectedValue(new ServiceError("FORBIDDEN"));
    await expect(loadProjectOr404("pry_1")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps the frozen signature: id in, a project with id, name, code and archivedAt out (DT-218)", () => {
    expectTypeOf(loadProjectOr404).parameters.toEqualTypeOf<[id: string]>();
    type Loaded = Awaited<ReturnType<typeof loadProjectOr404>>;
    expectTypeOf<Pick<Loaded, "id" | "name" | "code">>().toEqualTypeOf<{
      id: string;
      name: string;
      code: string;
    }>();
    expectTypeOf<Loaded["archivedAt"]>().toEqualTypeOf<string | null>();
  });
});
