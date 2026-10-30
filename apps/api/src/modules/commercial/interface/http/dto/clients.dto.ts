import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CLIENT_KIND_VALUES, CLIENT_STATUS_VALUES } from '../../../../../shared/domain/enums';
import {
  dateOnlySchema,
  idSchema,
  timestampSchema,
} from '../../../../../shared/interface/common.schemas';
import { createListQueryDto } from '../../../../../shared/interface/list-query.dto';
import {
  CLIENT_LIMITS,
  CLIENT_SORT_FIELDS,
  COUNTRY_CODE_VALUES,
  TAG_IDS_MAX,
  type ClientDetailView,
  type ClientListRow,
} from '../../../application/use-cases/client-support';
import { contactViewSchema, tagChipSchema, toContactResponse } from './contacts.dto';

/**
 * Request and response shapes of the clients routes (the FE `clients` validators, shape and length only).
 * Trimming, the RIF and phone grammars, "legal name for companies" and the tag checks are domain rules
 * answered as `VALIDATION`. Money fields are decimal strings and `null` without `canSeeFinancials` (C13).
 */

const clientKindSchema = z.enum(CLIENT_KIND_VALUES);
const clientStatusSchema = z.enum(CLIENT_STATUS_VALUES);

const clientFieldsShape = {
  kind: clientKindSchema,
  tradeName: z.string().max(CLIENT_LIMITS.tradeName),
  legalName: z.string().max(CLIENT_LIMITS.legalName).nullish(),
  taxId: z.string().max(CLIENT_LIMITS.taxId),
  country: z.string().max(2),
  address: z.string().max(CLIENT_LIMITS.address),
  phone: z.string().max(20),
  email: z.string().max(254).nullish(),
  website: z.string().max(2048).nullish(),
  tagIds: z.array(idSchema).max(TAG_IDS_MAX).default([]),
};

export const createClientDtoSchema = z.object({
  ...clientFieldsShape,
  status: clientStatusSchema.default('PROSPECTO'),
});
export const updateClientDtoSchema = z.object(clientFieldsShape);
export class CreateClientDto extends createZodDto(createClientDtoSchema) {}
export class UpdateClientDto extends createZodDto(updateClientDtoSchema) {}

export class SetClientStatusDto extends createZodDto(z.object({ status: clientStatusSchema })) {}
export class ArchiveClientDto extends createZodDto(
  z.object({ confirm: z.boolean().default(false) }),
) {}
export class ArchiveClientsDto extends createZodDto(
  z.object({
    ids: z.array(idSchema).min(1).max(500),
    confirm: z.boolean().default(false),
  }),
) {}

export class ClientIdParamsDto extends createZodDto(z.object({ id: idSchema })) {}

/** `GET /clients`: paging, `q`, `sort`, `archived` and the facets of HU-03. */
export class ListClientsQueryDto extends createListQueryDto({
  sortFields: CLIENT_SORT_FIELDS,
  defaultSort: { field: 'code', direction: 'asc' },
  filters: {
    status: clientStatusSchema,
    kind: clientKindSchema,
    country: z.enum(COUNTRY_CODE_VALUES),
    tagId: idSchema,
    createdFrom: dateOnlySchema,
    createdTo: dateOnlySchema,
    hasOverdue: z.enum(['true', 'false']),
  },
}) {}

/** `GET /clients/search`: a typeahead, not a paginated envelope (contract choice 7). */
export class SearchClientsQueryDto extends createZodDto(
  z.object({
    q: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((value) => (value ? value : undefined)),
    limit: z.coerce.number().int().min(1).max(20).optional(),
  }),
) {}

const clientCoreShape = {
  id: z.string(),
  code: z.string(),
  kind: clientKindSchema,
  tradeName: z.string(),
  country: z.string(),
  status: clientStatusSchema,
};

export const clientListRowSchema = z.object({
  ...clientCoreShape,
  projectCount: z.number().int().nonnegative(),
  /** USD decimal string; `null` without `canSeeFinancials`. */
  totalInvoicedUsd: z.string().nullable(),
  /** USD decimal string; `null` without `canSeeFinancials`. */
  receivableUsd: z.string().nullable(),
  tags: z.array(tagChipSchema),
  lastActivityAt: timestampSchema.nullable(),
  archivedAt: timestampSchema.nullable(),
});

export const clientListResponseSchema = z.object({
  items: z.array(clientListRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  pageCount: z.number().int(),
});
export class ClientListResponseDto extends createZodDto(clientListResponseSchema) {}

export const clientDetailSchema = z.object({
  ...clientCoreShape,
  legalName: z.string(),
  taxId: z.string(),
  address: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  activatedAt: timestampSchema.nullable(),
  tags: z.array(tagChipSchema),
  /** Live contacts, primary first. */
  contacts: z.array(contactViewSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  archivedAt: timestampSchema.nullable(),
});
export class ClientDetailDto extends createZodDto(clientDetailSchema) {}

export const clientArchiveResultSchema = z.object({
  id: z.string(),
  archivedAt: timestampSchema,
  archivedContacts: z.number().int().nonnegative(),
});
export class ClientArchiveResultDto extends createZodDto(clientArchiveResultSchema) {}
export class ClientsArchiveResultDto extends createZodDto(
  z.object({ archived: z.array(clientArchiveResultSchema) }),
) {}

export function toClientListRowResponse(row: ClientListRow): z.infer<typeof clientListRowSchema> {
  const { client } = row;
  return {
    id: client.id,
    code: client.code,
    kind: client.kind,
    tradeName: client.tradeName,
    country: client.country,
    status: client.status,
    projectCount: row.projectCount,
    totalInvoicedUsd: row.totalInvoicedUsd,
    receivableUsd: row.receivableUsd,
    tags: row.tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
    archivedAt: client.deletedAt?.toISOString() ?? null,
  };
}

export function toClientDetailResponse(view: ClientDetailView): z.infer<typeof clientDetailSchema> {
  const { client } = view;
  return {
    id: client.id,
    code: client.code,
    kind: client.kind,
    tradeName: client.tradeName,
    legalName: client.legalName,
    taxId: client.taxId,
    country: client.country,
    address: client.address,
    phone: client.phone,
    email: client.email,
    website: client.website,
    status: client.status,
    activatedAt: client.activatedAt?.toISOString() ?? null,
    tags: view.tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    contacts: view.contacts.map(toContactResponse),
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
    archivedAt: client.deletedAt?.toISOString() ?? null,
  };
}
