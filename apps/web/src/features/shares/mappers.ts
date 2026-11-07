import type {
  SetShareAccessKeyResultDto,
  ShareAccessLogResponseDto,
  ShareLinkDetailDto,
  ShareLinkListResponseDto,
  ShareLinkMutationResultDto,
} from "@/lib/api/types/shares";
import { entityRefSchema, type Paginated } from "@/lib/validators/common";
import type {
  SetShareDocumentAccessKeyResultDTO,
  ShareAccessLogRowDTO,
  ShareLinkDetailDTO,
  ShareLinkListRowDTO,
  ShareLinkMutationResultDTO,
} from "@/lib/validators/shares";

/**
 * BE share DTOs → the shapes the share screens read. References go through `entityRefSchema` (wire `null` code →
 * `undefined`); everything else is as returned: status, counters, `lastAccessedAt` and the version pins are the
 * BE's figures. The access keys of a mutation result are passed through to the caller once and kept nowhere (C22).
 */

const optionalRef = (ref: unknown) => (ref ? entityRefSchema.parse(ref) : null);

export function toShareDetail(dto: ShareLinkDetailDto): ShareLinkDetailDTO {
  return {
    ...dto,
    client: optionalRef(dto.client),
    documents: dto.documents.map((doc) => ({
      ...doc,
      document: entityRefSchema.parse(doc.document),
    })),
  };
}

export function toSharePage(dto: ShareLinkListResponseDto): Paginated<ShareLinkListRowDTO> {
  return { ...dto, items: dto.items.map((row) => ({ ...row, client: optionalRef(row.client) })) };
}

export function toAccessLogPage(dto: ShareAccessLogResponseDto): Paginated<ShareAccessLogRowDTO> {
  return dto;
}

export function toMutationResult(dto: ShareLinkMutationResultDto): ShareLinkMutationResultDTO {
  return { share: toShareDetail(dto.share), generatedKeys: dto.generatedKeys };
}

export function toKeyResult(dto: SetShareAccessKeyResultDto): SetShareDocumentAccessKeyResultDTO {
  return dto;
}
