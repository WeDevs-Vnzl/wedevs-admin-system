// MOCK — tests for the projects service: state machine, dates, hints, cancel options, links, clients, stack.
import { describe, expect, it } from "vitest";
import { PROJECT_STATUS_VALUES } from "@/lib/validators/enums";
import type { ProjectsService } from "@/lib/validators/projects";
import {
  createProjectInputSchema,
  projectFilterSchema,
  PROJECT_STATUS_TRANSITIONS,
  setProjectStatusInputSchema,
  type CreateProjectInput,
} from "@/lib/validators/projects";
import type { InstallmentDTO, RecurringChargeDTO } from "@/lib/validators/billing";
import type { MockServiceContext } from "../ctx";
import { makeTestContext } from "../test-helpers";
import * as svc from "./projects";

const newProject = (overrides: Record<string, unknown> = {}): CreateProjectInput =>
  createProjectInputSchema.parse({
    name: "Sitio de prueba",
    summary: "Un proyecto de prueba",
    clients: [{ clientId: "cli_kairos", role: "Contratante" }],
    ...overrides,
  });

const statusInput = (overrides: Record<string, unknown>) =>
  setProjectStatusInputSchema.parse({ id: "pry_kairos_web", ...overrides });

const filter = (query: Record<string, unknown> = {}) =>
  projectFilterSchema.parse({ pageSize: 100, ...query });

const activityOf = (db: ReturnType<typeof makeTestContext>["db"], id: string) =>
  db.activity.filter((entry) => entry.entityType === "PROJECT" && entry.entityId === id);

function seedInstallment(db: ReturnType<typeof makeTestContext>["db"], status: string, id: string) {
  db.installments.push({
    id,
    projectId: "pry_tornillo_tienda",
    billingPlanId: null,
    recurringChargeId: null,
    kind: "CUOTA",
    label: `Cuota ${id}`,
    amount: "100.00",
    currency: "USD",
    percentage: null,
    dueDate: null,
    trigger: null,
    periodStart: null,
    periodEnd: null,
    order: 0,
    status,
    cancelledAt: null,
    invoicedAmount: "0.00",
    locked: false,
  } as unknown as InstallmentDTO);
}

function seedCharge(
  db: ReturnType<typeof makeTestContext>["db"],
  projectId: string,
  status: string,
) {
  db.recurringCharges.push({
    id: `rch_${projectId}_${status}`,
    projectId,
    label: "Mantenimiento mensual",
    amount: "50.00",
    currency: "USD",
    frequency: "MENSUAL",
    startDate: "2026-01-01",
    endDate: null,
    billingDay: 1,
    leadDays: 5,
    status,
    lastGeneratedPeriodStart: null,
    monthlyAmount: "50.00",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as RecurringChargeDTO);
}

describe("createProject", () => {
  it("allocates PRY-####, defaults to PROPUESTA and logs CREATE and LINK", async () => {
    const { ctx, db } = makeTestContext();
    const last = Math.max(...db.projects.map((p) => Number(p.code.slice(4))));
    const dto = await svc.createProject(
      ctx,
      newProject({
        clients: [
          { clientId: "cli_kairos", role: "Contratante" },
          { clientId: "cli_hotel_mochima" },
        ],
      }),
    );
    expect(dto.code).toBe(`PRY-${String(last + 1).padStart(4, "0")}`);
    expect(dto.status).toBe("PROPUESTA");
    expect(dto.clients.map((c) => [c.client.id, c.role])).toEqual([
      ["cli_kairos", "Contratante"],
      ["cli_hotel_mochima", null],
    ]);
    expect(dto).toMatchObject({
      contractedValueUsd: "0.00",
      invoicedUsd: "0.00",
      collectedUsd: "0.00",
      toInvoiceUsd: "0.00",
      hasBillingPlan: false,
      archivedAt: null,
    });
    const actions = activityOf(db, dto.id).map((entry) => entry.action);
    expect(actions).toEqual(["CREATE", "LINK", "LINK"]);
    expect(activityOf(db, dto.id)[0]).toMatchObject({ actorId: "usr_test", entityLabel: dto.name });
  });

  it("requires at least one existing, non-archived client", async () => {
    const { ctx, db } = makeTestContext();
    const archived = db.clients.find((c) => c.archivedAt)!;
    await expect(svc.createProject(ctx, { ...newProject(), clients: [] })).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { clients: expect.any(Array) },
    });
    for (const clientId of ["cli_missing", archived.id]) {
      await expect(
        svc.createProject(ctx, newProject({ clients: [{ clientId }] })),
      ).rejects.toMatchObject({
        code: "VALIDATION",
        fieldErrors: { clients: ["projects.errors.clientNotFound"] },
      });
    }
  });

  it("accepts active technologies only: unknown and inactive fail on technologyIds (HU-06 CA1)", async () => {
    const { ctx, db } = makeTestContext();
    db.technologies.find((t) => t.id === "tec_rust")!.active = false;
    await expect(
      svc.createProject(ctx, newProject({ technologyIds: ["tec_next_js", "tec_nope"] })),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { technologyIds: ["projects.errors.technologyUnknown"] },
    });
    await expect(
      svc.createProject(ctx, newProject({ technologyIds: ["tec_rust"] })),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { technologyIds: ["projects.errors.technologyInactive"] },
    });
    const before = db.projects.length;
    const dto = await svc.createProject(ctx, newProject({ technologyIds: ["tec_next_js"] }));
    expect(dto.stack.map((t) => t.id)).toEqual(["tec_next_js"]);
    expect(db.projects).toHaveLength(before + 1);
  });

  it("stores the links grouped, ordered and re-numbered per group, and refuses a non-http URL", async () => {
    const { ctx } = makeTestContext();
    const dto = await svc.createProject(
      ctx,
      newProject({
        links: [
          { group: "REPOSITORIO", label: "B", url: "https://git.example.com/b", order: 5 },
          { group: "ENTORNO", label: "Prod", url: "https://prod.example.com", order: 0 },
          { group: "REPOSITORIO", label: "A", url: "https://git.example.com/a", order: 1 },
        ],
      }),
    );
    expect(dto.links.map((l) => [l.group, l.label, l.order])).toEqual([
      ["REPOSITORIO", "A", 0],
      ["REPOSITORIO", "B", 1],
      ["ENTORNO", "Prod", 0],
    ]);
    // The schema rejects it first; the service re-checks for callers that skip the parse.
    const unparsed = {
      ...newProject(),
      links: [{ group: "OTRO", label: "x", url: "ftp://files.example.com", order: 0 }],
    } as CreateProjectInput;
    await expect(svc.createProject(ctx, unparsed)).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { "links.0.url": expect.any(Array) },
    });
  });

  it("rejects an unknown tag", async () => {
    const { ctx } = makeTestContext();
    await expect(
      svc.createProject(ctx, newProject({ tagIds: ["tag_nope"] })),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { tagIds: ["projects.errors.tagUnknown"] },
    });
  });
});

describe("updateProject", () => {
  const base = (ctx: Awaited<ReturnType<typeof setup>>["ctx"]) =>
    svc.getProject(ctx, { id: "pry_kairos_web" });
  async function setup() {
    return makeTestContext();
  }

  it("updates the fields, logs an UPDATE diff and keeps long text as 'changed'", async () => {
    const { ctx, db } = await setup();
    const current = await base(ctx);
    const dto = await svc.updateProject(ctx, {
      id: current.id,
      name: "Sitio web Kairos 2",
      summary: current.summary,
      description: { type: "doc", content: [{ type: "paragraph" }] },
      startDate: current.startDate ?? undefined,
      targetEndDate: current.targetEndDate ?? undefined,
      technologyIds: current.stack.map((t) => t.id),
      tagIds: [],
      clients: current.clients.map((c) => ({ clientId: c.client.id, role: c.role ?? undefined })),
    });
    expect(dto.name).toBe("Sitio web Kairos 2");
    expect(dto.tags).toEqual([]);
    const entry = activityOf(db, current.id).at(-1)!;
    expect(entry.action).toBe("UPDATE");
    expect(entry.changes).toMatchObject({
      name: ["Sitio web Kairos Studio", "Sitio web Kairos 2"],
      description: "changed",
      tagIds: [expect.any(String), ""],
    });
    expect(entry.changes).not.toHaveProperty("summary");
  });

  it("logs nothing when nothing changed and refuses an archived or unknown project", async () => {
    const { ctx, db } = await setup();
    const current = await base(ctx);
    const noop = {
      id: current.id,
      name: current.name,
      summary: current.summary,
      description: current.description ?? undefined,
      startDate: current.startDate ?? undefined,
      targetEndDate: current.targetEndDate ?? undefined,
      technologyIds: current.stack.map((t) => t.id),
      tagIds: current.tags.map((t) => t.id),
      clients: current.clients.map((c) => ({ clientId: c.client.id, role: c.role ?? undefined })),
    };
    const before = db.activity.length;
    await svc.updateProject(ctx, noop);
    expect(db.activity).toHaveLength(before);
    await expect(svc.updateProject(ctx, { ...noop, id: "pry_nope" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const archived = db.projects.find((p) => p.archivedAt)!;
    await expect(svc.updateProject(ctx, { ...noop, id: archived.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("keeps the date a status requires: an EN_CURSO project cannot lose its start date", async () => {
    const { ctx } = await setup();
    const current = await base(ctx);
    await expect(
      svc.updateProject(ctx, {
        id: current.id,
        name: current.name,
        summary: current.summary,
        technologyIds: [],
        tagIds: [],
        clients: [{ clientId: "cli_kairos", role: undefined }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { startDate: expect.any(Array) } });
  });

  it("lets a project keep an inactive technology it already carries but not add another", async () => {
    const { ctx, db } = await setup();
    const current = await base(ctx);
    db.technologies.find((t) => t.id === "tec_figma")!.active = false;
    db.technologies.find((t) => t.id === "tec_rust")!.active = false;
    const ids = current.stack.map((t) => t.id);
    expect(ids).toContain("tec_figma");
    await expect(
      svc.setProjectTechnologies(ctx, { projectId: current.id, technologyIds: ids }),
    ).resolves.toMatchObject({});
    await expect(
      svc.setProjectTechnologies(ctx, {
        projectId: current.id,
        technologyIds: [...ids, "tec_rust"],
      }),
    ).rejects.toMatchObject({
      fieldErrors: { technologyIds: ["projects.errors.technologyInactive"] },
    });
  });
});

describe("setProjectClients", () => {
  it("replaces the clients with roles and logs LINK, UNLINK and role changes", async () => {
    const { ctx, db } = makeTestContext();
    const dto = await svc.setProjectClients(ctx, {
      projectId: "pry_kairos_app",
      clients: [
        { clientId: "cli_kairos", role: "Patrocinador" },
        { clientId: "cli_inversiones_tamanaco", role: "Socio" },
      ],
    });
    expect(dto.clients.map((c) => [c.client.id, c.role])).toEqual([
      ["cli_kairos", "Patrocinador"],
      ["cli_inversiones_tamanaco", "Socio"],
    ]);
    const entries = activityOf(db, "pry_kairos_app").map((e) => [e.action, e.metadata?.linkedId]);
    expect(entries).toEqual(
      expect.arrayContaining([
        ["UPDATE", "cli_kairos"],
        ["LINK", "cli_inversiones_tamanaco"],
        ["UNLINK", "cli_hotel_mochima"],
      ]),
    );
    expect(activityOf(db, "pry_kairos_app").find((e) => e.action === "UPDATE")!.changes).toEqual({
      clientRole: ["Contratante", "Patrocinador"],
    });
  });

  it("refuses an empty list, a repeated client and an unknown client", async () => {
    const { ctx } = makeTestContext();
    const run = (clients: { clientId: string; role: string | undefined }[]) =>
      svc.setProjectClients(ctx, { projectId: "pry_kairos_web", clients });
    await expect(run([])).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      run([
        { clientId: "cli_kairos", role: undefined },
        { clientId: "cli_kairos", role: undefined },
      ]),
    ).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(run([{ clientId: "cli_nope", role: undefined }])).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});

describe("setProjectStatus", () => {
  it("allows exactly the transitions of PROJECT_STATUS_TRANSITIONS", async () => {
    for (const from of PROJECT_STATUS_VALUES) {
      for (const to of PROJECT_STATUS_VALUES) {
        const { ctx, db } = makeTestContext();
        const row = db.projects.find((p) => !p.archivedAt)!;
        row.status = from;
        row.startDate = "2026-01-01";
        row.endDate = "2026-06-01";
        const run = svc.setProjectStatus(ctx, {
          id: row.id,
          status: to,
          cancelPendingInstallments: false,
          finishRecurringCharges: false,
          confirm: true,
        });
        if (PROJECT_STATUS_TRANSITIONS[from].includes(to)) {
          await expect(run).resolves.toMatchObject({ project: { status: to } });
        } else {
          await expect(run).rejects.toMatchObject({
            code: "VALIDATION",
            fieldErrors: { status: ["projects.errors.invalidTransition"] },
          });
          expect(row.status).toBe(from);
        }
      }
    }
  });

  it("requires a start date for EN_CURSO and an end date for ENTREGADO (HU-08 CA1–CA2)", async () => {
    const { ctx, db } = makeTestContext();
    const proposal = db.projects.find((p) => p.status === "PROPUESTA")!;
    const noDates = {
      cancelPendingInstallments: false,
      finishRecurringCharges: false,
      confirm: false,
    };
    await expect(
      svc.setProjectStatus(ctx, { id: proposal.id, status: "EN_CURSO", ...noDates }),
    ).rejects.toMatchObject({ fieldErrors: { startDate: expect.any(Array) } });
    const started = await svc.setProjectStatus(ctx, {
      id: proposal.id,
      status: "EN_CURSO",
      startDate: "2026-10-01",
      ...noDates,
    });
    expect(started.project).toMatchObject({ status: "EN_CURSO", startDate: "2026-10-01" });

    const running = db.projects.find((p) => p.status === "EN_CURSO" && p.endDate === null)!;
    await expect(
      svc.setProjectStatus(ctx, { id: running.id, status: "ENTREGADO", ...noDates }),
    ).rejects.toMatchObject({ fieldErrors: { endDate: expect.any(Array) } });
    await expect(
      svc.setProjectStatus(ctx, {
        id: running.id,
        status: "ENTREGADO",
        endDate: "1999-01-01",
        ...noDates,
      }),
    ).rejects.toMatchObject({ fieldErrors: { endDate: expect.any(Array) } });
    const delivered = await svc.setProjectStatus(ctx, {
      id: running.id,
      status: "ENTREGADO",
      endDate: "2026-10-09",
      ...noDates,
    });
    expect(delivered.project).toMatchObject({ status: "ENTREGADO", endDate: "2026-10-09" });
  });

  it("logs STATUS_CHANGE with [before, after] and the dates it set (HU-08 CA4)", async () => {
    const { ctx, db } = makeTestContext();
    await svc.setProjectStatus(ctx, statusInput({ status: "PAUSADO" }));
    const entry = activityOf(db, "pry_kairos_web").at(-1)!;
    expect(entry).toMatchObject({
      action: "STATUS_CHANGE",
      entityType: "PROJECT",
      changes: { status: ["EN_CURSO", "PAUSADO"] },
    });
  });

  it("hints EN_CURSO without a billing plan and MANTENIMIENTO without an active recurring charge", async () => {
    const { ctx, db } = makeTestContext();
    const resumed = await svc.setProjectStatus(ctx, statusInput({ status: "PAUSADO" }));
    expect(resumed.hints).toEqual([]);
    const back = await svc.setProjectStatus(
      ctx,
      statusInput({ status: "EN_CURSO", startDate: "2026-08-01" }),
    );
    expect(back.hints).toEqual(["NO_BILLING_PLAN"]);

    db.billingPlans.push({ id: "bpl_1", projectId: "pry_kairos_web" } as never);
    await svc.setProjectStatus(ctx, statusInput({ status: "PAUSADO" }));
    const withPlan = await svc.setProjectStatus(
      ctx,
      statusInput({ status: "EN_CURSO", startDate: "2026-08-01" }),
    );
    expect(withPlan.hints).toEqual([]);

    const delivered = db.projects.find((p) => p.status === "ENTREGADO" && !p.archivedAt)!;
    const maintenance = await svc.setProjectStatus(ctx, {
      ...statusInput({ status: "MANTENIMIENTO" }),
      id: delivered.id,
    });
    expect(maintenance.hints).toEqual(["SUGGEST_RECURRING_CHARGE"]);

    const other = db.projects.find((p) => p.status === "ENTREGADO" && !p.archivedAt)!;
    seedCharge(db, other.id, "ACTIVO");
    const quiet = await svc.setProjectStatus(ctx, {
      ...statusInput({ status: "MANTENIMIENTO" }),
      id: other.id,
    });
    expect(quiet.hints).toEqual([]);
  });

  it("CANCELADO needs confirm and applies the chosen options to installments and recurring charges", async () => {
    const { ctx, db } = makeTestContext();
    const id = "pry_tornillo_tienda";
    seedInstallment(db, "PENDIENTE", "ins_a");
    seedInstallment(db, "FACTURADA", "ins_b");
    seedCharge(db, id, "ACTIVO");

    await expect(
      svc.setProjectStatus(ctx, {
        id,
        status: "CANCELADO",
        cancelPendingInstallments: true,
        finishRecurringCharges: true,
        confirm: false,
      }),
    ).rejects.toMatchObject({ fieldErrors: { confirm: expect.any(Array) } });
    expect(db.installments.find((i) => i.id === "ins_a")!.status).toBe("PENDIENTE");

    // No options chosen: the project is cancelled and the collections stay as they were.
    const { ctx: ctx2, db: db2 } = makeTestContext();
    seedInstallment(db2, "PENDIENTE", "ins_a");
    seedCharge(db2, id, "ACTIVO");
    await svc.setProjectStatus(ctx2, {
      id,
      status: "CANCELADO",
      cancelPendingInstallments: false,
      finishRecurringCharges: false,
      confirm: true,
    });
    expect(db2.installments[0]!.status).toBe("PENDIENTE");
    expect(db2.recurringCharges[0]!.status).toBe("ACTIVO");

    const result = await svc.setProjectStatus(ctx, {
      id,
      status: "CANCELADO",
      cancelPendingInstallments: true,
      finishRecurringCharges: true,
      confirm: true,
    });
    expect(result.project.status).toBe("CANCELADO");
    expect(db.installments.find((i) => i.id === "ins_a")).toMatchObject({
      status: "CANCELADA",
      cancelledAt: ctx.now.toISOString(),
    });
    expect(db.installments.find((i) => i.id === "ins_b")!.status).toBe("FACTURADA");
    expect(db.recurringCharges[0]).toMatchObject({ status: "FINALIZADO", endDate: "2026-10-09" });
    expect(db.activity.some((e) => e.entityType === "INSTALLMENT" && e.entityId === "ins_a")).toBe(
      true,
    );
    expect(
      db.activity.some((e) => e.entityType === "RECURRING_CHARGE" && e.action === "STATUS_CHANGE"),
    ).toBe(true);
    expect(activityOf(db, id).at(-1)!.metadata).toMatchObject({
      cancelledInstallments: 1,
      finishedRecurringCharges: 1,
    });
    // CANCELADO is final.
    await expect(
      svc.setProjectStatus(ctx, {
        ...statusInput({ status: "EN_CURSO", startDate: "2026-01-01" }),
        id,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("project links", () => {
  const linkIds = (dto: { links: { id: string; group: string }[] }, group: string) =>
    dto.links.filter((l) => l.group === group).map((l) => l.id);

  it("upsert appends new links to their group, edits existing ones and validates the URL (HU-07 CA3)", async () => {
    const { ctx } = makeTestContext();
    const links = await svc.upsertProjectLinks(ctx, {
      projectId: "pry_kairos_web",
      links: [
        {
          group: "REPOSITORIO",
          label: "Infra repo",
          url: "https://git.example.com/infra",
          order: 0,
        },
        {
          id: "plk_kairos_web_1",
          group: "REPOSITORIO",
          label: "Frontend v2",
          url: "https://git.example.com/fe",
          order: 0,
        },
      ],
    });
    const repos = links.filter((l) => l.group === "REPOSITORIO");
    expect(repos.map((l) => [l.label, l.order])).toEqual([
      ["Frontend v2", 0],
      ["CMS", 1],
      ["Infra repo", 2],
    ]);

    await expect(
      svc.upsertProjectLinks(ctx, {
        projectId: "pry_kairos_web",
        links: [{ group: "OTRO", label: "x", url: "javascript:alert(1)", order: 0 }],
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { "links.0.url": expect.any(Array) },
    });
    await expect(
      svc.upsertProjectLinks(ctx, {
        projectId: "pry_kairos_web",
        links: [
          { id: "plk_nope", group: "OTRO", label: "x", url: "https://x.example.com", order: 0 },
        ],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("moves a link to another group at the end of that group", async () => {
    const { ctx } = makeTestContext();
    const links = await svc.upsertProjectLinks(ctx, {
      projectId: "pry_kairos_web",
      links: [
        {
          id: "plk_kairos_web_1",
          group: "ENTORNO",
          label: "Frontend",
          url: "https://x.example.com",
          order: 0,
        },
      ],
    });
    expect(links.filter((l) => l.group === "ENTORNO").map((l) => [l.label, l.order])).toEqual([
      ["Staging", 0],
      ["Producción", 1],
      ["Frontend", 2],
    ]);
    expect(links.filter((l) => l.group === "REPOSITORIO").map((l) => l.order)).toEqual([0]);
  });

  it("reorders within one group, persists it and leaves the other groups alone", async () => {
    const { ctx, db } = makeTestContext();
    const before = await svc.getProject(ctx, { id: "pry_kairos_web" });
    const repos = linkIds(before, "REPOSITORIO");
    const entorno = before.links.filter((l) => l.group === "ENTORNO");
    const links = await svc.reorderProjectLinks(ctx, {
      projectId: "pry_kairos_web",
      group: "REPOSITORIO",
      orderedLinkIds: [...repos].reverse(),
    });
    expect(linkIds({ links }, "REPOSITORIO")).toEqual([...repos].reverse());
    expect(links.filter((l) => l.group === "ENTORNO")).toEqual(entorno);
    const reread = await svc.getProject(ctx, { id: "pry_kairos_web" });
    expect(linkIds(reread, "REPOSITORIO")).toEqual([...repos].reverse());
    expect(activityOf(db, "pry_kairos_web").at(-1)).toMatchObject({
      action: "UPDATE",
      changes: { links: "changed" },
      metadata: { group: "REPOSITORIO" },
    });
  });

  it("refuses a reorder that does not list exactly the ids of the group", async () => {
    const { ctx } = makeTestContext();
    const [first] = linkIds(await svc.getProject(ctx, { id: "pry_kairos_web" }), "REPOSITORIO");
    for (const orderedLinkIds of [[first!], [first!, "plk_kairos_web_3"], [first!, "plk_nope"]]) {
      await expect(
        svc.reorderProjectLinks(ctx, {
          projectId: "pry_kairos_web",
          group: "REPOSITORIO",
          orderedLinkIds,
        }),
      ).rejects.toMatchObject({
        code: "VALIDATION",
        fieldErrors: { orderedLinkIds: expect.any(Array) },
      });
    }
  });

  it("removes a link and closes the gap in its group", async () => {
    const { ctx } = makeTestContext();
    const links = await svc.removeProjectLink(ctx, {
      projectId: "pry_kairos_web",
      linkId: "plk_kairos_web_1",
    });
    expect(links.filter((l) => l.group === "REPOSITORIO").map((l) => [l.label, l.order])).toEqual([
      ["CMS", 0],
    ]);
    await expect(
      svc.removeProjectLink(ctx, { projectId: "pry_kairos_web", linkId: "plk_kairos_web_1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("archiveProject / archiveProjects", () => {
  it("archives, records who and logs DELETE; archiving twice is NOT_FOUND", async () => {
    const { ctx, db } = makeTestContext();
    const result = await svc.archiveProject(ctx, { id: "pry_tornillo_tienda", confirm: false });
    expect(result).toEqual({ id: "pry_tornillo_tienda", archivedAt: ctx.now.toISOString() });
    expect(db.projects.find((p) => p.id === "pry_tornillo_tienda")).toMatchObject({
      deletedById: "usr_test",
    });
    expect(activityOf(db, "pry_tornillo_tienda").at(-1)!.action).toBe("DELETE");
    await expect(
      svc.archiveProject(ctx, { id: "pry_tornillo_tienda", confirm: false }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("asks for confirm when billing is active (INTEGRITY_LOCK) and archives with it", async () => {
    const { ctx, db } = makeTestContext();
    seedCharge(db, "pry_tornillo_tienda", "ACTIVO");
    await expect(
      svc.archiveProject(ctx, { id: "pry_tornillo_tienda", confirm: false }),
    ).rejects.toMatchObject({
      code: "INTEGRITY_LOCK",
      message: "projects.errors.archiveNeedsConfirm",
    });
    await expect(
      svc.archiveProject(ctx, { id: "pry_tornillo_tienda", confirm: true }),
    ).resolves.toMatchObject({
      id: "pry_tornillo_tienda",
    });
  });

  it("archives many or none", async () => {
    const { ctx, db } = makeTestContext();
    seedCharge(db, "pry_aurora_pos", "ACTIVO");
    await expect(
      svc.archiveProjects(ctx, { ids: ["pry_tornillo_tienda", "pry_aurora_pos"], confirm: false }),
    ).rejects.toMatchObject({ code: "INTEGRITY_LOCK" });
    expect(db.projects.find((p) => p.id === "pry_tornillo_tienda")!.archivedAt).toBeNull();
    const done = await svc.archiveProjects(ctx, {
      ids: ["pry_tornillo_tienda", "pry_aurora_pos"],
      confirm: true,
    });
    expect(done.archived.map((a) => a.id)).toEqual(["pry_tornillo_tienda", "pry_aurora_pos"]);
  });
});

describe("listProjects", () => {
  it("hides archived projects, honouring includeArchived only for roles that can restore", async () => {
    const { ctx: owner, db } = makeTestContext("OWNER");
    const archived = db.projects.filter((p) => p.archivedAt).length;
    expect(archived).toBeGreaterThan(0);
    const visible = await svc.listProjects(owner, filter());
    expect(visible.items.every((p) => p.archivedAt === null)).toBe(true);
    const all = await svc.listProjects(owner, filter({ includeArchived: true }));
    expect(all.total).toBe(visible.total + archived);

    const { ctx: member } = makeTestContext("MEMBER");
    const asMember = await svc.listProjects(member, filter({ includeArchived: true }));
    expect(asMember.total).toBe(visible.total);
  });

  it("filters by technology (HU-06 CA2), status, client, tag, delivery window and billing plan", async () => {
    const { ctx, db } = makeTestContext();
    const withNext = db.projects.filter(
      (p) => !p.archivedAt && p.technologyIds.includes("tec_next_js"),
    );
    const byTech = await svc.listProjects(ctx, filter({ technologyId: "tec_next_js" }));
    expect(byTech.items.map((p) => p.id).sort()).toEqual(withNext.map((p) => p.id).sort());
    expect(byTech.items.every((p) => p.stack.some((t) => t.id === "tec_next_js"))).toBe(true);
    const union = await svc.listProjects(
      ctx,
      filter({ technologyId: ["tec_next_js", "tec_flutter"] }),
    );
    expect(union.total).toBeGreaterThan(byTech.total);

    const byStatus = await svc.listProjects(ctx, filter({ status: ["PROPUESTA", "PAUSADO"] }));
    expect(byStatus.items.every((p) => ["PROPUESTA", "PAUSADO"].includes(p.status))).toBe(true);

    const byClient = await svc.listProjects(ctx, filter({ clientId: "cli_hotel_mochima" }));
    expect(byClient.items.map((p) => p.id)).toContain("pry_kairos_app");
    expect(
      byClient.items.every((p) => p.clients.some((c) => c.client.id === "cli_hotel_mochima")),
    ).toBe(true);

    const byTag = await svc.listProjects(ctx, filter({ tagId: "tag_urgente" }));
    expect(byTag.items.map((p) => p.id)).toContain("pry_solaris_portal");

    const window = await svc.listProjects(
      ctx,
      filter({ deliveryFrom: "2026-10-10", deliveryTo: "2026-10-30" }),
    );
    expect(window.items.map((p) => p.id)).toContain("pry_tlaloc_ruteo");
    expect(
      window.items.every(
        (p) => p.targetEndDate! >= "2026-10-10" && p.targetEndDate! <= "2026-10-30",
      ),
    ).toBe(true);

    db.billingPlans.push({ id: "bpl_1", projectId: "pry_kairos_web" } as never);
    const noPlan = await svc.listProjects(ctx, filter({ withoutBillingPlan: true }));
    expect(noPlan.items.map((p) => p.id)).not.toContain("pry_kairos_web");
    expect(noPlan.total).toBe((await svc.listProjects(ctx, filter())).total - 1);
  });

  it("searches by code, name and client, sorts and paginates", async () => {
    const { ctx } = makeTestContext();
    const byName = await svc.listProjects(ctx, filter({ q: "kairos" }));
    expect(byName.items.length).toBeGreaterThanOrEqual(3);
    const byCode = await svc.listProjects(ctx, filter({ q: "PRY-0001" }));
    expect(byCode.items.map((p) => p.code)).toEqual(["PRY-0001"]);
    const sorted = await svc.listProjects(ctx, filter({ sort: "name:asc" }));
    const names = sorted.items.map((p) => p.name);
    expect(names).toEqual(
      [...names].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base", numeric: true })),
    );
    const page = await svc.listProjects(ctx, projectFilterSchema.parse({ pageSize: 25, page: 2 }));
    expect(page).toMatchObject({ page: 2, pageSize: 25 });
    expect(page.items).toHaveLength(Math.min(25, page.total - 25));
  });

  it("computes the USD headline from the finance collections (PD-4)", async () => {
    const { ctx, db } = makeTestContext();
    const id = "pry_kairos_web";
    expect((await svc.getProject(ctx, { id })).toInvoiceUsd).toBe("0.00");

    db.billingPlans.push({
      id: "bpl_1",
      projectId: id,
      currency: "USD",
      contractAmount: "5000.00",
    } as never);
    db.invoices.push({
      id: "inv_1",
      isDraft: false,
      status: "EMITIDA",
      usdRate: "1.00000000",
      lines: [
        { project: { id }, netAmount: "1500.00" },
        { project: null, netAmount: "999.00" },
      ],
    } as never);
    db.invoices.push({
      id: "inv_2",
      isDraft: false,
      status: "ANULADA",
      usdRate: "1.00000000",
      lines: [{ project: { id }, netAmount: "700.00" }],
    } as never);
    db.payments.push({ id: "pay_1", status: "CONFIRMADO" } as never);
    db.paymentAllocations.push({
      id: "alc_1",
      paymentId: "pay_1",
      invoice: { id: "inv_1" },
      amountUsd: "600.00",
    } as never);
    const dto = await svc.getProject(ctx, { id });
    expect(dto).toMatchObject({
      contractedValueUsd: "5000.00",
      invoicedUsd: "1500.00",
      collectedUsd: "600.00",
      toInvoiceUsd: "3500.00",
      hasBillingPlan: true,
    });
    const row = (await svc.listProjects(ctx, filter({ q: "PRY-0001" }))).items[0]!;
    expect(row.toInvoiceUsd).toBe("3500.00");
    const sorted = await svc.listProjects(ctx, filter({ sort: "toInvoiceUsd:desc" }));
    expect(sorted.items[0]!.id).toBe(id);
  });
});

describe("getProject / getProjectsOverview", () => {
  it("assembles the detail with chips and refs, sorted links, and NOT_FOUND for an unknown id", async () => {
    const { ctx, db } = makeTestContext();
    const dto = await svc.getProject(ctx, { id: "pry_tamanaco_erp" });
    expect(dto.clients).toHaveLength(3);
    expect(dto.clients[0]!.client).toMatchObject({
      type: "CLIENT",
      id: "cli_inversiones_tamanaco",
    });
    expect(dto.stack[0]).toMatchObject({ id: "tec_nestjs", name: "NestJS" });
    expect(dto.tags.length).toBeGreaterThan(0);
    expect(dto).not.toHaveProperty("deletedById");

    // A renamed technology shows its new name: rows hold ids only (PD-3).
    db.technologies.find((t) => t.id === "tec_nestjs")!.name = "NestJS 11";
    expect((await svc.getProject(ctx, { id: "pry_tamanaco_erp" })).stack[0]!.name).toBe(
      "NestJS 11",
    );
    await expect(svc.getProject(ctx, { id: "pry_nope" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const archived = db.projects.find((p) => p.archivedAt)!;
    expect((await svc.getProject(ctx, { id: archived.id })).archivedAt).not.toBeNull();
  });

  it("builds the overview from non-archived projects", async () => {
    const { ctx, db } = makeTestContext();
    const overview = await svc.getProjectsOverview(ctx, {});
    const live = db.projects.filter((p) => !p.archivedAt);
    expect(Object.keys(overview.countByStatus).sort()).toEqual([...PROJECT_STATUS_VALUES].sort());
    expect(Object.values(overview.countByStatus).reduce((a, b) => a + b, 0)).toBe(live.length);
    expect(overview.upcomingDeliveries[0]!.id).toBe("pry_tlaloc_ruteo");
    expect(overview.upcomingDeliveries.every((p) => p.targetEndDate! >= "2026-10-09")).toBe(true);
    expect(overview.withoutBillingPlan.length).toBeGreaterThan(0);
    const usage = (id: string) => live.filter((p) => p.technologyIds.includes(id)).length;
    const counts = overview.topTechnologies.map((t) => t.projectCount);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(counts[0]).toBe(Math.max(...db.technologies.map((t) => usage(t.id))));
    expect(overview.topTechnologies.every((t) => usage(t.technology.id) === t.projectCount)).toBe(
      true,
    );
    expect(overview.highestToInvoice).toEqual([]);
  });
});

// ───────────────────────────── Wave 2 fix round (package 2.9) ─────────────────────────────

const imageDoc = (fileId: string) => ({
  type: "doc" as const,
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Con imagen" }] },
    { type: "image", attrs: { fileId, src: `/api/files/${fileId}/download` } },
  ],
});

describe("type contract (F12)", () => {
  it("satisfies ProjectsService over the mock context, financials aside", () => {
    const service = svc satisfies Omit<ProjectsService<MockServiceContext>, "getProjectFinancials">;
    expect(typeof service.createProject).toBe("function");
  });
});

describe("money sorters (F3, C15)", () => {
  it("orders the stored USD strings numerically, in both directions", async () => {
    const { ctx, db } = makeTestContext();
    const [a, b, c] = db.projects.filter((row) => !row.archivedAt);
    const bill = (projectId: string, contractAmount: string) =>
      db.billingPlans.push({ id: `bpl_${projectId}`, projectId, currency: "USD", contractAmount } as never);
    bill(a!.id, "9.00");
    bill(b!.id, "10.00");
    bill(c!.id, "100.00");
    const ids = [a!.id, b!.id, c!.id];
    const sorted = async (sort: string) =>
      (await svc.listProjects(ctx, filter({ sort })))
        .items.filter((row) => ids.includes(row.id))
        .map((row) => row.contractedValueUsd);
    expect(await sorted("contractedValueUsd:asc")).toEqual(["9.00", "10.00", "100.00"]);
    expect(await sorted("contractedValueUsd:desc")).toEqual(["100.00", "10.00", "9.00"]);
  });
});

describe("getProject on an archived project (F6, C19)", () => {
  it.each([
    ["OWNER", true],
    ["ADMIN", true],
    ["MEMBER", false],
    ["VIEWER", false],
  ] as const)("%s reads it: %s", async (role, allowed) => {
    const { ctx, db } = makeTestContext(role);
    db.projects.find((row) => row.id === "pry_kairos_web")!.archivedAt = "2026-10-01T00:00:00.000Z";
    const read = svc.getProject(ctx, { id: "pry_kairos_web" });
    if (allowed) await expect(read).resolves.toMatchObject({ id: "pry_kairos_web" });
    else await expect(read).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("unknown link id (F10)", () => {
  it("answers a bare NOT_FOUND that does not echo the id", async () => {
    const { ctx } = makeTestContext();
    const error = await svc
      .upsertProjectLinks(ctx, {
        projectId: "pry_kairos_web",
        links: [{ id: "plk_nope", group: "OTRO", label: "x", url: "https://x.example.com", order: 0 }],
      })
      .catch((e: unknown) => e as { code: string; message: string; fieldErrors?: unknown });
    expect(error).toMatchObject({ code: "NOT_FOUND" });
    expect(JSON.stringify(error)).not.toContain("plk_nope");
    expect((error as { message: string }).message).not.toContain("plk_nope");
    expect((error as { fieldErrors?: unknown }).fieldErrors).toBeUndefined();
  });
});

describe("rich-text images (CR-B2, C14/C23)", () => {
  const withDescription = (id: string, description: unknown) => ({
    id,
    name: "Sitio",
    summary: "Resumen",
    description,
    technologyIds: [],
    tagIds: [],
    clients: [{ clientId: "cli_kairos" }],
  });

  it("accepts READY images and refuses unknown or not-ready ones on create and update", async () => {
    const { ctx, db } = makeTestContext();
    const ready = db.files.find((file) => file.status === "READY")!;
    const created = await svc.createProject(ctx, newProject({ description: imageDoc(ready.id) }));
    expect(created.description).toBeTruthy();

    await expect(
      svc.createProject(ctx, newProject({ description: imageDoc("fil_missing") })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const pending = { ...ready, id: "fil_pending", status: "PENDING" as const };
    db.files.push(pending);
    await expect(
      svc.createProject(ctx, newProject({ description: imageDoc(pending.id) })),
    ).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { description: expect.any(Array) } });

    await expect(
      svc.updateProject(ctx, withDescription(created.id, imageDoc(pending.id)) as never),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      svc.updateProject(ctx, withDescription(created.id, imageDoc("fil_missing")) as never),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("financial headline placeholder (CR-B3, C16)", () => {
  it("does not move a non-USD plan when a newer rate appears", async () => {
    const { ctx, db } = makeTestContext();
    db.billingPlans.push({
      id: "bpl_eur",
      projectId: "pry_kairos_web",
      currency: "EUR",
      contractAmount: "1000.00",
    } as never);
    const before = await svc.getProject(ctx, { id: "pry_kairos_web" });
    db.exchangeRates.push({
      currency: "EUR",
      date: "2026-10-09",
      usdRate: "1.50000000",
    } as never);
    const after = await svc.getProject(ctx, { id: "pry_kairos_web" });
    expect(after.contractedValueUsd).toBe(before.contractedValueUsd);
    expect(after.toInvoiceUsd).toBe(before.toInvoiceUsd);
  });
});

describe("tag and technology diffs (CR-B4, C1)", () => {
  it("logs sorted names joined with ', ', never ids", async () => {
    const { ctx, db } = makeTestContext();
    const current = await svc.getProject(ctx, { id: "pry_kairos_web" });
    const techs = db.technologies.filter((t) => t.active).slice(0, 2);
    const tags = db.tags.slice(0, 2);
    await svc.updateProject(ctx, {
      id: current.id,
      name: current.name,
      summary: current.summary,
      startDate: current.startDate ?? undefined,
      targetEndDate: current.targetEndDate ?? undefined,
      technologyIds: techs.map((t) => t.id).reverse(),
      tagIds: tags.map((t) => t.id).reverse(),
      clients: current.clients.map((c) => ({ clientId: c.client.id, role: c.role ?? undefined })),
    } as never);
    const changes = activityOf(db, current.id).at(-1)!.changes as Record<string, [string, string]>;
    const sortedJoin = (names: string[]) =>
      names.sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })).join(", ");
    expect(changes.technologyIds![1]).toBe(sortedJoin(techs.map((t) => t.name)));
    expect(changes.tagIds![1]).toBe(sortedJoin(tags.map((t) => t.name)));
    expect(JSON.stringify(changes)).not.toMatch(/tec_|tag_/);
  });
});
