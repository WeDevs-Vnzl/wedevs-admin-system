import type { CurrentUser } from '../../../../shared/application/current-user';
import { DocumentTypeCatalog, type DocumentTypeDetailView } from '../document-type-catalog';

/**
 * `GET /document-types/{id}`: one type with its category and document count. `NOT_FOUND` for an unknown
 * id. Reads carry `@Authenticated()` (DT-71): the use case runs no `can()`.
 */
export class GetDocumentType {
  constructor(private readonly catalog: DocumentTypeCatalog) {}

  async execute(
    _actor: CurrentUser,
    input: { readonly id: string },
  ): Promise<DocumentTypeDetailView> {
    return this.catalog.typeDetail(await this.catalog.requireType(input.id));
  }
}
