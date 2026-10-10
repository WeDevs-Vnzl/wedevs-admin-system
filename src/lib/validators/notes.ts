import { z } from "./zod";
import {
  VALIDATION_MESSAGES,
  dateOnlySchema,
  entityRefSchema,
  idSchema,
  listQuerySchema,
  type Paginated,
} from "./common";
import { fileDtoSchema } from "./files";
import {
  facetOf,
  isHttpUrl,
  optionalText,
  tagChipSchema,
  timestampSchema,
  uniqueIds,
  withSortFields,
} from "./tags";
import type { ArchivedRecordDTO } from "./trash";
import { userRefSchema } from "./users";

/**
 * Rich text (Tiptap JSON) and notes (PRD §8.10).
 *
 * Rich text is stored as Tiptap JSON. The schema is the allowlist of the editor (C4): only the listed
 * node and mark types are accepted and link marks may only point at `http(s):` / `mailto:` URLs, so a
 * pasted `<script>`, `<iframe>` or `javascript:` link is rejected before it is stored. Rendering still
 * goes through Tiptap's renderer with the same extension allowlist.
 */

// ───────────────────────────── Rich text ─────────────────────────────

export const RICH_TEXT_NODE_TYPES = [
  "doc",
  "paragraph",
  "text",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "hardBreak",
  "horizontalRule",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "image",
] as const;

export const RICH_TEXT_MARK_TYPES = ["bold", "italic", "strike", "code", "link"] as const;

export interface RichTextMark {
  type: (typeof RICH_TEXT_MARK_TYPES)[number];
  attrs?: Record<string, unknown> | undefined;
}

export interface RichTextNode {
  type: (typeof RICH_TEXT_NODE_TYPES)[number];
  attrs?: Record<string, unknown> | undefined;
  content?: RichTextNode[] | undefined;
  marks?: RichTextMark[] | undefined;
  text?: string | undefined;
}

const richTextMarkSchema: z.ZodType<RichTextMark> = z
  .object({
    type: z.enum(RICH_TEXT_MARK_TYPES),
    attrs: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((mark, ctx) => {
    if (mark.type !== "link") return;
    const href = mark.attrs?.href;
    const safe =
      typeof href === "string" && (isHttpUrl(href) || /^mailto:[^\s@]+@[^\s@]+$/i.test(href));
    if (!safe) {
      ctx.addIssue({
        code: "custom",
        message: VALIDATION_MESSAGES.invalidFormat,
        path: ["attrs", "href"],
      });
    }
  });

/**
 * Attributes of an `image` node (C4): the image is always an uploaded file, referenced by `fileId`. `src`
 * is optional and, when present, must be the file's own download route, so a pasted `javascript:`, `data:`
 * or external URL never gets stored. Any other attribute (`srcset`, `onerror`, `style`…) is rejected.
 */
const richTextImageAttrsSchema = z.strictObject({
  fileId: idSchema,
  alt: z.string().max(200).optional(),
  src: z.string().optional(),
});

const richTextNodeSchema: z.ZodType<RichTextNode> = z.lazy(() =>
  z
    .object({
      type: z.enum(RICH_TEXT_NODE_TYPES),
      attrs: z.record(z.string(), z.unknown()).optional(),
      content: z.array(richTextNodeSchema).optional(),
      marks: z.array(richTextMarkSchema).optional(),
      text: z.string().optional(),
    })
    .superRefine((node, ctx) => {
      if (node.type !== "image") return;
      const attrs = richTextImageAttrsSchema.safeParse(node.attrs);
      if (!attrs.success) {
        ctx.addIssue({
          code: "custom",
          message: VALIDATION_MESSAGES.invalidFormat,
          path: ["attrs"],
        });
        return;
      }
      const { fileId, src } = attrs.data;
      if (src !== undefined && src !== `/api/files/${fileId}/download`) {
        ctx.addIssue({
          code: "custom",
          message: VALIDATION_MESSAGES.invalidFormat,
          path: ["attrs", "src"],
        });
      }
    }),
);

/** Serialized size cap of one rich-text document. */
export const RICH_TEXT_MAX_BYTES = 500_000;

/** A Tiptap document (`{ type: "doc", content: [...] }`) that only uses allowlisted nodes and marks. */
export const richTextDocSchema = z
  .object({
    type: z.literal("doc"),
    content: z.array(richTextNodeSchema).optional(),
  })
  .refine((doc) => JSON.stringify(doc).length <= RICH_TEXT_MAX_BYTES, {
    message: VALIDATION_MESSAGES.tooLong,
  });
export type RichTextDoc = z.infer<typeof richTextDocSchema>;

/** `true` when the document has visible text or an image (an empty paragraph is not content). */
export function richTextHasContent(node: {
  type?: string;
  text?: string | undefined;
  content?: readonly unknown[] | undefined;
}): boolean {
  if (node.type === "text") return (node.text ?? "").trim().length > 0;
  if (node.type === "image" || node.type === "horizontalRule") return true;
  return (node.content ?? []).some((child) => richTextHasContent(child as RichTextNode));
}

/** A rich-text document with something in it (notes must not be blank). */
export const nonEmptyRichTextDocSchema = richTextDocSchema.refine(richTextHasContent, {
  message: VALIDATION_MESSAGES.required,
});

// ───────────────────────────── Link targets ─────────────────────────────

/** Entities a note can be linked to (PRD §8.10). */
export const NOTE_LINK_ENTITY_TYPE_VALUES = [
  "CLIENT",
  "CONTACT",
  "PROJECT",
  "DOCUMENT",
  "INVOICE",
  "PAYMENT",
  "EXPENSE",
] as const;
export const noteLinkEntityTypeSchema = z.enum(NOTE_LINK_ENTITY_TYPE_VALUES);
export type NoteLinkEntityType = z.infer<typeof noteLinkEntityTypeSchema>;

export const noteLinkTargetSchema = z.object({
  entityType: noteLinkEntityTypeSchema,
  entityId: idSchema,
});
export type NoteLinkTarget = z.infer<typeof noteLinkTargetSchema>;

/** Link list: no repeated target. */
function uniqueTargets(max: number) {
  return z
    .array(noteLinkTargetSchema)
    .max(max)
    .refine(
      (targets) =>
        new Set(targets.map((t) => `${t.entityType}:${t.entityId}`)).size === targets.length,
      { message: VALIDATION_MESSAGES.invalidOption },
    );
}

// ───────────────────────────── Inputs ─────────────────────────────

/** Notes shown without a title use the first words of the content. */
const noteTitleSchema = optionalText(200);

/**
 * `createNote`. At least one link (a note hangs from a record); content must not be blank; attachments
 * are `READY` files from the uploader (pasted images become attachments).
 */
export const createNoteInputSchema = z.object({
  title: noteTitleSchema,
  content: nonEmptyRichTextDocSchema,
  links: uniqueTargets(20).min(1),
  tagIds: uniqueIds({ max: 50 }).default([]),
  pinned: z.boolean().default(false),
  attachmentFileIds: uniqueIds({ max: 20 }).default([]),
});
export type CreateNoteInput = z.infer<typeof createNoteInputSchema>;
export type CreateNoteFormValues = z.input<typeof createNoteInputSchema>;

/** `updateNote`: title, content and tags. The author never changes (immutable). */
export const updateNoteInputSchema = z.object({
  id: idSchema,
  title: noteTitleSchema,
  content: nonEmptyRichTextDocSchema,
  tagIds: uniqueIds({ max: 50 }).default([]),
});
export type UpdateNoteInput = z.infer<typeof updateNoteInputSchema>;

/** `pinNote`: pinned notes show first in an entity's feed. */
export const pinNoteInputSchema = z.object({ id: idSchema, pinned: z.boolean() });
export type PinNoteInput = z.infer<typeof pinNoteInputSchema>;

/** `linkNote` / `unlinkNote`. A note keeps at least one link (the service refuses to remove the last). */
export const linkNoteInputSchema = z.object({ noteId: idSchema, target: noteLinkTargetSchema });
export type LinkNoteInput = z.infer<typeof linkNoteInputSchema>;
export const unlinkNoteInputSchema = linkNoteInputSchema;
export type UnlinkNoteInput = z.infer<typeof unlinkNoteInputSchema>;

/** `attachFile`: attaches an uploaded (`READY`) file to the note. */
export const attachFileInputSchema = z.object({ noteId: idSchema, fileId: idSchema });
export type AttachFileInput = z.infer<typeof attachFileInputSchema>;

/**
 * `archiveNote` (soft delete). Members may archive only their own notes (PRD §4.3): the service checks
 * the author; the contract is the same for every role.
 */
export const archiveNoteInputSchema = z.object({ id: idSchema });
export type ArchiveNoteInput = z.infer<typeof archiveNoteInputSchema>;

export const noteIdInputSchema = z.object({ id: idSchema });
export type NoteIdInput = z.infer<typeof noteIdInputSchema>;

// ───────────────────────────── Filters ─────────────────────────────

export const NOTE_SORT_FIELDS = ["createdAt", "updatedAt", "title", "pinned"] as const;

/**
 * Notes table (`/notes`) and the per-entity feed. The feed sets `entityType` + `entityId` (both or
 * neither); the global table filters by author, tag, linked entity type and dates.
 */
export const noteFilterSchema = withSortFields(
  listQuerySchema
    .extend({
      authorId: facetOf(idSchema),
      tagId: facetOf(idSchema),
      /** Notes linked to at least one record of these types. */
      linkedEntityType: facetOf(noteLinkEntityTypeSchema),
      /** Feed of one record: pair with `entityId`. */
      entityType: noteLinkEntityTypeSchema.optional(),
      entityId: idSchema.optional(),
      pinned: z.union([z.boolean(), z.stringbool()]).optional(),
      createdFrom: dateOnlySchema.optional(),
      createdTo: dateOnlySchema.optional(),
    })
    .refine((query) => (query.entityType === undefined) === (query.entityId === undefined), {
      message: VALIDATION_MESSAGES.required,
      path: ["entityId"],
    }),
  NOTE_SORT_FIELDS,
);
export type NoteFilter = z.infer<typeof noteFilterSchema>;
export type NoteFilterInput = z.input<typeof noteFilterSchema>;

// ───────────────────────────── DTOs ─────────────────────────────

export const noteDetailSchema = z.object({
  id: idSchema,
  title: z.string().nullable(),
  content: richTextDocSchema,
  /** Plain-text projection, used for previews and search. */
  contentText: z.string(),
  author: userRefSchema,
  pinned: z.boolean(),
  tags: z.array(tagChipSchema),
  links: z.array(entityRefSchema),
  attachments: z.array(fileDtoSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  archivedAt: timestampSchema.nullable(),
});
export type NoteDetailDTO = z.infer<typeof noteDetailSchema>;

/** Row of the notes table and card of an entity's feed (PRD §8.10). */
export const noteListRowSchema = z.object({
  id: idSchema,
  title: z.string().nullable(),
  /** First characters of `contentText`, for the collapsed card. */
  excerpt: z.string(),
  author: userRefSchema,
  pinned: z.boolean(),
  tags: z.array(tagChipSchema),
  links: z.array(entityRefSchema),
  attachmentCount: z.number().int().nonnegative(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  archivedAt: timestampSchema.nullable(),
});
export type NoteListRowDTO = z.infer<typeof noteListRowSchema>;

// ───────────────────────────── Services (PRD §12 `notes`) ─────────────────────────────

/**
 * `notes` services. Every service is `fn(ctx, input) → Promise<DTO>` (C9, C11). `listNotes` / `getNote`
 * are the read counterparts that PRD §12 leaves implicit.
 */
export type NotesService<Ctx = unknown> = {
  createNote: (ctx: Ctx, input: CreateNoteInput) => Promise<NoteDetailDTO>;
  updateNote: (ctx: Ctx, input: UpdateNoteInput) => Promise<NoteDetailDTO>;
  pinNote: (ctx: Ctx, input: PinNoteInput) => Promise<NoteDetailDTO>;
  linkNote: (ctx: Ctx, input: LinkNoteInput) => Promise<NoteDetailDTO>;
  unlinkNote: (ctx: Ctx, input: UnlinkNoteInput) => Promise<NoteDetailDTO>;
  attachFile: (ctx: Ctx, input: AttachFileInput) => Promise<NoteDetailDTO>;
  archiveNote: (ctx: Ctx, input: ArchiveNoteInput) => Promise<ArchivedRecordDTO>;
  listNotes: (ctx: Ctx, input: NoteFilter) => Promise<Paginated<NoteListRowDTO>>;
  getNote: (ctx: Ctx, input: NoteIdInput) => Promise<NoteDetailDTO>;
};
