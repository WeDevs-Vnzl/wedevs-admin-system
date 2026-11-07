// The finance summary is the BE's rule (C13): a role without the finance grant gets a 403, which the read
// turns into `ServiceError("FORBIDDEN")` (the billing tab and the other modules catch that class until CLEAN).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorEnvelope, mockApi } from "@/lib/api/testing";

vi.mock("server-only", () => ({}));
const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("@/lib/api/server", () => server);

import { getProjectFinancials } from "@/features/projects/queries";

const summary = {
  projectId: "pry_kairos_web",
  currency: "USD",
  contractedValue: "5000.00",
  invoiced: "2000.00",
  collected: "1000.00",
  toInvoice: "3000.00",
  receivable: "1000.00",
  monthlyRecurring: "0.00",
  allocatedExpenses: "0.00",
  margin: "1000.00",
  marginPercent: "20.00",
};

beforeEach(() => {
  server.getServerApi.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getProjectFinancials gate", () => {
  it.each(["MEMBER", "VIEWER"] as const)("%s is FORBIDDEN (the BE answers 403)", async () => {
    server.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/projects/{id}/summary": errorEnvelope("FORBIDDEN") }).api,
    );
    await expect(getProjectFinancials("pry_kairos_web")).rejects.toMatchObject({
      name: "ServiceError",
      code: "FORBIDDEN",
    });
  });

  it.each(["OWNER", "ADMIN"] as const)("%s reads the summary", async () => {
    server.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/projects/{id}/summary": { body: summary } }).api,
    );
    const s = await getProjectFinancials("pry_kairos_web");
    expect(s.projectId).toBe("pry_kairos_web");
    expect(s.currency).toBe("USD");
  });
});
