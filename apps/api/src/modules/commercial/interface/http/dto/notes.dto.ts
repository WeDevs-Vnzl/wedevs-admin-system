import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { NOTE_LINK_ENTITY_TYPE_VALUES } from '../../../application/ports/note-target.port';
import { NOTE_SORT_FIELDS } from '../../../application/ports/note.repository.port';
import {
  dateOnlySchema,
  idSchema,
  timestampSchema,
} from '../../../../../shared/interface/common.schemas';
import {
  createListQueryDto,
  createListQuerySchema,
} from '../../../../../shared/interface/list-query.dto';
import { nonEmptyRichTextDocSchema } from '../../../../../shared/interface/rich-text.schema';
import { ENTITY_TYPE_VALUES } from '../../../../../shared/domain/enums';

/**
 * Request and response shapes of `/notes` (the FE `notes` validators, shape and length only). Rich text
 * passes the allowlist here (C4) and again in the use case; ownership, existence and the rules about links
 * and files are answered by the use cases as `VALIDATION` / `NOT_FOUND` / `CONFLICT` / `INTEGRITY_LOCK`.
 */

const REQUIRED = 'validation.required';

export const noteLinkEntityTypeSchema = z.enum(NOTE_LINK_ENTITY_TYPE_VALUES);

export const noteLinkTargetSchema = z.object({
  entityType: noteLinkEntityTypeSchema,
  entityId: idSchema,
});

const titleSchema = z.string().max(200).nullish();
const tagIdsSchema = z.array(idSchema).max(50).default([]);

export const createNoteDtoSchema = z.object({
  title: titleSchema,
  content: nonEmptyRichTextDocSchema,
  links: z.array(noteLinkTargetSchema).min(1, REQUIRED).max(20),
  tagIds: tagIdsSchema,
  pinned: z.boolean().default(false),
  attachmentFileIds: z.array(idSchema).max(20).default([]),
});
export class CreateNoteDto extends createZodDto(createNoteDtoSchema) {}

export const updateNoteDtoSchema = z.object({
  title: titleSchema,
  content: nonEmptyRichTextDocSchema,
  tagIds: tagIdsSchema,
});
export class UpdateNoteDto extends createZodDto(updateNoteDtoSchema) {}

export const pinNoteDtoSchema = z.object({ pinned: z.boolean() });
export class PinNoteDto extends createZodDto(pinNoteDtoSchema) {}

/** Body of `POST /notes/{id}/links` and `POST /notes/{id}/unlink`. */
export class NoteLinkTargetDto extends createZodDto(noteLinkTargetSchema) {}

export const attachNoteFileDtoSchema = z.object({ fileId: idSchema });
export class AttachNoteFileDto extends createZodDto(attachNoteFileDtoSchema) {}

export const noteIdParamsSchema = z.object({ id: idSchema });
export class NoteIdParamsDto extends createZodDto(noteIdParamsSchema) {}

const noteListOptions = {
  sortFields: NOTE_SORT_FIELDS,
  defaultSort: { field: 'createdAt', direction: 'desc' },
  filters: {
    authorId: idSchema,
    tagId: idSchema,
    linkedEntityType: noteLinkEntityTypeSchema,
    entityType: noteLinkEntityTypeSchema,
    entityId: idSchema,
    pinned: z.enum(['true', 'false']),
    createdFrom: dateOnlySchema,
    createdTo: dateOnlySchema,
  },
} as const;

/**
 * `GET /notes` query: paging, `q` over title and plain text, `sort` (`pinned` is the feed order),
 * `archived` (honoured for the trash roles only) and the filters. `entityType` + `entityId` select the
 * feed of one record and must come together; with them the default sort becomes pinned first, then newest.
 */
export const noteListQuerySchema = createListQuerySchema(noteListOptions);
export class ListNotesQueryDto extends createListQueryDto(noteListOptions) {}

export const noteAuthorSchema = z.object({
  id: z.string(),
  name: z.string(),
  imageUrl: z.string().nullable(),
});

export const noteTagChipSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});

export const noteEntityRefSchema = z.object({
  id: z.string(),
  type: z.enum(ENTITY_TYPE_VALUES),
  code: z.string().optional(),
  label: z.string(),
});

export const noteFileSchema = z.object({
  id: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  status: z.string(),
  uploadedById: z.string(),
  createdAt: timestampSchema,
});

const noteCommonShape = {
  id: z.string(),
  title: z.string().nullable(),
  author: noteAuthorSchema,
  pinned: z.boolean(),
  tags: z.array(noteTagChipSchema),
  links: z.array(noteEntityRefSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  archivedAt: timestampSchema.nullable(),
};

export const noteDetailSchema = z.object({
  ...noteCommonShape,
  /** The sanitized Tiptap document; image nodes carry `fileId` (+ `alt`), never `src`. */
  content: z.record(z.string(), z.unknown()),
  /** Plain-text projection, used for previews and search. */
  contentText: z.string(),
  attachments: z.array(noteFileSchema),
});
export class NoteDetailDto extends createZodDto(noteDetailSchema) {}

export const noteListRowSchema = z.object({
  ...noteCommonShape,
  /** First characters of `contentText`, for the collapsed card. */
  excerpt: z.string(),
  attachmentCount: z.number().int().nonnegative(),
});

export const noteListResponseSchema = z.object({
  items: z.array(noteListRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  pageCount: z.number().int(),
});
export class NoteListResponseDto extends createZodDto(noteListResponseSchema) {}

export const archivedNoteSchema = z.object({ id: z.string(), archivedAt: timestampSchema });
export class ArchivedNoteDto extends createZodDto(archivedNoteSchema) {}

export class RestoredNoteDto extends createZodDto(noteEntityRefSchema) {}
