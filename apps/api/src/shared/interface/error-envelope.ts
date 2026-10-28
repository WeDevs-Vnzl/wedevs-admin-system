import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ENTITY_TYPE_VALUES, ERROR_CODE_VALUES } from '../domain';

/** `EntityRef` on the wire (`api-contract.md` §2): `code` is `null` when the entity has none. */
export const entityRefResponseSchema = z
  .object({
    type: z.enum(ENTITY_TYPE_VALUES),
    id: z.string(),
    code: z.string().nullable(),
    label: z.string(),
  })
  .meta({ id: 'EntityRef' });

/** Error envelope of every non-2xx response (`api-contract.md` §4). */
export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.enum(ERROR_CODE_VALUES),
      message: z.string(),
      fieldErrors: z.record(z.string(), z.array(z.string())).nullable(),
      entity: entityRefResponseSchema.nullable(),
      correlationId: z.string(),
    }),
  })
  .meta({ id: 'ErrorResponse' });

/**
 * The documented DTO: the same `error` shape without the root `.meta({ id })`, because `nestjs-zod`'s
 * `cleanupOpenApiDoc` rejects a DTO whose schema already carries an id equal to its class name. The class
 * name is the OpenAPI component name. `errorResponseSchema` stays the runtime envelope.
 */
export class ErrorResponse extends createZodDto(
  z.object({ error: errorResponseSchema.shape.error }),
) {}
