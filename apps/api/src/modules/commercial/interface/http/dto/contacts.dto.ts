import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { idSchema, timestampSchema } from '../../../../../shared/interface/common.schemas';
import type { EntityRef } from '../../../../../shared/domain/entity-ref';
import { entityRefResponseSchema } from '../../../../../shared/interface/error-envelope';
import { createListQueryDto } from '../../../../../shared/interface/list-query.dto';
import { TAG_IDS_MAX } from '../../../application/use-cases/client-support';
import {
  CONTACT_LIMITS,
  CONTACT_SORT_FIELDS,
  type ContactView,
} from '../../../application/use-cases/contact-support';

/**
 * Request and response shapes of the contacts routes (the FE `contacts` validators, shape and length
 * only). Trimming, the E.164 and e-mail grammars, "e-mail or phone" and the tag checks are domain rules
 * answered as `VALIDATION`.
 */

const contactFieldsShape = {
  fullName: z.string().max(CONTACT_LIMITS.fullName),
  position: z.string().max(CONTACT_LIMITS.position).nullish(),
  email: z.string().max(254).nullish(),
  phone: z.string().max(20).nullish(),
  isPrimary: z.boolean().default(false),
  tagIds: z.array(idSchema).max(TAG_IDS_MAX).default([]),
};

export const createContactDtoSchema = z.object(contactFieldsShape);
export const updateContactDtoSchema = z.object(contactFieldsShape);
export class CreateContactDto extends createZodDto(createContactDtoSchema) {}
export class UpdateContactDto extends createZodDto(updateContactDtoSchema) {}

export const contactIdParamsSchema = z.object({ id: idSchema });
export class ContactIdParamsDto extends createZodDto(contactIdParamsSchema) {}
export class ClientContactsParamsDto extends createZodDto(z.object({ id: idSchema })) {}

/** `GET /clients/{id}/contacts`: paging, `q`, `sort` (primary first by default) and `archived`. */
export class ListContactsQueryDto extends createListQueryDto({
  sortFields: CONTACT_SORT_FIELDS,
  defaultSort: { field: 'isPrimary', direction: 'desc' },
}) {}

/** `GET /contacts/search`: a typeahead, not a paginated envelope (contract choice 7). */
export const searchContactsQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? value : undefined)),
  clientId: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});
export class SearchContactsQueryDto extends createZodDto(searchContactsQuerySchema) {}

export const tagChipSchema = z.object({ id: z.string(), name: z.string(), color: z.string() });

export const contactViewSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  fullName: z.string(),
  position: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  isPrimary: z.boolean(),
  tags: z.array(tagChipSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  archivedAt: timestampSchema.nullable(),
});
export class ContactViewDto extends createZodDto(contactViewSchema) {}

export const contactListResponseSchema = z.object({
  items: z.array(contactViewSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  pageCount: z.number().int(),
});
export class ContactListResponseDto extends createZodDto(contactListResponseSchema) {}

export const contactArchivedSchema = z.object({ id: z.string(), archivedAt: timestampSchema });
export class ContactArchivedDto extends createZodDto(contactArchivedSchema) {}

/** `EntityRef` of a typeahead hit; `code` is `null` when the entity has none (`api-contract.md` §2). */
// A fresh object over the same fields: the envelope's schema carries the OpenAPI id `EntityRef`, which a DTO class of another name may not reuse.
export class EntityRefDto extends createZodDto(z.object(entityRefResponseSchema.shape)) {}

export function toEntityRefResponse(ref: EntityRef): EntityRefDto {
  return { type: ref.type, id: ref.id, code: ref.code ?? null, label: ref.label };
}

/** Output model to the wire shape: the fields listed in the DTO, dates as ISO strings. */
export function toContactResponse(view: ContactView): z.infer<typeof contactViewSchema> {
  const { contact, tags } = view;
  return {
    id: contact.id,
    clientId: contact.clientId,
    fullName: contact.fullName,
    position: contact.position,
    email: contact.email,
    phone: contact.phone,
    isPrimary: contact.isPrimary,
    tags: tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
    archivedAt: contact.deletedAt?.toISOString() ?? null,
  };
}
