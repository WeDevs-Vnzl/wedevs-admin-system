import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createListQueryDto, createListQuerySchema } from './list-query.dto';

const schema = createListQuerySchema({
  sortFields: ['name', 'createdAt', 'client.name'],
  defaultSort: { field: 'createdAt', direction: 'desc' },
  filters: { status: z.enum(['ACTIVO', 'INACTIVO']), clientId: z.string() },
});

describe('createListQuerySchema', () => {
  it('applies defaults and the default sort', () => {
    expect(schema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
      sort: { field: 'createdAt', direction: 'desc' },
      archived: 'exclude',
      filters: {},
    });
  });

  it('coerces URL strings, trims q and keeps repeated keys as arrays', () => {
    expect(
      schema.parse({
        page: '3',
        pageSize: '50',
        sort: 'name:asc',
        q: '  kairos ',
        archived: 'only',
        status: ['ACTIVO', 'INACTIVO'],
        clientId: 'cli_1',
      }),
    ).toEqual({
      page: 3,
      pageSize: 50,
      sort: { field: 'name', direction: 'asc' },
      q: 'kairos',
      archived: 'only',
      filters: { status: ['ACTIVO', 'INACTIVO'], clientId: 'cli_1' },
    });
  });

  it('accepts real numbers too', () => {
    expect(schema.parse({ page: 2, pageSize: 100 })).toMatchObject({ page: 2, pageSize: 100 });
  });

  it.each([0, -1, 1.5, 'abc'])('rejects page %s', (page) => {
    expect(schema.safeParse({ page }).success).toBe(false);
  });

  it.each([10, 24, 101, 200, '30'])('rejects pageSize %s', (pageSize) => {
    expect(schema.safeParse({ pageSize }).success).toBe(false);
  });

  it('turns an empty q into an absent q and rejects an oversized one', () => {
    expect(schema.parse({ q: '   ' })).not.toHaveProperty('q');
    expect(schema.safeParse({ q: 'x'.repeat(201) }).success).toBe(false);
  });

  it('accepts dotted sort fields inside the whitelist', () => {
    expect(schema.parse({ sort: 'client.name:asc' }).sort).toEqual({
      field: 'client.name',
      direction: 'asc',
    });
  });

  it.each(['secret:asc', 'name', 'name:up', ':asc', '1name:asc', 'name:asc;drop', 'name:ASC'])(
    'rejects sort %s with validation.sort.invalid on sort',
    (sort) => {
      const result = schema.safeParse({ sort });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]).toMatchObject({
        message: 'validation.sort.invalid',
        path: ['sort'],
      });
    },
  );

  it('rejects an invalid archived mode and an invalid filter value', () => {
    expect(schema.safeParse({ archived: 'all' }).success).toBe(false);
    expect(schema.safeParse({ status: 'NOPE' }).success).toBe(false);
    expect(schema.safeParse({ status: ['ACTIVO', 'NOPE'] }).success).toBe(false);
  });

  it('works without filters', () => {
    const plain = createListQuerySchema({
      sortFields: ['name'],
      defaultSort: { field: 'name', direction: 'asc' },
    });
    expect(plain.parse({ unknown: 'x' }).filters).toEqual({});
  });
});

describe('createListQueryDto', () => {
  it('exposes page, pageSize, sort, q, archived and filters as OpenAPI query params', () => {
    const Dto = createListQueryDto({
      sortFields: ['name'],
      defaultSort: { field: 'name', direction: 'asc' },
      filters: { status: z.enum(['ACTIVO']) },
    });
    const json = z.toJSONSchema(Dto.schema, { io: 'input' }) as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(json.properties).sort()).toEqual(
      ['archived', 'page', 'pageSize', 'q', 'sort', 'status'].sort(),
    );
  });
});
