import type { CurrentUser } from '../../../../shared/application/current-user';
import { DocumentTypeCatalog, type DocumentCategoryView } from '../document-type-catalog';

/**
 * `GET /document-categories`: the categories in order, each with its types. Reads of reference catalogs
 * carry `@Authenticated()` (DT-71), so every signed-in role reads them and the use case runs no `can()`.
 */
export class ListDocumentCategories {
  constructor(private readonly catalog: DocumentTypeCatalog) {}

  async execute(_actor: CurrentUser): Promise<DocumentCategoryView[]> {
    return this.catalog.categoryViews();
  }
}
