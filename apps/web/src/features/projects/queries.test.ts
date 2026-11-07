import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { errorEnvelope, mockApi } from "@/lib/api/testing";
import type { EntityRef } from "@/lib/validators/common";
import type { ProjectFilterInput } from "@/lib/validators/projects";
import { ServiceError } from "@/server/errors";

vi.mock("server-only", () => ({}));
const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("@/lib/api/server", () => server);

import { getProject, getProjectFinancials, getProjectsOverview, listProjects } from "./queries";

const row = {
  id: "pry_1",
  code: "PRY-0001",
  name: "Sitio Kairos",
  status: "EN_CURSO",
  clients: [],
  stack: [],
  tags: [],
  startDate: null,
  targetEndDate: null,
  archivedAt: null,
  contractedValueUsd: null,
  invoicedUsd: null,
  collectedUsd: null,
  toInvoiceUsd: null,
};
const detail = {
  ...row,
  summary: "Resumen",
  description: null,
  endDate: null,
  links: [],
  hasBillingPlan: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const summary = {
  projectId: "pry_1",
  currency: "USD",
  contractedValue: "1000.00",
  invoiced: "400.00",
  collected: "250.00",
  toInvoice: null,
  receivable: "150.00",
  monthlyRecurring: "0.00",
  allocatedExpenses: "50.00",
  margin: "200.00",
  marginPercent: "20.00",
};

function use(routes: Parameters<typeof mockApi>[0]) {
  const mocked = mockApi(routes);
  server.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

beforeEach(() => {
  server.getServerApi.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("listProjects", () => {
  it("reads GET /api/v1/projects with the parsed filter, lists as repeated keys", async () => {
    const { calls } = use({
      "GET /api/v1/projects": {
        body: { items: [row], total: 1, page: 1, pageSize: 25, pageCount: 1 },
      },
    });

    await expect(
      listProjects({ status: ["EN_CURSO", "PAUSADO"], clientId: "cli_1", q: "kairos" }),
    ).resolves.toMatchObject({ total: 1, items: [{ id: "pry_1", contractedValueUsd: null }] });
    expect(calls[0]?.search.getAll("status")).toEqual(["EN_CURSO", "PAUSADO"]);
    expect(calls[0]?.search.getAll("clientId")).toEqual(["cli_1"]);
    expect(calls[0]?.search.get("q")).toBe("kairos");
    expect(calls[0]?.search.get("archived")).toBe("exclude");
  });

  it("defaults the filter and throws a plain error for a BE failure", async () => {
    const { calls } = use({ "GET /api/v1/projects": errorEnvelope("INTERNAL") });

    await expect(listProjects()).rejects.toThrow("GET /api/v1/projects failed with 500");
    expect(calls[0]?.search.get("pageSize")).toBe("25");
  });
});

describe("getProject", () => {
  it("reads one project through GET /api/v1/projects/{id}", async () => {
    const { calls } = use({ "GET /api/v1/projects/{id}": { body: detail } });
    await expect(getProject("pry_1")).resolves.toMatchObject({ code: "PRY-0001" });
    expect(calls[0]?.path).toBe("/api/v1/projects/pry_1");
  });

  it.each(["NOT_FOUND", "FORBIDDEN", "VALIDATION"] as const)(
    "throws ServiceError(%s) for the BE refusal (error contract, rule 6)",
    async (code) => {
      use({ "GET /api/v1/projects/{id}": errorEnvelope(code) });
      const error = await getProject("pry_1").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ServiceError);
      expect(error).toMatchObject({ code });
    },
  );

  it("throws a plain error for any other failure", async () => {
    use({ "GET /api/v1/projects/{id}": errorEnvelope("INTERNAL") });
    const error = await getProject("pry_1").catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ message: "GET /api/v1/projects/pry_1 failed with 500" });
  });
});

describe("getProjectsOverview", () => {
  it("reads GET /api/v1/projects/overview", async () => {
    const overview = {
      countByStatus: { EN_CURSO: 2 },
      upcomingDeliveries: [row],
      withoutBillingPlan: [],
      topTechnologies: [],
      highestToInvoice: [],
    };
    const { calls } = use({ "GET /api/v1/projects/overview": { body: overview } });
    await expect(getProjectsOverview()).resolves.toMatchObject({ countByStatus: { EN_CURSO: 2 } });
    expect(calls[0]?.path).toBe("/api/v1/projects/overview");
  });
});

describe("frozen exports (DT-218)", () => {
  it("keeps the signatures and the fields the other modules read", () => {
    expectTypeOf(listProjects).parameter(0).toEqualTypeOf<ProjectFilterInput | undefined>();
    expectTypeOf(getProject).parameters.toEqualTypeOf<[id: string]>();
    expectTypeOf(getProjectFinancials).parameters.toEqualTypeOf<[id: string]>();
    expectTypeOf<Awaited<ReturnType<typeof getProject>>>().toHaveProperty("archivedAt");
    expectTypeOf<Awaited<ReturnType<typeof getProject>>["id"]>().toBeString();
    expectTypeOf<Awaited<ReturnType<typeof getProject>>["code"]>().toBeString();
    expectTypeOf<Awaited<ReturnType<typeof getProject>>["name"]>().toBeString();
    expectTypeOf<Awaited<ReturnType<typeof getProject>>["archivedAt"]>().toEqualTypeOf<
      string | null
    >();
    type Item = Awaited<ReturnType<typeof listProjects>>["items"][number];
    expectTypeOf<Item["id"]>().toBeString();
    expectTypeOf<Item["status"]>().toBeString();
    expectTypeOf<Awaited<ReturnType<typeof listProjects>>["total"]>().toBeNumber();
    expectTypeOf<Awaited<ReturnType<typeof getProjectFinancials>>["toInvoice"]>().toEqualTypeOf<
      string | null
    >();
    expectTypeOf<Awaited<ReturnType<typeof getProjectFinancials>>["margin"]>().toBeString();
    // A prefill reader builds an `EntityRef` from `id`, `code` and `name`.
    expectTypeOf<Pick<Awaited<ReturnType<typeof getProject>>, "id" | "code" | "name">>().toExtend<{
      id: string;
      code: string;
      name: string;
    }>();
    expectTypeOf<EntityRef["type"]>().toBeString();
  });
});

describe("getProjectFinancials", () => {
  it("reads the summary through GET /api/v1/projects/{id}/summary (finance roles)", async () => {
    const { calls } = use({ "GET /api/v1/projects/{id}/summary": { body: summary } });
    await expect(getProjectFinancials("pry_1")).resolves.toMatchObject({
      projectId: "pry_1",
      contractedValue: "1000.00",
      invoiced: "400.00",
      collected: "250.00",
      toInvoice: null,
      receivable: "150.00",
      monthlyRecurring: "0.00",
      allocatedExpenses: "50.00",
      margin: "200.00",
    });
    expect(calls[0]?.path).toBe("/api/v1/projects/pry_1/summary");
  });
});
