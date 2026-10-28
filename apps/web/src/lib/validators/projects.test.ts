import type { ProjectsService } from "./projects";
import { describe, expect, it } from "vitest";
import { VALIDATION_MESSAGES } from "./common";
import { PROJECT_STATUS_VALUES } from "./enums";
import {
  PROJECT_STATUS_TRANSITIONS,
  canTransitionProject,
  createProjectInputSchema,
  projectDetailSchema,
  projectFilterSchema,
  projectLinkInputSchema,
  projectListRowSchema,
  reorderProjectLinksInputSchema,
  setProjectClientsInputSchema,
  setProjectStatusInputSchema,
  setProjectTechnologiesInputSchema,
  updateProjectInputSchema,
  upsertProjectLinksInputSchema,
} from "./projects";

const issues = (result: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  (result.error?.issues ?? []).map((i) => `${i.path.join(".")}:${i.message}`);

const valid = {
  name: "Portal de pagos",
  clients: [{ clientId: "cli_1", role: "Contratante" }],
  summary: "Plataforma de cobros para comercios.",
};

describe("createProject", () => {
  it("accepts the minimum and applies defaults (PROPUESTA, no stack, no links)", () => {
    const parsed = createProjectInputSchema.parse(valid);
    expect(parsed.status).toBe("PROPUESTA");
    expect(parsed.technologyIds).toEqual([]);
    expect(parsed.links).toEqual([]);
    expect(parsed.clients[0]?.role).toBe("Contratante");
  });

  it("needs at least one client and rejects the same client twice", () => {
    expect(createProjectInputSchema.safeParse({ ...valid, clients: [] }).success).toBe(false);
    expect(createProjectInputSchema.safeParse({ ...valid, clients: undefined }).success).toBe(
      false,
    );
    expect(
      createProjectInputSchema.safeParse({
        ...valid,
        clients: [{ clientId: "cli_1" }, { clientId: "cli_1", role: "Usuario final" }],
      }).success,
    ).toBe(false);
    expect(
      createProjectInputSchema.safeParse({
        ...valid,
        clients: [{ clientId: "cli_1" }, { clientId: "cli_2", role: "Usuario final" }],
      }).success,
    ).toBe(true);
  });

  it("limits the summary to 280 characters and requires it", () => {
    expect(createProjectInputSchema.safeParse({ ...valid, summary: "a".repeat(280) }).success).toBe(
      true,
    );
    expect(createProjectInputSchema.safeParse({ ...valid, summary: "a".repeat(281) }).success).toBe(
      false,
    );
    expect(createProjectInputSchema.safeParse({ ...valid, summary: "  " }).success).toBe(false);
  });

  it("requires startDate for EN_CURSO and endDate for ENTREGADO", () => {
    expect(issues(createProjectInputSchema.safeParse({ ...valid, status: "EN_CURSO" }))).toEqual([
      `startDate:${VALIDATION_MESSAGES.required}`,
    ]);
    expect(
      createProjectInputSchema.safeParse({ ...valid, status: "EN_CURSO", startDate: "2026-10-01" })
        .success,
    ).toBe(true);
    expect(
      issues(
        createProjectInputSchema.safeParse({
          ...valid,
          status: "ENTREGADO",
          startDate: "2026-10-01",
        }),
      ),
    ).toEqual([`endDate:${VALIDATION_MESSAGES.required}`]);
    expect(
      createProjectInputSchema.safeParse({
        ...valid,
        status: "ENTREGADO",
        startDate: "2026-10-01",
        endDate: "2026-12-01",
      }).success,
    ).toBe(true);
  });

  it("rejects impossible dates and an end before the start", () => {
    expect(createProjectInputSchema.safeParse({ ...valid, startDate: "2026-02-30" }).success).toBe(
      false,
    );
    expect(
      issues(
        createProjectInputSchema.safeParse({
          ...valid,
          startDate: "2026-10-10",
          targetEndDate: "2026-10-01",
        }),
      ),
    ).toEqual([`targetEndDate:${VALIDATION_MESSAGES.invalidDate}`]);
  });

  it("stack is technology ids only, without repeats", () => {
    expect(
      createProjectInputSchema.safeParse({ ...valid, technologyIds: ["tech_1", "tech_2"] }).success,
    ).toBe(true);
    expect(
      createProjectInputSchema.safeParse({ ...valid, technologyIds: ["tech_1", "tech_1"] }).success,
    ).toBe(false);
    expect(
      createProjectInputSchema.safeParse({ ...valid, technologyIds: ["Next js!"] }).success,
    ).toBe(false);
    expect(
      createProjectInputSchema.safeParse({ ...valid, technologyIds: [{ name: "Next.js" }] })
        .success,
    ).toBe(false);
  });

  it("accepts a Tiptap description and rejects a script node (C4)", () => {
    const description = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hola" }] }],
    };
    expect(createProjectInputSchema.safeParse({ ...valid, description }).success).toBe(true);
    expect(
      createProjectInputSchema.safeParse({
        ...valid,
        description: { type: "doc", content: [{ type: "script" }] },
      }).success,
    ).toBe(false);
  });

  it("updateProject needs an id and keeps the rules", () => {
    expect(updateProjectInputSchema.safeParse({ id: "pry_1", ...valid }).success).toBe(true);
    expect(updateProjectInputSchema.safeParse(valid).success).toBe(false);
    expect(updateProjectInputSchema.safeParse({ id: "pry_1", ...valid, clients: [] }).success).toBe(
      false,
    );
  });
});

describe("project links", () => {
  const link = {
    group: "REPOSITORIO",
    label: "Frontend repo",
    url: "https://github.com/wedevs/app",
  };

  it("accepts group enum, label, valid URL and order", () => {
    expect(projectLinkInputSchema.parse(link).order).toBe(0);
    expect(projectLinkInputSchema.safeParse({ ...link, order: 3 }).success).toBe(true);
  });

  it("rejects bad groups, blank labels, invalid or unsafe URLs and bad orders", () => {
    expect(projectLinkInputSchema.safeParse({ ...link, group: "GITHUB" }).success).toBe(false);
    expect(projectLinkInputSchema.safeParse({ ...link, label: " " }).success).toBe(false);
    for (const url of ["not a url", "javascript:alert(1)", "ftp://x.com", ""]) {
      expect(projectLinkInputSchema.safeParse({ ...link, url }).success, url).toBe(false);
    }
    expect(projectLinkInputSchema.safeParse({ ...link, order: -1 }).success).toBe(false);
    expect(projectLinkInputSchema.safeParse({ ...link, order: 1.5 }).success).toBe(false);
  });

  it("upsert and reorder inputs", () => {
    expect(
      upsertProjectLinksInputSchema.safeParse({ projectId: "pry_1", links: [link] }).success,
    ).toBe(true);
    expect(upsertProjectLinksInputSchema.safeParse({ projectId: "pry_1", links: [] }).success).toBe(
      false,
    );
    expect(
      reorderProjectLinksInputSchema.safeParse({
        projectId: "pry_1",
        group: "ENTORNO",
        orderedLinkIds: ["a", "b"],
      }).success,
    ).toBe(true);
    expect(
      reorderProjectLinksInputSchema.safeParse({
        projectId: "pry_1",
        group: "ENTORNO",
        orderedLinkIds: ["a", "a"],
      }).success,
    ).toBe(false);
  });
});

describe("setProjectStatus", () => {
  it("requires startDate for EN_CURSO and endDate for ENTREGADO", () => {
    expect(setProjectStatusInputSchema.safeParse({ id: "pry_1", status: "EN_CURSO" }).success).toBe(
      false,
    );
    expect(
      setProjectStatusInputSchema.safeParse({
        id: "pry_1",
        status: "EN_CURSO",
        startDate: "2026-10-01",
      }).success,
    ).toBe(true);
    expect(
      issues(setProjectStatusInputSchema.safeParse({ id: "pry_1", status: "ENTREGADO" })),
    ).toEqual([`endDate:${VALIDATION_MESSAGES.required}`]);
    expect(
      setProjectStatusInputSchema.safeParse({
        id: "pry_1",
        status: "ENTREGADO",
        endDate: "2026-12-15",
      }).success,
    ).toBe(true);
    expect(setProjectStatusInputSchema.safeParse({ id: "pry_1", status: "PAUSADO" }).success).toBe(
      true,
    );
  });

  it("CANCELADO needs explicit confirmation and carries the optional cascades", () => {
    expect(
      setProjectStatusInputSchema.safeParse({ id: "pry_1", status: "CANCELADO" }).success,
    ).toBe(false);
    const parsed = setProjectStatusInputSchema.parse({
      id: "pry_1",
      status: "CANCELADO",
      confirm: true,
      cancelPendingInstallments: true,
    });
    expect(parsed.cancelPendingInstallments).toBe(true);
    expect(parsed.finishRecurringCharges).toBe(false);
  });

  it("rejects unknown statuses", () => {
    expect(
      setProjectStatusInputSchema.safeParse({ id: "pry_1", status: "TERMINADO" }).success,
    ).toBe(false);
  });

  it("transition table matches the PRD diagram", () => {
    expect(Object.keys(PROJECT_STATUS_TRANSITIONS).sort()).toEqual(
      [...PROJECT_STATUS_VALUES].sort(),
    );
    expect(canTransitionProject("PROPUESTA", "EN_CURSO")).toBe(true);
    expect(canTransitionProject("EN_CURSO", "PAUSADO")).toBe(true);
    expect(canTransitionProject("PAUSADO", "EN_CURSO")).toBe(true);
    expect(canTransitionProject("ENTREGADO", "MANTENIMIENTO")).toBe(true);
    expect(canTransitionProject("PROPUESTA", "ENTREGADO")).toBe(false);
    expect(canTransitionProject("MANTENIMIENTO", "EN_CURSO")).toBe(false);
    for (const status of PROJECT_STATUS_VALUES) {
      expect(canTransitionProject(status, "CANCELADO"), status).toBe(status !== "CANCELADO");
      expect(canTransitionProject("CANCELADO", status)).toBe(false);
    }
  });
});

describe("setProjectClients / setProjectTechnologies", () => {
  it("keeps at least one client and technology ids only", () => {
    expect(
      setProjectClientsInputSchema.safeParse({
        projectId: "pry_1",
        clients: [{ clientId: "cli_1" }],
      }).success,
    ).toBe(true);
    expect(
      setProjectClientsInputSchema.safeParse({ projectId: "pry_1", clients: [] }).success,
    ).toBe(false);
    expect(
      setProjectTechnologiesInputSchema.safeParse({ projectId: "pry_1", technologyIds: [] })
        .success,
    ).toBe(true);
    expect(
      setProjectTechnologiesInputSchema.safeParse({ projectId: "pry_1", technologyIds: ["x", "x"] })
        .success,
    ).toBe(false);
  });
});

describe("project filters and DTOs", () => {
  it("filters by status, client, technology and delivery window", () => {
    const parsed = projectFilterSchema.parse({
      status: ["EN_CURSO", "PAUSADO"],
      technologyId: "tech_1",
      deliveryTo: "2026-12-31",
      withoutBillingPlan: "true",
      sort: "toInvoiceUsd:desc",
    });
    expect(parsed.status).toEqual(["EN_CURSO", "PAUSADO"]);
    expect(parsed.technologyId).toEqual(["tech_1"]);
    expect(parsed.withoutBillingPlan).toBe(true);
    expect(projectFilterSchema.safeParse({ status: "X" }).success).toBe(false);
    expect(projectFilterSchema.safeParse({ sort: "summary:asc" }).success).toBe(false);
  });

  const chip = {
    id: "tech_1",
    name: "Next.js",
    nameEn: null,
    slug: "next-js",
    category: "FRONTEND",
    iconSlug: null,
    color: null,
  };
  const headline = {
    contractedValueUsd: "10000.00",
    invoicedUsd: "4000.00",
    collectedUsd: "2500.00",
    toInvoiceUsd: "6000.00",
  };
  const row = {
    ...headline,
    id: "pry_1",
    code: "PRY-0001",
    name: "Portal de pagos",
    clients: [
      { client: { id: "cli_1", code: "CLI-0001", label: "Kairos", type: "CLIENT" }, role: null },
    ],
    status: "EN_CURSO",
    startDate: "2026-10-01",
    targetEndDate: null,
    stack: [chip],
    tags: [],
    archivedAt: null,
  };

  it("list row money columns are strings", () => {
    expect(projectListRowSchema.safeParse(row).success).toBe(true);
    expect(projectListRowSchema.safeParse({ ...row, invoicedUsd: 4000 }).success).toBe(false);
  });

  it("detail DTO", () => {
    expect(
      projectDetailSchema.safeParse({
        ...row,
        summary: "Resumen",
        description: null,
        endDate: null,
        links: [],
        hasBillingPlan: false,
        createdAt: "2026-10-01T10:00:00.000Z",
        updatedAt: "2026-10-01T10:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});

describe("ProjectsService (PRD §12 service names)", () => {
  it("declares every service of the module with its exact name", () => {
    const names = [
      "createProject",
      "updateProject",
      "setProjectStatus",
      "setProjectClients",
      "setProjectTechnologies",
      "upsertProjectLinks",
      "reorderProjectLinks",
      "archiveProject",
      "getProjectFinancials",
    ] as const satisfies readonly (keyof ProjectsService)[];
    expect(new Set(names).size).toBe(names.length);
  });
});
