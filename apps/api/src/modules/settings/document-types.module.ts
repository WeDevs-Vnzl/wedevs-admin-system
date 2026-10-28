import { Module } from '@nestjs/common';
import {
  ACTIVITY_LOG,
  AUTHORIZATION,
  ID_GENERATOR,
  UNIT_OF_WORK,
} from '../../shared/application/ports/tokens';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { IdGeneratorPort } from '../../shared/application/ports/id-generator.port';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import { DocumentTypeCatalog } from './application/document-type-catalog';
import {
  DOCUMENT_CATEGORY_REPOSITORY,
  type DocumentCategoryRepository,
} from './application/ports/document-category.repository.port';
import {
  DOCUMENT_TYPE_REPOSITORY,
  type DocumentTypeRepository,
} from './application/ports/document-type.repository.port';
import {
  DOCUMENT_TYPE_USAGE,
  type DocumentTypeUsagePort,
} from './application/ports/document-type-usage.port';
import { CreateDocumentCategory } from './application/use-cases/create-document-category.use-case';
import { CreateDocumentType } from './application/use-cases/create-document-type.use-case';
import { DeleteDocumentCategory } from './application/use-cases/delete-document-category.use-case';
import { DeleteDocumentType } from './application/use-cases/delete-document-type.use-case';
import { GetDocumentType } from './application/use-cases/get-document-type.use-case';
import { ListDocumentCategories } from './application/use-cases/list-document-categories.use-case';
import { ListDocumentTypes } from './application/use-cases/list-document-types.use-case';
import { ReorderDocumentCategories } from './application/use-cases/reorder-document-categories.use-case';
import { SetDocumentTypeActive } from './application/use-cases/set-document-type-active.use-case';
import { UpdateDocumentCategory } from './application/use-cases/update-document-category.use-case';
import { UpdateDocumentType } from './application/use-cases/update-document-type.use-case';
import { NoDocumentsYetDocumentTypeUsageAdapter } from './infrastructure/no-documents-yet.document-type-usage.adapter';
import { PrismaDocumentCategoryRepository } from './infrastructure/prisma-document-category.repository';
import { PrismaDocumentTypeRepository } from './infrastructure/prisma-document-type.repository';
import { DocumentCategoriesController } from './interface/http/document-categories.controller';
import { DocumentTypesController } from './interface/http/document-types.controller';

/**
 * Document categories and types (PRD §8.9.1, HU-21). `DocumentTypeCatalog` is exported for the documents
 * context (BE-4): it reads the catalog through this application API, never the tables. The usage port is
 * bound to a neutral adapter until BE-4 rebinds `DOCUMENT_TYPE_USAGE` (DT-110).
 */
@Module({
  controllers: [DocumentCategoriesController, DocumentTypesController],
  providers: [
    { provide: DOCUMENT_CATEGORY_REPOSITORY, useClass: PrismaDocumentCategoryRepository },
    { provide: DOCUMENT_TYPE_REPOSITORY, useClass: PrismaDocumentTypeRepository },
    { provide: DOCUMENT_TYPE_USAGE, useClass: NoDocumentsYetDocumentTypeUsageAdapter },
    {
      provide: DocumentTypeCatalog,
      useFactory: (
        categories: DocumentCategoryRepository,
        types: DocumentTypeRepository,
        usage: DocumentTypeUsagePort,
      ) => new DocumentTypeCatalog(categories, types, usage),
      inject: [DOCUMENT_CATEGORY_REPOSITORY, DOCUMENT_TYPE_REPOSITORY, DOCUMENT_TYPE_USAGE],
    },
    {
      provide: ListDocumentCategories,
      useFactory: (catalog: DocumentTypeCatalog) => new ListDocumentCategories(catalog),
      inject: [DocumentTypeCatalog],
    },
    {
      provide: CreateDocumentCategory,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        categories: DocumentCategoryRepository,
        catalog: DocumentTypeCatalog,
        ids: IdGeneratorPort,
        activity: ActivityLogPort,
      ) => new CreateDocumentCategory(authorization, uow, categories, catalog, ids, activity),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        DOCUMENT_CATEGORY_REPOSITORY,
        DocumentTypeCatalog,
        ID_GENERATOR,
        ACTIVITY_LOG,
      ],
    },
    {
      provide: UpdateDocumentCategory,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        categories: DocumentCategoryRepository,
        catalog: DocumentTypeCatalog,
        activity: ActivityLogPort,
      ) => new UpdateDocumentCategory(authorization, uow, categories, catalog, activity),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        DOCUMENT_CATEGORY_REPOSITORY,
        DocumentTypeCatalog,
        ACTIVITY_LOG,
      ],
    },
    {
      provide: ReorderDocumentCategories,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        categories: DocumentCategoryRepository,
        catalog: DocumentTypeCatalog,
        activity: ActivityLogPort,
      ) => new ReorderDocumentCategories(authorization, uow, categories, catalog, activity),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        DOCUMENT_CATEGORY_REPOSITORY,
        DocumentTypeCatalog,
        ACTIVITY_LOG,
      ],
    },
    {
      provide: DeleteDocumentCategory,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        categories: DocumentCategoryRepository,
        catalog: DocumentTypeCatalog,
        activity: ActivityLogPort,
      ) => new DeleteDocumentCategory(authorization, uow, categories, catalog, activity),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        DOCUMENT_CATEGORY_REPOSITORY,
        DocumentTypeCatalog,
        ACTIVITY_LOG,
      ],
    },
    {
      provide: ListDocumentTypes,
      useFactory: (catalog: DocumentTypeCatalog) => new ListDocumentTypes(catalog),
      inject: [DocumentTypeCatalog],
    },
    {
      provide: GetDocumentType,
      useFactory: (catalog: DocumentTypeCatalog) => new GetDocumentType(catalog),
      inject: [DocumentTypeCatalog],
    },
    {
      provide: CreateDocumentType,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        types: DocumentTypeRepository,
        catalog: DocumentTypeCatalog,
        ids: IdGeneratorPort,
        activity: ActivityLogPort,
      ) => new CreateDocumentType(authorization, uow, types, catalog, ids, activity),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        DOCUMENT_TYPE_REPOSITORY,
        DocumentTypeCatalog,
        ID_GENERATOR,
        ACTIVITY_LOG,
      ],
    },
    {
      provide: UpdateDocumentType,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        types: DocumentTypeRepository,
        catalog: DocumentTypeCatalog,
        activity: ActivityLogPort,
      ) => new UpdateDocumentType(authorization, uow, types, catalog, activity),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        DOCUMENT_TYPE_REPOSITORY,
        DocumentTypeCatalog,
        ACTIVITY_LOG,
      ],
    },
    {
      provide: SetDocumentTypeActive,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        types: DocumentTypeRepository,
        catalog: DocumentTypeCatalog,
        activity: ActivityLogPort,
      ) => new SetDocumentTypeActive(authorization, uow, types, catalog, activity),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        DOCUMENT_TYPE_REPOSITORY,
        DocumentTypeCatalog,
        ACTIVITY_LOG,
      ],
    },
    {
      provide: DeleteDocumentType,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        types: DocumentTypeRepository,
        catalog: DocumentTypeCatalog,
        activity: ActivityLogPort,
      ) => new DeleteDocumentType(authorization, uow, types, catalog, activity),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        DOCUMENT_TYPE_REPOSITORY,
        DocumentTypeCatalog,
        ACTIVITY_LOG,
      ],
    },
  ],
  exports: [DocumentTypeCatalog],
})
export class DocumentTypesModule {}
