import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import { actor, createFixture } from '../../../../../test/settings/document-types/fixtures';
import { GetDocumentType } from './get-document-type.use-case';

// Port of the read case of fe/src/mocks/services/document-types.test.ts ("document types").
describe('GetDocumentType', () => {
  it('reads one type with its category and document count', async () => {
    const { catalog, usage } = createFixture();
    usage.setCount('dtyp_contrato', 3);
    const useCase = new GetDocumentType(catalog);
    await expect(useCase.execute(actor('VIEWER'), { id: 'dtyp_contrato' })).resolves.toMatchObject({
      id: 'dtyp_contrato',
      requiresSignature: true,
      hasExpiration: true,
      defaultFormat: 'ARCHIVO',
      category: { id: 'dcat_legal', name: 'Legal' },
      documentCount: 3,
    });
  });

  it('answers NOT_FOUND for an unknown id', async () => {
    const { catalog } = createFixture();
    await expect(
      new GetDocumentType(catalog).execute(actor('VIEWER'), { id: 'dtyp_nope' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
