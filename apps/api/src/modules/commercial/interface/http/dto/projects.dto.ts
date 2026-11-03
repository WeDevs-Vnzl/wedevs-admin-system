import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type {
  ProjectDetailView,
  ProjectLinkRecord,
  ProjectListRowView,
} from '../../../application/use-cases/project-views';
import { toEntityRefResponse } from './contacts.dto';
import { entityRefResponseSchema } from '../../../../../shared/interface/error-envelope';
import {
  PROJECT_LINK_GROUP_VALUES,
  PROJECT_STATUS_VALUES,
  TECH_CATEGORY_VALUES,
} from '../../../../../shared/domain/enums';
import {
  dateOnlySchema,
  decimalStringSchema,
  idSchema,
  timestampSchema,
  VALIDATION_MESSAGES,
} from '../../../../../shared/interface/common.schemas';
import {
  createListQueryDto,
  createListQuerySchema,
} from '../../../../../shared/interface/list-query.dto';
import { richTextDocSchema } from '../../../../../shared/interface/rich-text.schema';

/**
 * Request and response shapes of `/projects` (the FE `projects` validators, shape and bounds only).
 * Trimming, the required/length rules of name and summary, the URL rule, the stack and client checks
 * and the status machine are domain rules answered as `VALIDATION` / `NOT_FOUND`, so their keys and
 * `fieldErrors` paths are the mock's (`links.<i>.url`, `technologyIds`, `clients`…).
 */

const projectStatusSchema = z.enum(PROJECT_STATUS_VALUES);
const linkGroupSchema = z.enum(PROJECT_LINK_GROUP_VALUES);

/** Up to `max` distinct ids. */
function uniqueIds(max: number) {
  return z
    .array(idSchema)
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: VALIDATION_MESSAGES.invalidOption,
    });
}

export const projectClientInputSchema = z.object({
  clientId: idSchema,
  role: z.string().max(200).nullish(),
});

/** At least one client (the domain answers `validation.required` on `clients`), none repeated. */
export const projectClientsInputSchema = z
  .array(projectClientInputSchema)
  .max(30)
  .refine((clients) => new Set(clients.map((c) => c.clientId)).size === clients.length, {
    message: VALIDATION_MESSAGES.invalidOption,
  });

export const projectLinkInputSchema = z.object({
  /** Present when editing an existing link. */
  id: idSchema.optional(),
  group: linkGroupSchema,
  label: z.string().max(500),
  url: z.string().max(4096),
  order: z.number().int().min(0).max(1000).default(0),
});

const projectFieldsShape = {
  name: z.string().max(500),
  summary: z.string().max(5000),
  description: richTextDocSchema.nullish(),
  startDate: dateOnlySchema.nullish(),
  targetEndDate: dateOnlySchema.nullish(),
  endDate: dateOnlySchema.nullish(),
  technologyIds: uniqueIds(60).default([]),
  tagIds: uniqueIds(50).default([]),
};

export const createProjectSchema = z.object({
  ...projectFieldsShape,
  clients: projectClientsInputSchema,
  status: projectStatusSchema.default('PROPUESTA'),
  links: z.array(projectLinkInputSchema).max(100).default([]),
});
export class CreateProjectDto extends createZodDto(createProjectSchema) {}

/** `PATCH /projects/{id}`: the full editable state (status and links have their own routes). */
export const updateProjectSchema = z.object({
  ...projectFieldsShape,
  clients: projectClientsInputSchema,
});
export class UpdateProjectDto extends createZodDto(updateProjectSchema) {}

export const setProjectClientsSchema = z.object({ clients: projectClientsInputSchema });
export class SetProjectClientsDto extends createZodDto(setProjectClientsSchema) {}

export const setProjectTechnologiesSchema = z.object({ technologyIds: uniqueIds(60) });
export class SetProjectTechnologiesDto extends createZodDto(setProjectTechnologiesSchema) {}

export const upsertProjectLinksSchema = z.object({
  links: z.array(projectLinkInputSchema).min(1).max(100),
});
export class UpsertProjectLinksDto extends createZodDto(upsertProjectLinksSchema) {}

export const reorderProjectLinksSchema = z.object({
  group: linkGroupSchema,
  orderedLinkIds: z
    .array(idSchema)
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: VALIDATION_MESSAGES.invalidOption,
    }),
});
export class ReorderProjectLinksDto extends createZodDto(reorderProjectLinksSchema) {}

/** `CANCELADO` needs `confirm` (the domain answers `validation.required` on `confirm`). */
export const setProjectStatusSchema = z.object({
  status: projectStatusSchema,
  startDate: dateOnlySchema.optional(),
  endDate: dateOnlySchema.optional(),
  cancelPendingInstallments: z.boolean().default(false),
  finishRecurringCharges: z.boolean().default(false),
  confirm: z.boolean().default(false),
});
export class SetProjectStatusDto extends createZodDto(setProjectStatusSchema) {}

export const archiveProjectSchema = z.object({ confirm: z.boolean().default(false) });
export class ArchiveProjectDto extends createZodDto(archiveProjectSchema) {}

export const archiveProjectsSchema = z.object({
  ids: uniqueIds(500).refine((ids) => ids.length >= 1, { message: VALIDATION_MESSAGES.required }),
  confirm: z.boolean().default(false),
});
export class ArchiveProjectsDto extends createZodDto(archiveProjectsSchema) {}

export const projectIdParamsSchema = z.object({ id: idSchema });
export class ProjectIdParamsDto extends createZodDto(projectIdParamsSchema) {}

export const projectLinkParamsSchema = z.object({ id: idSchema, linkId: idSchema });
export class ProjectLinkParamsDto extends createZodDto(projectLinkParamsSchema) {}

/** Sortable fields: the money ones need `canSeeFinancials` (the use case answers 422 otherwise). */
export const PROJECT_SORT_FIELDS = [
  'code',
  'name',
  'status',
  'startDate',
  'targetEndDate',
  'createdAt',
  'contractedValueUsd',
  'invoicedUsd',
  'collectedUsd',
  'toInvoiceUsd',
] as const;

const projectListOptions = {
  sortFields: PROJECT_SORT_FIELDS,
  defaultSort: { field: 'code', direction: 'desc' },
  filters: {
    status: projectStatusSchema,
    clientId: idSchema,
    technologyId: idSchema,
    tagId: idSchema,
    deliveryFrom: dateOnlySchema,
    deliveryTo: dateOnlySchema,
    /** Additive facet (`api-contract.md` §7): only projects with no billing plan; `true` is the one value. */
    withoutBillingPlan: z.enum(['true']),
  },
} as const;

/** `GET /projects` query: paging, `q`, `sort` and the facets (HU-06 CA2 included). */
export const projectListQuerySchema = createListQuerySchema(projectListOptions);
export class ListProjectsQueryDto extends createListQueryDto(projectListOptions) {}

// ───────────────────────────── Responses ─────────────────────────────

const technologyChipSchema = z.object({
  id: z.string(),
  name: z.string(),
  nameEn: z.string().nullable(),
  category: z.enum(TECH_CATEGORY_VALUES),
  iconSlug: z.string().nullable(),
  color: z.string().nullable(),
});

const tagChipSchema = z.object({ id: z.string(), name: z.string(), color: z.string() });

const projectClientSchema = z.object({
  client: entityRefResponseSchema,
  role: z.string().nullable(),
});

export const projectLinkSchema = z.object({
  id: z.string(),
  group: linkGroupSchema,
  label: z.string(),
  url: z.string(),
  order: z.number().int().nonnegative(),
});
export class ProjectLinkDto extends createZodDto(projectLinkSchema) {}

export const projectLinksResponseSchema = z.object({ links: z.array(projectLinkSchema) });
export class ProjectLinksResponseDto extends createZodDto(projectLinksResponseSchema) {}

/** USD decimal strings; `null` without `canSeeFinancials` (C13). */
const moneyHeadline = {
  contractedValueUsd: decimalStringSchema.nullable(),
  invoicedUsd: decimalStringSchema.nullable(),
  collectedUsd: decimalStringSchema.nullable(),
  toInvoiceUsd: decimalStringSchema.nullable(),
};

export const projectListRowSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  clients: z.array(projectClientSchema),
  status: projectStatusSchema,
  startDate: z.string().nullable(),
  targetEndDate: z.string().nullable(),
  stack: z.array(technologyChipSchema),
  tags: z.array(tagChipSchema),
  archivedAt: timestampSchema.nullable(),
  ...moneyHeadline,
});

export const projectDetailSchema = projectListRowSchema.extend({
  summary: z.string(),
  description: z
    .object({ type: z.literal('doc'), content: z.array(z.unknown()).optional() })
    .nullable(),
  endDate: z.string().nullable(),
  links: z.array(projectLinkSchema),
  hasBillingPlan: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export class ProjectDetailDto extends createZodDto(projectDetailSchema) {}

export const projectListResponseSchema = z.object({
  items: z.array(projectListRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  pageCount: z.number().int(),
});
export class ProjectListResponseDto extends createZodDto(projectListResponseSchema) {}

export const projectStatusChangeSchema = z.object({
  project: projectDetailSchema,
  hints: z.array(z.enum(['NO_BILLING_PLAN', 'SUGGEST_RECURRING_CHARGE'])),
});
export class ProjectStatusChangeDto extends createZodDto(projectStatusChangeSchema) {}

export const archivedProjectSchema = z.object({ id: z.string(), archivedAt: timestampSchema });
export class ArchivedProjectDto extends createZodDto(archivedProjectSchema) {}

export const archivedProjectsSchema = z.object({ archived: z.array(archivedProjectSchema) });
export class ArchivedProjectsDto extends createZodDto(archivedProjectsSchema) {}

export const restoredProjectSchema = z.object({
  entity: entityRefResponseSchema,
  restoredAt: timestampSchema,
});
export class RestoredProjectDto extends createZodDto(restoredProjectSchema) {}

// ───────────────────────────── Output mapping (shared with the MCP tools) ─────────────────────────────

export function toProjectLinkResponse(link: ProjectLinkRecord) {
  return { id: link.id, group: link.group, label: link.label, url: link.url, order: link.order };
}

export function toProjectRowResponse(row: ProjectListRowView) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    clients: row.clients.map((item) => ({
      client: toEntityRefResponse(item.client),
      role: item.role,
    })),
    status: row.status,
    startDate: row.startDate,
    targetEndDate: row.targetEndDate,
    stack: row.stack.map((tech) => ({ ...tech })),
    tags: row.tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    contractedValueUsd: row.contractedValueUsd,
    invoicedUsd: row.invoicedUsd,
    collectedUsd: row.collectedUsd,
    toInvoiceUsd: row.toInvoiceUsd,
  };
}

export function toProjectDetailResponse(view: ProjectDetailView): ProjectDetailDto {
  return {
    ...toProjectRowResponse(view),
    summary: view.summary,
    description: view.description
      ? { type: 'doc', ...(view.description.content ? { content: view.description.content } : {}) }
      : null,
    endDate: view.endDate,
    links: view.links.map(toProjectLinkResponse),
    hasBillingPlan: view.hasBillingPlan,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}
