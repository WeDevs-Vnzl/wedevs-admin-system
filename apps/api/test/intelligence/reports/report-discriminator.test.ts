import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The committed contract (packages/api-contract/openapi.json) is what the FE generates its types from. Without a
// discriminator mapping, openapi-typescript types each report's `reportId` as its schema name instead of the wire
// id, so the FE cannot narrow the union (FE-INT-R INTEL, user decision A).
interface Schema {
  properties?: Record<string, { const?: string }>;
}
interface Document {
  paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
  components: { schemas: Record<string, Schema> };
}

const doc = JSON.parse(
  readFileSync(
    resolve(__dirname, '..', '..', '..', '..', '..', 'packages', 'api-contract', 'openapi.json'),
    'utf8',
  ),
) as Document;

const responseSchema = (
  doc.paths['/api/v1/reports/{slug}']?.get?.responses['200'] as {
    content: { 'application/json': { schema: Record<string, unknown> } };
  }
).content['application/json'].schema as {
  oneOf: { $ref: string }[];
  discriminator: { propertyName: string; mapping?: Record<string, string> };
};

describe('GET /reports/{slug} response discriminator', () => {
  it('maps every wire reportId to its report schema', () => {
    const expected = Object.fromEntries(
      responseSchema.oneOf.map(({ $ref }) => {
        const name = $ref.split('/').pop() as string;
        const id = doc.components.schemas[name]?.properties?.reportId?.const;
        return [id, $ref];
      }),
    );
    expect(Object.keys(expected)).toHaveLength(10);
    expect(Object.keys(expected)).not.toContain(undefined);
    expect(responseSchema.discriminator).toEqual({ propertyName: 'reportId', mapping: expected });
  });
});
