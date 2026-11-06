import { beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ api: undefined as unknown }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => cache);
vi.mock("@/lib/api/server", () => ({ getServerApi: async () => holder.api }));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import { updateCompanySettingsAction } from "./actions";

function connect(routes: RouteTable) {
  const mocked = mockApi(routes);
  holder.api = mocked.api;
  return mocked;
}

const BLANK = {
  name: "",
  legalName: undefined,
  taxId: undefined,
  address: undefined,
  logoFileId: undefined,
};

beforeEach(() => vi.clearAllMocks());

describe("updateCompanySettingsAction (PATCH /settings/company)", () => {
  it("sends the profile with the logo file id and returns the stored one", async () => {
    const { calls } = connect({
      "PATCH /api/v1/settings/company": {
        body: {
          name: "WeDevs",
          legalName: null,
          taxId: "J-1",
          address: null,
          logoFileId: "file_1",
        },
      },
    });
    const result = await updateCompanySettingsAction({
      ...BLANK,
      name: "WeDevs",
      taxId: "J-1",
      logoFileId: "file_1",
    });
    expect(calls[0]).toMatchObject({ method: "PATCH", path: "/api/v1/settings/company" });
    expect(calls[0]?.body).toEqual({ name: "WeDevs", taxId: "J-1", logoFileId: "file_1" });
    expect(result).toEqual({
      ok: true,
      data: {
        name: "WeDevs",
        legalName: undefined,
        taxId: "J-1",
        address: undefined,
        logoFileId: "file_1",
      },
    });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/settings/company");
  });

  it("maps a bad logo to a field error and does not revalidate (DT-109)", async () => {
    connect({
      "PATCH /api/v1/settings/company": errorEnvelope("VALIDATION", {
        fieldErrors: { logoFileId: ["validation.id.invalid"] },
      }),
    });
    expect(
      await updateCompanySettingsAction({ ...BLANK, name: "WeDevs", logoFileId: "bad" }),
    ).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { logoFileId: ["validation.id.invalid"] } },
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps FORBIDDEN for a role that cannot update settings", async () => {
    connect({ "PATCH /api/v1/settings/company": errorEnvelope("FORBIDDEN") });
    expect(await updateCompanySettingsAction({ ...BLANK, name: "WeDevs" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});
