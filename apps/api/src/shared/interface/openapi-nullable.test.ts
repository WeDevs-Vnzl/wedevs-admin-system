import { describe, expect, it } from 'vitest';
import { restoreNullableTypes } from './openapi-nullable';

const MARKER = 'x-nestjs_zod-empty-type';

describe('restoreNullableTypes', () => {
  it('turns the array swagger makes of a nestjs-zod type union back into [type, null]', () => {
    const document = {
      components: {
        schemas: {
          UserDetailDto: {
            type: 'object',
            properties: {
              imageUrl: { [MARKER]: true, type: 'array', items: { type: 'string' } },
              name: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    };
    restoreNullableTypes(document as never);
    expect(document.components.schemas.UserDetailDto.properties).toEqual({
      imageUrl: { [MARKER]: true, type: ['string', 'null'] },
      name: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    });
  });

  it('keeps the sibling keywords (format, pattern) of the property', () => {
    const document = {
      components: {
        schemas: {
          D: {
            type: 'object',
            properties: {
              endDate: { [MARKER]: true, type: 'array', items: { type: 'string' }, format: 'date' },
            },
          },
        },
      },
    };
    restoreNullableTypes(document as never);
    expect(document.components.schemas.D.properties.endDate).toEqual({
      [MARKER]: true,
      type: ['string', 'null'],
      format: 'date',
    });
  });

  it('fails loudly when a marked property is not the lossy shape it knows', () => {
    const document = {
      components: {
        schemas: { D: { type: 'object', properties: { x: { [MARKER]: true, type: 'array' } } } },
      },
    };
    expect(() => restoreNullableTypes(document as never)).toThrow(/D\.x/);
  });
});
