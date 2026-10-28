import type { ClientsService } from "./clients";
import { describe, expect, it } from "vitest";
import { VALIDATION_MESSAGES } from "./common";
import {
  COUNTRY_CODE_VALUES,
  archiveClientInputSchema,
  clientDetailSchema,
  clientFilterSchema,
  clientFinancialsSchema,
  clientListRowSchema,
  countryCodeSchema,
  createClientInputSchema,
  isValidTaxIdFor,
  isValidVeRif,
  normalizeVeRif,
  setClientStatusInputSchema,
  updateClientInputSchema,
} from "./clients";

const issues = (result: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  (result.error?.issues ?? []).map((i) => `${i.path.join(".")}:${i.message}`);

const company = {
  kind: "EMPRESA",
  tradeName: "Kairos Studio",
  legalName: "Kairos Studio C.A.",
  taxId: "J-12345678-9",
  country: "VE",
  address: "Av. Principal, Caracas",
  phone: "+584121234567",
};

describe("country (ISO 3166-1 alpha-2)", () => {
  it("lists the 249 assigned codes, unique and upper-case", () => {
    expect(COUNTRY_CODE_VALUES).toHaveLength(249);
    expect(new Set(COUNTRY_CODE_VALUES).size).toBe(249);
    expect(COUNTRY_CODE_VALUES.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
  });

  it("accepts real codes and rejects invalid ones", () => {
    for (const ok of ["VE", "US", "ES", "CO"])
      expect(countryCodeSchema.safeParse(ok).success).toBe(true);
    for (const bad of ["ZZ", "ve", "VEN", "V", "", "XX"]) {
      expect(countryCodeSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("Venezuelan RIF", () => {
  it.each([
    "J-12345678-9",
    "V-12345678-0",
    "E-87654321-1",
    "G-20000001-5",
    "P-11111111-2",
    "J123456789",
    "j-12345678-9",
  ])("accepts %s", (v) => {
    expect(isValidVeRif(v)).toBe(true);
  });

  it.each([
    "X-12345678-9",
    "J-1234567-9",
    "J-123456789-9",
    "J-12345678",
    "12345678-9",
    "J-ABCDEFGH-9",
    "",
  ])("rejects %j", (v) => {
    expect(isValidVeRif(v)).toBe(false);
  });

  it("normalizes to J-12345678-9", () => {
    expect(normalizeVeRif(" j123456789 ")).toBe("J-12345678-9");
    expect(normalizeVeRif("J-12345678-9")).toBe("J-12345678-9");
    expect(normalizeVeRif(" not a rif ")).toBe("not a rif");
  });

  it("only VE clients need an RIF; other countries take free text", () => {
    expect(isValidTaxIdFor("VE", "B12345")).toBe(false);
    expect(isValidTaxIdFor("US", "12-3456789")).toBe(true);
    expect(isValidTaxIdFor("CO", "900.123.456-7")).toBe(true);
    expect(isValidTaxIdFor("CO", "  ")).toBe(false);
  });
});

describe("createClient", () => {
  it("accepts a valid company and applies defaults (status PROSPECTO)", () => {
    const parsed = createClientInputSchema.parse(company);
    expect(parsed.status).toBe("PROSPECTO");
    expect(parsed.tagIds).toEqual([]);
    expect(parsed.email).toBeUndefined();
    expect(parsed.website).toBeUndefined();
  });

  it("accepts a person without legal name", () => {
    const { legalName: _unused, ...person } = company;
    void _unused;
    expect(
      createClientInputSchema.safeParse({ ...person, kind: "PERSONA", tradeName: "Ana Gómez" })
        .success,
    ).toBe(true);
  });

  it("requires legalName for EMPRESA", () => {
    const { legalName: _unused, ...noLegal } = company;
    void _unused;
    expect(issues(createClientInputSchema.safeParse(noLegal))).toEqual([
      `legalName:${VALIDATION_MESSAGES.required}`,
    ]);
    expect(createClientInputSchema.safeParse({ ...company, legalName: "   " }).success).toBe(false);
  });

  it("validates the RIF only when the country is VE", () => {
    expect(issues(createClientInputSchema.safeParse({ ...company, taxId: "12345" }))).toEqual([
      `taxId:${VALIDATION_MESSAGES.invalidFormat}`,
    ]);
    expect(
      createClientInputSchema.safeParse({ ...company, country: "US", taxId: "12-3456789" }).success,
    ).toBe(true);
  });

  it("rejects a non-ISO country, a non-E.164 phone, a bad e-mail and a javascript: website", () => {
    expect(createClientInputSchema.safeParse({ ...company, country: "ZZ" }).success).toBe(false);
    expect(createClientInputSchema.safeParse({ ...company, phone: "0412-1234567" }).success).toBe(
      false,
    );
    expect(createClientInputSchema.safeParse({ ...company, email: "nope" }).success).toBe(false);
    expect(
      createClientInputSchema.safeParse({ ...company, website: "javascript:alert(1)" }).success,
    ).toBe(false);
    expect(
      createClientInputSchema.safeParse({ ...company, website: "https://kairos.example" }).success,
    ).toBe(true);
  });

  it("rejects missing required fields and an unknown status", () => {
    for (const key of ["kind", "tradeName", "taxId", "country", "address", "phone"]) {
      const copy: Record<string, unknown> = { ...company };
      delete copy[key];
      expect(createClientInputSchema.safeParse(copy).success, key).toBe(false);
    }
    expect(createClientInputSchema.safeParse({ ...company, status: "VIP" }).success).toBe(false);
    expect(createClientInputSchema.safeParse({ ...company, status: "ACTIVO" }).success).toBe(true);
  });
});

describe("other client inputs", () => {
  it("updateClient keeps the cross-field rules and needs an id", () => {
    expect(updateClientInputSchema.safeParse({ id: "cli_1", ...company }).success).toBe(true);
    expect(updateClientInputSchema.safeParse({ ...company }).success).toBe(false);
    expect(
      updateClientInputSchema.safeParse({ id: "cli_1", ...company, taxId: "bad" }).success,
    ).toBe(false);
  });

  it("setClientStatus and archiveClient", () => {
    expect(setClientStatusInputSchema.safeParse({ id: "cli_1", status: "INACTIVO" }).success).toBe(
      true,
    );
    expect(setClientStatusInputSchema.safeParse({ id: "cli_1", status: "x" }).success).toBe(false);
    expect(archiveClientInputSchema.parse({ id: "cli_1" }).confirm).toBe(false);
    expect(archiveClientInputSchema.parse({ id: "cli_1", confirm: true }).confirm).toBe(true);
  });
});

describe("client filters and DTOs", () => {
  it("extends the list query with facets and whitelists sorting", () => {
    const parsed = clientFilterSchema.parse({
      status: ["ACTIVO", "PROSPECTO"],
      country: "VE",
      hasOverdue: "true",
      sort: "receivableUsd:desc",
    });
    expect(parsed.status).toEqual(["ACTIVO", "PROSPECTO"]);
    expect(parsed.country).toEqual(["VE"]);
    expect(parsed.hasOverdue).toBe(true);
    expect(clientFilterSchema.safeParse({ sort: "taxId:asc" }).success).toBe(false);
    expect(clientFilterSchema.safeParse({ status: "BORRADOR" }).success).toBe(false);
  });

  const row = {
    id: "cli_1",
    code: "CLI-0001",
    tradeName: "Kairos Studio",
    kind: "EMPRESA",
    country: "VE",
    status: "ACTIVO",
    projectCount: 2,
    totalInvoicedUsd: "12500.00",
    receivableUsd: "1800.50",
    tags: [],
    lastActivityAt: null,
    archivedAt: null,
  };

  it("financial metrics are money strings, never numbers (C15)", () => {
    expect(clientListRowSchema.safeParse(row).success).toBe(true);
    expect(clientListRowSchema.safeParse({ ...row, totalInvoicedUsd: 12500 }).success).toBe(false);
    expect(clientListRowSchema.safeParse({ ...row, receivableUsd: "1.234" }).success).toBe(false);
    expect(
      clientFinancialsSchema.safeParse({
        clientId: "cli_1",
        totalInvoicedUsd: "100.00",
        totalCollectedUsd: "40.00",
        receivableUsd: "60.00",
        overdueUsd: "0",
        creditBalanceUsd: "0",
        projectCount: 1,
      }).success,
    ).toBe(true);
  });

  it("detail DTO embeds contacts and financials", () => {
    const detail = {
      ...company,
      id: "cli_1",
      code: "CLI-0001",
      email: null,
      website: null,
      status: "ACTIVO",
      activatedAt: null,
      tags: [],
      contacts: [],
      financials: {
        clientId: "cli_1",
        totalInvoicedUsd: "0",
        totalCollectedUsd: "0",
        receivableUsd: "0",
        overdueUsd: "0",
        creditBalanceUsd: "0",
        projectCount: 0,
      },
      createdAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-01T10:00:00.000Z",
      archivedAt: null,
    };
    expect(clientDetailSchema.safeParse(detail).success).toBe(true);
  });
});

describe("ClientsService (PRD §12 service names)", () => {
  it("declares every service of the module with its exact name", () => {
    const names = [
      "createClient",
      "updateClient",
      "setClientStatus",
      "archiveClient",
      "restoreClient",
      "listClients",
      "getClient",
      "getClientFinancials",
    ] as const satisfies readonly (keyof ClientsService)[];
    expect(new Set(names).size).toBe(names.length);
  });
});
