import { z } from 'zod';

export interface ToolInputJsonSchema {
  readonly type: 'object';
  readonly properties: Record<string, unknown>;
  readonly required?: string[];
  readonly [key: string]: unknown;
}

type Json = Record<string, unknown>;

/** Folds `allOf` parts (a route's params and its body, joined by an intersection) into one object schema. */
function fold(schema: Json): Json {
  const parts = Array.isArray(schema.allOf) ? (schema.allOf as Json[]).map(fold) : [];
  const { allOf: _allOf, ...own } = schema;
  const properties: Json = { ...(own.properties as Json | undefined) };
  const required = new Set<string>((own.required as string[] | undefined) ?? []);
  for (const part of parts) {
    Object.assign(properties, part.properties as Json | undefined);
    for (const name of (part.required as string[] | undefined) ?? []) required.add(name);
  }
  return { ...own, properties, ...(required.size > 0 ? { required: [...required] } : {}) };
}

/**
 * The JSON Schema a client sees for a tool's arguments: the input side of the Zod schema (what the client may
 * send, before defaults and transforms), as a single `type: "object"` as the MCP spec requires.
 */
export function toolInputJsonSchema(input: z.ZodType): ToolInputJsonSchema {
  const raw = z.toJSONSchema(input, {
    io: 'input',
    unrepresentable: 'any',
    target: 'draft-7',
  }) as Json;
  const { $schema: _schema, ...schema } = fold(raw);
  return { ...schema, type: 'object', properties: schema.properties as Json };
}
