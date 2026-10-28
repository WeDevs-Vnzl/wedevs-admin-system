import type { CurrentUser } from '../../../src/shared/application/current-user';
import { FakeAuthorization, type FakePolicy } from '../../support/fakes/fake-authorization';
import { InMemoryActivityLog } from '../../support/fakes/in-memory-activity-log';
import { InMemoryUnitOfWork } from '../../support/fakes/in-memory-unit-of-work';
import { SequentialIdGenerator } from '../../support/fakes/sequential-id-generator';
import { DocumentTypeCatalog } from '../../../src/modules/settings/application/document-type-catalog';
import type { DocumentCategory } from '../../../src/modules/settings/domain/document-category';
import type { DocumentType } from '../../../src/modules/settings/domain/document-type';
import type { UserRole } from '../../../src/shared/domain/enums';
import { InMemoryDocumentCategoryRepository } from './fakes/in-memory-document-category.repository';
import { InMemoryDocumentTypeRepository } from './fakes/in-memory-document-type.repository';
import { FakeDocumentTypeUsage } from './fakes/fake-document-type-usage';

/** Seeded categories, in the order of the PRD §8.9.1 seed (Legal, Comercial, Técnico, Operativo, Financiero). */
export const CATEGORY_ROWS: readonly DocumentCategory[] = [
  { id: 'dcat_legal', name: 'Legal', nameEn: 'Legal', color: '#6d28d9', order: 0 },
  { id: 'dcat_comercial', name: 'Comercial', nameEn: 'Commercial', color: '#0369a1', order: 1 },
  { id: 'dcat_tecnico', name: 'Técnico', nameEn: 'Technical', color: '#047857', order: 2 },
  { id: 'dcat_operativo', name: 'Operativo', nameEn: 'Operations', color: '#b45309', order: 3 },
  { id: 'dcat_financiero', name: 'Financiero', nameEn: 'Finance', color: '#be123c', order: 4 },
];

/** Seeded types: a type with capabilities, a second one in the same category, and one elsewhere. */
export const TYPE_ROWS: readonly DocumentType[] = [
  {
    id: 'dtyp_contrato',
    categoryId: 'dcat_legal',
    name: 'Contrato de servicios',
    nameEn: 'Service agreement',
    requiresSignature: true,
    hasExpiration: true,
    defaultFormat: 'ARCHIVO',
    active: true,
  },
  {
    id: 'dtyp_adenda',
    categoryId: 'dcat_legal',
    name: 'Adenda',
    nameEn: 'Addendum',
    requiresSignature: true,
    hasExpiration: false,
    defaultFormat: 'ARCHIVO',
    active: true,
  },
  {
    id: 'dtyp_propuesta',
    categoryId: 'dcat_comercial',
    name: 'Propuesta',
    nameEn: null,
    requiresSignature: false,
    hasExpiration: false,
    defaultFormat: 'MARKDOWN',
    active: false,
  },
];

/** Matrix stand-in: only Owner and Admin hold the `settings` grants (PRD §4.3). */
export const settingsPolicy: FakePolicy = (user, _action, resource) =>
  resource === 'settings' && ['OWNER', 'ADMIN'].includes(user.role);

export function actor(role: UserRole = 'OWNER'): CurrentUser {
  return {
    userId: `usr_${role.toLowerCase()}`,
    clerkId: `user_${role.toLowerCase()}`,
    role,
    email: `${role.toLowerCase()}@example.test`,
    name: role,
  };
}

/** A fresh catalog with the seed rows, every port faked and the unit of work in between. */
export function createFixture(options: { policy?: FakePolicy } = {}) {
  const uow = new InMemoryUnitOfWork();
  const categories = new InMemoryDocumentCategoryRepository(uow);
  const types = new InMemoryDocumentTypeRepository(uow);
  const usage = new FakeDocumentTypeUsage();
  const activity = new InMemoryActivityLog(uow);
  const authorization = new FakeAuthorization({ policy: options.policy ?? settingsPolicy });
  const ids = new SequentialIdGenerator('dnew');
  const catalog = new DocumentTypeCatalog(categories, types, usage);
  categories.seed(CATEGORY_ROWS);
  types.seed(TYPE_ROWS);
  return { uow, categories, types, usage, activity, authorization, ids, catalog };
}

export type Fixture = ReturnType<typeof createFixture>;
