import type { PermissionResource } from '../../../shared/application/authorization';
import type { SearchableEntityType } from '../domain/search-query';

/** The `read` grant of each record type; search and graph share it (the mock's `RESOURCE`). */
export const ENTITY_READ_RESOURCE: Readonly<Record<SearchableEntityType, PermissionResource>> = {
  CLIENT: 'client',
  CONTACT: 'contact',
  PROJECT: 'project',
  INVOICE: 'invoice',
  PAYMENT: 'payment',
  EXPENSE: 'expense',
  ACCOUNT: 'account',
  DOCUMENT: 'document',
  NOTE: 'note',
};
