import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import type { ClientDetailDto, ClientSummaryResponseDto } from "@/lib/api/types/clients";
import type { ClientFilterInput } from "@/lib/validators/clients";
import { ServiceError } from "@/server/errors";

vi.mock("server-only", () => ({}));
const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("@/lib/api/server", () => server);

import { getClient, getClientFinancials, getClientsOverview, listClients } from "./queries";

function useApi(routes: RouteTable) {
  const mocked = mockApi(routes);
  server.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

beforeEach(() => server.getServerApi.mockReset());

const client = {
  id: "cli_kairos",
  code: "CLI-0001",
  kind: "EMPRESA",
  tradeName: "Kairos Studio",
  legalName: "Kairos Studio C.A.",
  taxId: "J-30123456-7",
  country: "VE",
  address: "Caracas",
  phone: "+584121234567",
  email: null,
  website: null,
  status: "ACTIVO",
  activatedAt: null,
  tags: [],
  contacts: [],
  createdAt: "2026-11-01T12:00:00.000Z",
  updatedAt: "2026-11-01T12:00:00.000Z",
  archivedAt: null,
} satisfies ClientDetailDto;

const summary: ClientSummaryResponseDto = {
  clientId: "cli_kairos",
  totalInvoicedUsd: "2820.00",
  totalCollectedUsd: "800.00",
  receivableUsd: "2020.00",
  overdueUsd: "0.00",
  creditBalanceUsd: "0.00",
  collectedLast12MonthsUsd: "800.00",
  projectCount: 2,
};

describe("listClients", () => {
  it("reads the page through GET /api/v1/clients with the URL-shaped filter", async () => {
    const { calls } = useApi({
      "GET /api/v1/clients": {
        body: { items: [], total: 0, page: 2, pageSize: 25, pageCount: 0 },
      },
    });

    await expect(
      listClients({ page: "2", pageSize: "25", status: "ACTIVO" }),
    ).resolves.toMatchObject({
      page: 2,
    });
    expect(calls[0]?.search.get("page")).toBe("2");
    expect(calls[0]?.search.getAll("status")).toEqual(["ACTIVO"]);
    await listClients();
    expect(calls[1]?.search.get("page")).toBe("1");
  });
});

describe("getClient", () => {
  it("reads one client with its contacts", async () => {
    const { calls } = useApi({ "GET /api/v1/clients/{id}": { body: client } });

    await expect(getClient("cli_kairos")).resolves.toMatchObject({ tradeName: "Kairos Studio" });
    expect(calls[0]?.path).toBe("/api/v1/clients/cli_kairos");
  });

  // The cross-module readers (documents, notes, projects) catch `ServiceError` until CLEAN (W2 rule 6).
  it.each(["NOT_FOUND", "FORBIDDEN", "VALIDATION"] as const)(
    "throws ServiceError(%s) for the matching BE envelope",
    async (code) => {
      useApi({ "GET /api/v1/clients/{id}": errorEnvelope(code) });

      const failure = await getClient("cli_nope").catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ServiceError);
      expect(failure).toMatchObject({ code });
    },
  );

  it("throws a plain error for an unexpected failure", async () => {
    useApi({ "GET /api/v1/clients/{id}": errorEnvelope("INTERNAL") });

    const failure = await getClient("cli_kairos").catch((error: unknown) => error);
    expect(failure).not.toBeInstanceOf(ServiceError);
    expect(failure).toMatchObject({ message: "GET /api/v1/clients/cli_kairos failed with 500" });
  });

  // Frozen for W3/W4 and CLEAN (DT-218): name, parameter and the fields the consumers read.
  it("keeps its frozen signature", () => {
    expectTypeOf(getClient).parameters.toEqualTypeOf<[id: string]>();
    expectTypeOf(getClient).returns.resolves.toHaveProperty("id").toEqualTypeOf<string>();
    expectTypeOf(getClient).returns.resolves.toHaveProperty("code").toEqualTypeOf<string>();
    expectTypeOf(getClient).returns.resolves.toHaveProperty("tradeName").toEqualTypeOf<string>();
    expectTypeOf(getClient)
      .returns.resolves.toHaveProperty("archivedAt")
      .toEqualTypeOf<string | null>();
    expectTypeOf(listClients).parameters.toEqualTypeOf<[input?: ClientFilterInput]>();
    expectTypeOf(listClients).returns.resolves.toHaveProperty("total").toEqualTypeOf<number>();
    expectTypeOf<Awaited<ReturnType<typeof listClients>>["items"][number]>().toHaveProperty("id");
    expectTypeOf<Awaited<ReturnType<typeof listClients>>["items"][number]>().toHaveProperty(
      "tradeName",
    );
  });
});

describe("getClientFinancials", () => {
  it("reads the summary for an Owner", async () => {
    const { calls } = useApi({ "GET /api/v1/clients/{id}/summary": { body: summary } });

    await expect(getClientFinancials("cli_kairos")).resolves.toMatchObject({
      totalInvoicedUsd: "2820.00",
      collectedLast12MonthsUsd: "800.00",
    });
    expect(calls[0]?.path).toBe("/api/v1/clients/cli_kairos/summary");
  });

  it("is FORBIDDEN for a Member, as the BE answers", async () => {
    useApi({ "GET /api/v1/clients/{id}/summary": errorEnvelope("FORBIDDEN") });

    await expect(getClientFinancials("cli_kairos")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("getClientsOverview", () => {
  const overview = {
    countByStatus: { PROSPECTO: 1, ACTIVO: 2, INACTIVO: 0 },
    topByRevenue: [],
    withOverdueBalance: [],
    recentlyCreated: [],
  };

  it("reads the overview through GET /api/v1/clients/overview", async () => {
    const row = {
      id: "cli_kairos",
      code: "CLI-0001",
      tradeName: "Kairos Studio",
      kind: "EMPRESA",
      country: "VE",
      status: "ACTIVO",
      projectCount: 2,
      totalInvoicedUsd: "2820.00",
      receivableUsd: "2020.00",
      tags: [],
      lastActivityAt: null,
      archivedAt: null,
    };
    const { calls } = useApi({
      "GET /api/v1/clients/overview": {
        body: {
          ...overview,
          topByRevenue: [{ ...row, collectedLast12MonthsUsd: "800.00" }],
          recentlyCreated: [row],
        },
      },
    });

    const result = await getClientsOverview();
    expect(result.topByRevenue[0]?.collectedLast12MonthsUsd).toBe("800.00");
    expect(result.recentlyCreated).toHaveLength(1);
    expect(calls[0]?.path).toBe("/api/v1/clients/overview");
  });

  it("returns the empty ranked lists a Member gets (DT-175)", async () => {
    useApi({
      "GET /api/v1/clients/overview": {
        body: { ...overview, recentlyCreated: [] },
      },
    });

    await expect(getClientsOverview()).resolves.toMatchObject({
      topByRevenue: [],
      withOverdueBalance: [],
      countByStatus: { ACTIVO: 2 },
    });
  });
});
