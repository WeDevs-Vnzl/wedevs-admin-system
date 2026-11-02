import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toolInputJsonSchema } from './tool-json-schema';

describe('toolInputJsonSchema', () => {
  it('describes a plain object and drops the $schema marker', () => {
    const schema = toolInputJsonSchema(z.object({ id: z.string(), note: z.string().optional() }));
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties)).toEqual(['id', 'note']);
    expect(schema.required).toEqual(['id']);
    expect(schema).not.toHaveProperty('$schema');
  });

  it('merges an intersection of params and body into one object, with defaults optional', () => {
    const schema = toolInputJsonSchema(
      z.intersection(
        z.object({ clientId: z.string() }),
        z.object({ page: z.coerce.number().default(1) }).transform((v) => v),
      ),
    );
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties).sort()).toEqual(['clientId', 'page']);
    expect(schema.required).toEqual(['clientId']);
  });
});
