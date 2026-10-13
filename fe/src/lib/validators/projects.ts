import { z } from "./zod";
import {
  VALIDATION_MESSAGES,
  dateOnlySchema,
  entityRefSchema,
  idSchema,
  listQuerySchema,
  type Paginated,
} from "./common";
import { projectLinkGroupSchema, projectStatusSchema, type ProjectStatus } from "./enums";
import { moneyAmountSchema } from "./money";
import { richTextDocSchema } from "./notes";
import { technologyChipSchema } from "./technologies";
import {
  bulkIdsSchema,
  facetOf,
  httpUrlSchema,
  optionalText,
  requiredText,
  tagChipSchema,
  timestampSchema,
  uniqueIds,
  withSortFields,
} from "./tags";
import type { ArchivedRecordDTO } from "./trash";

/**
 * Projects (PRD §8.3). Rules: at least one client (no principal client), each link with an optional
 * free-text role; `summary` is required and at most 280 characters; `startDate` is required to move to
 * `EN_CURSO` and `endDate` (actual delivery) to `ENTREGADO`; links are URLs grouped by an enum; the
 * stack accepts technology ids from the catalog only. Money is USD/decimal strings (C15).
 */

export const PROJECT_SUMMARY_MAX = 280;

// ───────────────────────────── Status transitions ─────────────────────────────

/**
 * Allowed transitions (PRD §8.3 diagram). `CANCELADO` is reachable from any other status and is final.
 */
export const PROJECT_STATUS_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  PROPUESTA: ["EN_CURSO", "CANCELADO"],
  EN_CURSO: ["PAUSADO", "ENTREGADO", "CANCELADO"],
  PAUSADO: ["EN_CURSO", "CANCELADO"],
  ENTREGADO: ["MANTENIMIENTO", "CANCELADO"],
  MANTENIMIENTO: ["CANCELADO"],
  CANCELADO: [],
};

export function canTransitionProject(from: ProjectStatus, to: ProjectStatus): boolean {
  return PROJECT_STATUS_TRANSITIONS[from].includes(to);
}

/** Non-blocking suggestions a status change returns as data (PRD §8.3). */
export const PROJECT_STATUS_HINT_VALUES = [
  /** Moved to `EN_CURSO` without a billing plan: warn, do not block. */
  "NO_BILLING_PLAN",
  /** Moved to `MANTENIMIENTO` with no active recurring charge: suggest creating one. */
  "SUGGEST_RECURRING_CHARGE",
] as const;
export const projectStatusHintSchema = z.enum(PROJECT_STATUS_HINT_VALUES);
export type ProjectStatusHint = z.infer<typeof projectStatusHintSchema>;

// ───────────────────────────── Parts: clients, links ─────────────────────────────

/** A client of the project with an optional free-text role ("Contratante", "Usuario final"). */
export const projectClientInputSchema = z.object({
  clientId: idSchema,
  role: optionalText(80),
});
export type ProjectClientInput = z.infer<typeof projectClientInputSchema>;

/** At least one client, none repeated. */
export const projectClientsInputSchema = z
  .array(projectClientInputSchema)
  .min(1)
  .max(30)
  .refine((clients) => new Set(clients.map((c) => c.clientId)).size === clients.length, {
    message: VALIDATION_MESSAGES.invalidOption,
  });

/** One project link: group, label, valid `http(s)` URL and order inside its group. */
export const projectLinkInputSchema = z.object({
  /** Present when editing an existing link. */
  id: idSchema.optional(),
  group: projectLinkGroupSchema,
  label: requiredText(80),
  url: httpUrlSchema,
  order: z.number().int().min(0).max(1000).default(0),
});
export type ProjectLinkInput = z.infer<typeof projectLinkInputSchema>;

// ───────────────────────────── Inputs ─────────────────────────────

const projectFieldsShape = {
  name: requiredText(120),
  clients: projectClientsInputSchema,
  summary: z.string().trim().min(1).max(PROJECT_SUMMARY_MAX, VALIDATION_MESSAGES.tooLong),
  /** Tiptap JSON; the service derives the plain-text projection for search. */
  description: richTextDocSchema.optional(),
  startDate: dateOnlySchema.optional(),
  targetEndDate: dateOnlySchema.optional(),
  endDate: dateOnlySchema.optional(),
  /** Technology ids from the catalog; free values are not accepted. */
  technologyIds: uniqueIds({ max: 60 }).default([]),
  tagIds: uniqueIds({ max: 50 }).default([]),
};

/** Dates must not run backwards: the target and actual end are on or after the start. */
function checkProjectDates(
  value: {
    startDate?: string | undefined;
    targetEndDate?: string | undefined;
    endDate?: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  for (const field of ["targetEndDate", "endDate"] as const) {
    const end = value[field];
    if (value.startDate && end && end < value.startDate) {
      ctx.addIssue({ code: "custom", message: VALIDATION_MESSAGES.invalidDate, path: [field] });
    }
  }
}

/** Status-driven required dates (`EN_CURSO` → start, `ENTREGADO` → actual end). */
function checkStatusDates(
  value: { status: ProjectStatus; startDate?: string | undefined; endDate?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.status === "EN_CURSO" && !value.startDate) {
    ctx.addIssue({ code: "custom", message: VALIDATION_MESSAGES.required, path: ["startDate"] });
  }
  if (value.status === "ENTREGADO" && !value.endDate) {
    ctx.addIssue({ code: "custom", message: VALIDATION_MESSAGES.required, path: ["endDate"] });
  }
}

/** `createProject`. The code (`PRY-0001`) is allocated by the service; status defaults to `PROPUESTA`. */
export const createProjectInputSchema = z
  .object({
    ...projectFieldsShape,
    status: projectStatusSchema.default("PROPUESTA"),
    links: z.array(projectLinkInputSchema).max(100).default([]),
  })
  .superRefine(checkProjectDates)
  .superRefine(checkStatusDates);
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type CreateProjectFormValues = z.input<typeof createProjectInputSchema>;

/**
 * `updateProject`: every editable field except status (`setProjectStatus`), links
 * (`upsertProjectLinks`) and the stack/clients shortcuts, which this form also submits.
 */
export const updateProjectInputSchema = z
  .object({ id: idSchema, ...projectFieldsShape })
  .superRefine(checkProjectDates);
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;
export type UpdateProjectFormValues = z.input<typeof updateProjectInputSchema>;

/**
 * `setProjectStatus`. `startDate` is required to enter `EN_CURSO` and `endDate` (actual delivery) to
 * enter `ENTREGADO`. `CANCELADO` asks for confirmation (`confirm`) and can cancel the project's
 * `PENDIENTE` installments and finish its recurring charges. The allowed `from → to` pairs are
 * `PROJECT_STATUS_TRANSITIONS`; the service checks them against the stored status.
 */
export const setProjectStatusInputSchema = z
  .object({
    id: idSchema,
    status: projectStatusSchema,
    startDate: dateOnlySchema.optional(),
    endDate: dateOnlySchema.optional(),
    cancelPendingInstallments: z.boolean().default(false),
    finishRecurringCharges: z.boolean().default(false),
    confirm: z.boolean().default(false),
  })
  .superRefine(checkStatusDates)
  .superRefine((value, ctx) => {
    if (value.status === "CANCELADO" && !value.confirm) {
      ctx.addIssue({ code: "custom", message: VALIDATION_MESSAGES.required, path: ["confirm"] });
    }
  });
export type SetProjectStatusInput = z.infer<typeof setProjectStatusInputSchema>;

/** `setProjectClients`: replaces the project's clients (at least one). */
export const setProjectClientsInputSchema = z.object({
  projectId: idSchema,
  clients: projectClientsInputSchema,
});
export type SetProjectClientsInput = z.infer<typeof setProjectClientsInputSchema>;

/** `setProjectTechnologies`: replaces the stack; technology ids only. */
export const setProjectTechnologiesInputSchema = z.object({
  projectId: idSchema,
  technologyIds: uniqueIds({ max: 60 }),
});
export type SetProjectTechnologiesInput = z.infer<typeof setProjectTechnologiesInputSchema>;

/** `upsertProjectLinks`: creates the links without id and updates the ones with id; removes none. */
export const upsertProjectLinksInputSchema = z.object({
  projectId: idSchema,
  links: z.array(projectLinkInputSchema).min(1).max(100),
});
export type UpsertProjectLinksInput = z.infer<typeof upsertProjectLinksInputSchema>;

/** `reorderProjectLinks`: the ids of one group, in the dragged order. */
export const reorderProjectLinksInputSchema = z.object({
  projectId: idSchema,
  group: projectLinkGroupSchema,
  orderedLinkIds: uniqueIds({ min: 1, max: 100 }),
});
export type ReorderProjectLinksInput = z.infer<typeof reorderProjectLinksInputSchema>;

/** `removeProjectLink` (UI delete button of a link card). */
export const removeProjectLinkInputSchema = z.object({ projectId: idSchema, linkId: idSchema });
export type RemoveProjectLinkInput = z.infer<typeof removeProjectLinkInputSchema>;

/** `archiveProject`. Archiving a project with active billing or invoices asks for `confirm`. */
export const archiveProjectInputSchema = z.object({
  id: idSchema,
  confirm: z.boolean().default(false),
});
export type ArchiveProjectInput = z.infer<typeof archiveProjectInputSchema>;

export const archiveProjectsInputSchema = z.object({
  ids: bulkIdsSchema,
  confirm: z.boolean().default(false),
});
export type ArchiveProjectsInput = z.infer<typeof archiveProjectsInputSchema>;

export const projectIdInputSchema = z.object({ id: idSchema });
export type ProjectIdInput = z.infer<typeof projectIdInputSchema>;

// ───────────────────────────── Filters ─────────────────────────────

export const PROJECT_SORT_FIELDS = [
  "code",
  "name",
  "status",
  "startDate",
  "targetEndDate",
  "contractedValueUsd",
  "invoicedUsd",
  "collectedUsd",
  "toInvoiceUsd",
  "createdAt",
] as const;

export const projectFilterSchema = withSortFields(
  listQuerySchema.extend({
    status: facetOf(projectStatusSchema),
    clientId: facetOf(idSchema),
    technologyId: facetOf(idSchema),
    tagId: facetOf(idSchema),
    /** Delivery window over `targetEndDate`. */
    deliveryFrom: dateOnlySchema.optional(),
    deliveryTo: dateOnlySchema.optional(),
    /** Only projects with no billing plan (overview shortcut). */
    withoutBillingPlan: z.union([z.boolean(), z.stringbool()]).optional(),
  }),
  PROJECT_SORT_FIELDS,
);
export type ProjectFilter = z.infer<typeof projectFilterSchema>;
export type ProjectFilterInput = z.input<typeof projectFilterSchema>;

// ───────────────────────────── DTOs ─────────────────────────────

const usdTotalSchema = moneyAmountSchema({ sign: "nonNegative" });

/** Client of a project as shown in tables and the detail. */
export const projectClientSchema = z.object({
  client: entityRefSchema,
  role: z.string().nullable(),
});
export type ProjectClientDTO = z.infer<typeof projectClientSchema>;

export const projectLinkSchema = z.object({
  id: idSchema,
  group: projectLinkGroupSchema,
  label: z.string(),
  url: z.string(),
  order: z.number().int().nonnegative(),
});
export type ProjectLinkDTO = z.infer<typeof projectLinkSchema>;

/** Financial headline of a project (side panel and table columns), USD decimal strings. */
export const projectFinancialHeadlineSchema = z.object({
  contractedValueUsd: usdTotalSchema,
  invoicedUsd: usdTotalSchema,
  collectedUsd: usdTotalSchema,
  toInvoiceUsd: usdTotalSchema,
});
export type ProjectFinancialHeadlineDTO = z.infer<typeof projectFinancialHeadlineSchema>;

/** Row of the projects table (PRD §8.3 "Tabla"). */
export const projectListRowSchema = projectFinancialHeadlineSchema.extend({
  id: idSchema,
  code: z.string(),
  name: z.string(),
  clients: z.array(projectClientSchema),
  status: projectStatusSchema,
  startDate: dateOnlySchema.nullable(),
  targetEndDate: dateOnlySchema.nullable(),
  stack: z.array(technologyChipSchema),
  tags: z.array(tagChipSchema),
  archivedAt: timestampSchema.nullable(),
});
export type ProjectListRowDTO = z.infer<typeof projectListRowSchema>;

export const projectDetailSchema = projectFinancialHeadlineSchema.extend({
  id: idSchema,
  code: z.string(),
  name: z.string(),
  summary: z.string(),
  description: richTextDocSchema.nullable(),
  status: projectStatusSchema,
  startDate: dateOnlySchema.nullable(),
  targetEndDate: dateOnlySchema.nullable(),
  endDate: dateOnlySchema.nullable(),
  clients: z.array(projectClientSchema),
  stack: z.array(technologyChipSchema),
  links: z.array(projectLinkSchema),
  tags: z.array(tagChipSchema),
  /** Whether a billing plan exists (warning on `EN_CURSO` without one). */
  hasBillingPlan: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  archivedAt: timestampSchema.nullable(),
});
export type ProjectDetailDTO = z.infer<typeof projectDetailSchema>;

/** Output of `setProjectStatus`: the project plus the non-blocking hints (PRD §8.3). */
export const projectStatusChangeResultSchema = z.object({
  project: projectDetailSchema,
  hints: z.array(projectStatusHintSchema),
});
export type ProjectStatusChangeResultDTO = z.infer<typeof projectStatusChangeResultSchema>;

/** `/projects` overview (PRD §8.3 "Overview"). */
export const projectsOverviewSchema = z.object({
  countByStatus: z.record(projectStatusSchema, z.number().int().nonnegative()),
  upcomingDeliveries: z.array(projectListRowSchema),
  withoutBillingPlan: z.array(projectListRowSchema),
  topTechnologies: z.array(
    z.object({ technology: technologyChipSchema, projectCount: z.number().int().positive() }),
  ),
  highestToInvoice: z.array(projectListRowSchema),
});
export type ProjectsOverviewDTO = z.infer<typeof projectsOverviewSchema>;

export const getProjectsOverviewInputSchema = z.object({}).strict();
export type GetProjectsOverviewInput = z.infer<typeof getProjectsOverviewInputSchema>;

// ───────────────────────────── Services (PRD §12 `projects`) ─────────────────────────────

/**
 * `projects` services. Every service is `fn(ctx, input) → Promise<DTO>` (C9, C11). The summary DTO of
 * `getProjectFinancials` (PRD §8.4.4) belongs to the billing contract, so it is a type parameter here
 * (`ProjectFinancialsDTO`) instead of an import. `listProjects` / `getProject` / `getProjectsOverview`
 * / `removeProjectLink` / `archiveProjects` are the screen counterparts that PRD §12 leaves implicit.
 */
export type ProjectsService<Ctx = unknown, ProjectFinancialsDTO = unknown> = {
  createProject: (ctx: Ctx, input: CreateProjectInput) => Promise<ProjectDetailDTO>;
  updateProject: (ctx: Ctx, input: UpdateProjectInput) => Promise<ProjectDetailDTO>;
  setProjectStatus: (
    ctx: Ctx,
    input: SetProjectStatusInput,
  ) => Promise<ProjectStatusChangeResultDTO>;
  setProjectClients: (ctx: Ctx, input: SetProjectClientsInput) => Promise<ProjectDetailDTO>;
  setProjectTechnologies: (
    ctx: Ctx,
    input: SetProjectTechnologiesInput,
  ) => Promise<ProjectDetailDTO>;
  upsertProjectLinks: (ctx: Ctx, input: UpsertProjectLinksInput) => Promise<ProjectLinkDTO[]>;
  reorderProjectLinks: (ctx: Ctx, input: ReorderProjectLinksInput) => Promise<ProjectLinkDTO[]>;
  removeProjectLink: (ctx: Ctx, input: RemoveProjectLinkInput) => Promise<ProjectLinkDTO[]>;
  archiveProject: (ctx: Ctx, input: ArchiveProjectInput) => Promise<ArchivedRecordDTO>;
  archiveProjects: (
    ctx: Ctx,
    input: ArchiveProjectsInput,
  ) => Promise<{ archived: ArchivedRecordDTO[] }>;
  listProjects: (ctx: Ctx, input: ProjectFilter) => Promise<Paginated<ProjectListRowDTO>>;
  getProject: (ctx: Ctx, input: ProjectIdInput) => Promise<ProjectDetailDTO>;
  getProjectFinancials: (ctx: Ctx, input: ProjectIdInput) => Promise<ProjectFinancialsDTO>;
  getProjectsOverview: (ctx: Ctx, input: GetProjectsOverviewInput) => Promise<ProjectsOverviewDTO>;
};
