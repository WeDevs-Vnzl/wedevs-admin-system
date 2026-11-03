import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { idSchema, timestampSchema } from '../../../../shared/interface/common.schemas';
import type { ApiTokenOutput } from '../../application/use-cases/api-tokens/api-token-support';
import type { IssuedApiTokenOutput } from '../../application/use-cases/api-tokens/issue-api-token.use-case';

/**
 * Personal access token routes (A9, DT-189). Shape only: the name's trim and 1-80 length, the 1-365 day range and
 * the limit of 10 active tokens are the use case's rules, answered as `VALIDATION` / `CONFLICT` with keys.
 */
export const issueApiTokenSchema = z.object({
  name: z.string(),
  expiresInDays: z.number().int().optional(),
});
export class IssueApiTokenDto extends createZodDto(issueApiTokenSchema) {}

export class ApiTokenIdParamsDto extends createZodDto(z.object({ id: idSchema })) {}

export const apiTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** First 12 characters of the secret, for display. */
  prefix: z.string(),
  expiresAt: timestampSchema,
  revokedAt: timestampSchema.nullable(),
  lastUsedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});
export class ApiTokenDto extends createZodDto(apiTokenSchema) {}

export const issuedApiTokenSchema = apiTokenSchema.extend({
  /** The full secret; returned once, never again. */
  secret: z.string(),
});
export class IssuedApiTokenDto extends createZodDto(issuedApiTokenSchema) {}

export const apiTokenListSchema = z.object({ items: z.array(apiTokenSchema) });
export class ApiTokenListDto extends createZodDto(apiTokenListSchema) {}

export function toApiTokenDto(token: ApiTokenOutput): ApiTokenDto {
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    expiresAt: token.expiresAt.toISOString(),
    revokedAt: token.revokedAt?.toISOString() ?? null,
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    createdAt: token.createdAt.toISOString(),
  };
}

export function toIssuedApiTokenDto(token: IssuedApiTokenOutput): IssuedApiTokenDto {
  return { ...toApiTokenDto(token), secret: token.secret };
}
