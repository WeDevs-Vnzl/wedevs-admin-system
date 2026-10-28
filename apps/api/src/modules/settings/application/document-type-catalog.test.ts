import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError } from '../../../shared/domain/domain-error';
import { createFixture } from '../../../../test/settings/document-types/fixtures';
import { DOCUMENT_TYPE_MESSAGES } from './document-type-catalog';

// Port of the read side of fe/src/mocks/services/document-types.ts (`listDocumentCategories`,
// `getDocumentType`, `assertTypePlacement`, the category name rule) plus the exported BE-4 API.

describe('DocumentTypeCatalog reads', () => {
  it('lists categories by order, each with its types by name and their document counts', async () => {
    const { catalog, usage } = createFixture();
    usage.setCount('dtyp_adenda', 2);
    const views = await catalog.categoryViews();
    expect(views.map((c) => c.name)).toEqual([
      'Legal',
      'Comercial',
      'Técnico',
      'Operativo',
      'Financiero',
    ]);
    expect(views[0]?.types.map((t) => t.name)).toEqual(['Adenda', 'Contrato de servicios']);
    expect(views[0]?.types[0]).toMatchObject({ id: 'dtyp_adenda', documentCount: 2 });
    expect(views[0]?.types[1]).toMatchObject({ id: 'dtyp_contrato', documentCount: 0 });
  });

  it('reads one type with its category and document count, NOT_FOUND for an unknown id', async () => {
    const { catalog } = createFixture();
    const type = await catalog.requireType('dtyp_contrato');
    await expect(catalog.typeDetail(type)).resolves.toMatchObject({
      id: 'dtyp_contrato',
      category: { id: 'dcat_legal', name: 'Legal', nameEn: 'Legal', color: '#6d28d9' },
      documentCount: 0,
    });
    await expect(catalog.requireType('dtyp_missing')).rejects.toBeInstanceOf(NotFoundError);
    await expect(catalog.requireCategory('dcat_missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('answers NOT_FOUND for a type whose category is missing', async () => {
    const { catalog, types } = createFixture();
    types.seed([
      {
        id: 'dtyp_orphan',
        categoryId: 'dcat_gone',
        name: 'Huérfano',
        nameEn: null,
        requiresSignature: false,
        hasExpiration: false,
        defaultFormat: 'ARCHIVO',
        active: true,
      },
    ]);
    const orphan = await catalog.requireType('dtyp_orphan');
    await expect(catalog.typeDetail(orphan)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses an inactive type when a document needs a usable one (BE-4 API)', async () => {
    const { catalog } = createFixture();
    await expect(catalog.requireActiveType('dtyp_contrato')).resolves.toMatchObject({
      id: 'dtyp_contrato',
    });
    await expect(catalog.requireActiveType('dtyp_propuesta')).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { typeId: ['validation.invalidOption'] },
    });
    await expect(catalog.requireActiveType('dtyp_missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('delegates the usage count to the usage port', async () => {
    const { catalog, usage } = createFixture();
    usage.setCount('dtyp_contrato', 1);
    await expect(catalog.countDocuments('dtyp_contrato')).resolves.toBe(1);
  });
});

describe('DocumentTypeCatalog placement and name rules', () => {
  it('refuses an unknown category with VALIDATION on categoryId (mock case)', async () => {
    const { catalog } = createFixture();
    await expect(catalog.assertTypePlacement('dcat_missing', 'X')).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { categoryId: [DOCUMENT_TYPE_MESSAGES.unknownCategory] },
    });
  });

  it('refuses a type name already taken inside the same category, case-insensitively (mock case)', async () => {
    const { catalog } = createFixture();
    const error = await catalog
      .assertTypePlacement('dcat_legal', 'adenda')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).fieldErrors).toEqual({
      name: [DOCUMENT_TYPE_MESSAGES.typeNameTaken],
    });
  });

  it('allows the same name in another category, and the type itself when editing it', async () => {
    const { catalog } = createFixture();
    await expect(catalog.assertTypePlacement('dcat_tecnico', 'Adenda')).resolves.toBeUndefined();
    await expect(
      catalog.assertTypePlacement('dcat_legal', 'Adenda', 'dtyp_adenda'),
    ).resolves.toBeUndefined();
  });

  it('refuses a category name already taken, case-insensitively, but not its own (mock case)', async () => {
    const { catalog } = createFixture();
    const error = await catalog.assertCategoryNameFree('legal').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).fieldErrors).toEqual({
      name: [DOCUMENT_TYPE_MESSAGES.categoryNameTaken],
    });
    await expect(catalog.assertCategoryNameFree('Legal', 'dcat_legal')).resolves.toBeUndefined();
  });

  it('reports whether a category still has types (the INTEGRITY_LOCK input)', async () => {
    const { catalog } = createFixture();
    await expect(catalog.categoryHasTypes('dcat_legal')).resolves.toBe(true);
    await expect(catalog.categoryHasTypes('dcat_financiero')).resolves.toBe(false);
  });
});
