import type {
  DocumentDetailDto,
  DocumentLinkDto,
  DocumentListResponseDto,
  DocumentsOverviewDto,
} from "@/lib/api/types/documents";
import { entityRefSchema, type Paginated } from "@/lib/validators/common";
import type {
  DocumentDetailDTO,
  DocumentLinkDTO,
  DocumentListRowDTO,
  DocumentsOverviewDTO,
} from "@/lib/validators/documents";

/**
 * BE document DTOs → the shapes the documents screens read. Every `EntityRef` (link chips) goes through
 * `entityRefSchema`, so the wire `code: null` becomes `undefined`; the rest of the DTO is used as it comes.
 */

const toRefs = (links: readonly unknown[]) => links.map((ref) => entityRefSchema.parse(ref));

type WireRow = DocumentListResponseDto["items"][number];

export function toDocumentRow(row: WireRow): DocumentListRowDTO {
  return { ...row, links: toRefs(row.links) };
}

export function toDocumentPage(dto: DocumentListResponseDto): Paginated<DocumentListRowDTO> {
  return { ...dto, items: dto.items.map(toDocumentRow) };
}

export function toDocumentLinks(links: readonly DocumentLinkDto[]): DocumentLinkDTO[] {
  return links.map((link) => ({ ...link, entity: entityRefSchema.parse(link.entity) }));
}

export function toDocumentDetail(dto: DocumentDetailDto): DocumentDetailDTO {
  return { ...dto, links: toDocumentLinks(dto.links) };
}

export function toDocumentsOverview(dto: DocumentsOverviewDto): DocumentsOverviewDTO {
  return {
    ...dto,
    expiringSoon: dto.expiringSoon.map(toDocumentRow),
    recent: dto.recent.map(toDocumentRow),
    staleDrafts: dto.staleDrafts.map(toDocumentRow),
  };
}
