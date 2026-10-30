import type { OpenAPIObject } from '@nestjs/swagger';

/** Set by nestjs-zod on a property whose JSON Schema `type` is not a plain string (here `['string', 'null']`). */
const EMPTY_TYPE_KEY = 'x-nestjs_zod-empty-type';

type Schema = Record<string, unknown>;

/**
 * Repairs the nullable properties of the Zod DTOs in a swagger document, before `cleanupOpenApiDoc`.
 *
 * nestjs-zod hands `@nestjs/swagger` a property `{ type: ['string', 'null'] }` for `z.string().nullable()`;
 * swagger reads a `type` array as "array of" and writes `{ type: 'array', items: { type: 'string' } }`, so
 * the document said `string[]` and the generated client typed a nullable field as an array. nestjs-zod flags
 * such a property with `x-nestjs_zod-empty-type` and a zod union never yields a real array there (a real
 * `z.array()` has a string `type` and no flag), so the flagged shape is mapped back to `[type, 'null']`.
 * Anything flagged that does not have that exact lossy shape throws instead of being guessed.
 */
export function restoreNullableTypes(document: OpenAPIObject): OpenAPIObject {
  const schemas = (document.components?.schemas ?? {}) as Record<string, Schema>;
  for (const [schemaName, schema] of Object.entries(schemas)) {
    const properties = schema.properties as Record<string, Schema> | undefined;
    for (const [propertyName, property] of Object.entries(properties ?? {})) {
      if (property[EMPTY_TYPE_KEY] !== true || property.type !== 'array') continue;
      const itemType = (property.items as Schema | undefined)?.type;
      if (typeof itemType !== 'string') {
        throw new Error(`Cannot restore the nullable type of ${schemaName}.${propertyName}`);
      }
      property.type = [itemType, 'null'];
      delete property.items;
    }
  }
  return document;
}
