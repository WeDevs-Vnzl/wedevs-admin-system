import type { NoteDetailDto, NoteListResponseDto } from "@/lib/api/types/notes";
import { entityRefSchema, type Paginated } from "@/lib/validators/common";
import { fileStatusSchema } from "@/lib/validators/enums";
import {
  richTextDocSchema,
  type NoteDetailDTO,
  type NoteListRowDTO,
  type RichTextDoc,
} from "@/lib/validators/notes";

/**
 * BE note DTOs → the shapes the notes screens read. Links go through `entityRefSchema` (wire `null` code →
 * `undefined`); the document goes through the editor allowlist again (C4), so a stored document the allowlist
 * refuses renders as an empty note instead of reaching the renderer.
 */

const EMPTY_DOC: RichTextDoc = { type: "doc", content: [{ type: "paragraph" }] };

function toDoc(content: unknown): RichTextDoc {
  const parsed = richTextDocSchema.safeParse(content);
  return parsed.success ? parsed.data : EMPTY_DOC;
}

const toLinks = (links: readonly unknown[]) => links.map((ref) => entityRefSchema.parse(ref));

export function toNoteDetail(dto: NoteDetailDto): NoteDetailDTO {
  return {
    id: dto.id,
    title: dto.title,
    content: toDoc(dto.content),
    contentText: dto.contentText,
    author: dto.author,
    pinned: dto.pinned,
    tags: dto.tags,
    links: toLinks(dto.links),
    attachments: dto.attachments.map((file) => ({
      ...file,
      status: fileStatusSchema.catch("PENDING").parse(file.status),
    })),
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    archivedAt: dto.archivedAt,
  };
}

export function toNotePage(dto: NoteListResponseDto): Paginated<NoteListRowDTO> {
  return {
    ...dto,
    items: dto.items.map((row) => ({ ...row, links: toLinks(row.links) })),
  };
}
