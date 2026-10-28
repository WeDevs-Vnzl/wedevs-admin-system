import { describe, expect, it } from 'vitest';
import {
  documentCategoryBodySchema,
  reorderDocumentCategoriesSchema,
} from '../../../src/modules/settings/interface/http/dto/document-categories.dto';
import {
  documentTypeBodySchema,
  documentTypeListQuerySchema,
  setDocumentTypeActiveSchema,
} from '../../../src/modules/settings/interface/http/dto/document-types.dto';

// Ported from fe/src/lib/validators/document-types.test.ts (the request shapes of the document catalog).
describe('document category request shapes', () => {
  it('accept a name with an optional English name and colour (FE validator case)', () => {
    expect(documentCategoryBodySchema.safeParse({ name: 'Legal' }).success).toBe(true);
    expect(
      documentCategoryBodySchema.safeParse({ name: 'Legal', nameEn: 'Legal', color: '#336699' })
        .success,
    ).toBe(true);
    expect(documentCategoryBodySchema.safeParse({}).success).toBe(false);
  });

  it('reorder takes every id once, in order (FE validator case)', () => {
    expect(reorderDocumentCategoriesSchema.safeParse({ orderedIds: ['a', 'b'] }).success).toBe(
      true,
    );
    expect(reorderDocumentCategoriesSchema.safeParse({ orderedIds: ['a', 'a'] }).success).toBe(
      false,
    );
    expect(reorderDocumentCategoriesSchema.safeParse({ orderedIds: [] }).success).toBe(false);
  });
});

describe('document type request shapes', () => {
  const valid = { categoryId: 'cat_legal', name: 'Contrato de servicios' };

  it('default to no signature, no expiration, ARCHIVO and active (FE validator case)', () => {
    expect(documentTypeBodySchema.parse(valid)).toEqual({
      ...valid,
      nameEn: undefined,
      requiresSignature: false,
      hasExpiration: false,
      defaultFormat: 'ARCHIVO',
      active: true,
    });
  });

  it('accept the capability flags, an English name and every format', () => {
    for (const defaultFormat of ['MARKDOWN', 'ARCHIVO', 'ENLACE']) {
      expect(
        documentTypeBodySchema.safeParse({
          ...valid,
          nameEn: 'Services agreement',
          requiresSignature: true,
          hasExpiration: true,
          defaultFormat,
        }).success,
      ).toBe(true);
    }
  });

  it('reject a missing category, a missing name and an unknown format (FE validator case)', () => {
    expect(documentTypeBodySchema.safeParse({ name: 'X' }).success).toBe(false);
    expect(documentTypeBodySchema.safeParse({ categoryId: 'cat_legal' }).success).toBe(false);
    expect(documentTypeBodySchema.safeParse({ ...valid, defaultFormat: 'PDF' }).success).toBe(
      false,
    );
  });

  it('take a boolean active flag only (POST /document-types/{id}/active)', () => {
    expect(setDocumentTypeActiveSchema.safeParse({ active: false }).success).toBe(true);
    expect(setDocumentTypeActiveSchema.safeParse({ active: 'yes' }).success).toBe(false);
    expect(setDocumentTypeActiveSchema.safeParse({}).success).toBe(false);
  });
});

describe('document type list query', () => {
  it('parses the facets from query strings, repeated keys and the capability flags', () => {
    const parsed = documentTypeListQuerySchema.parse({
      categoryId: ['cat_legal', 'cat_tecnico'],
      requiresSignature: 'true',
      hasExpiration: 'false',
    });
    expect(parsed).toMatchObject({
      categoryId: ['cat_legal', 'cat_tecnico'],
      requiresSignature: true,
      hasExpiration: false,
      page: 1,
      pageSize: 25,
      sort: { field: 'name', direction: 'asc' },
    });
    expect(documentTypeListQuerySchema.parse({ categoryId: 'cat_legal' }).categoryId).toEqual([
      'cat_legal',
    ]);
  });

  it('refuses a sort outside the whitelist and an unknown page size', () => {
    expect(documentTypeListQuerySchema.safeParse({ sort: 'id:asc' }).success).toBe(false);
    expect(documentTypeListQuerySchema.safeParse({ pageSize: '30' }).success).toBe(false);
    expect(documentTypeListQuerySchema.safeParse({ sort: 'documentCount:desc' }).success).toBe(
      true,
    );
  });

  it('does not expose an archived filter: document types are never soft-deleted', () => {
    const parsed = documentTypeListQuerySchema.parse({ archived: 'only' });
    expect(parsed).not.toHaveProperty('archived');
  });
});
