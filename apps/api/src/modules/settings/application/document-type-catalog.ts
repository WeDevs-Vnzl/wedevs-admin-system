import { actorOf } from '../../../shared/application/actor';
import type { CurrentUser } from '../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../shared/application/ports/activity-log.port';
import type { ActivityChanges } from '../../../shared/domain/activity-diff';
import {
  ConflictError,
  NotFoundError,
  ValidationFailedError,
} from '../../../shared/domain/domain-error';
import type { DocumentFormat } from '../../../shared/domain/enums';
import { sameCatalogName, type DocumentCategory } from '../domain/document-category';
import type { DocumentType } from '../domain/document-type';
import type { DocumentCategoryRepository } from './ports/document-category.repository.port';
import type { DocumentTypeRepository } from './ports/document-type.repository.port';
import type { DocumentTypeUsagePort } from './ports/document-type-usage.port';

/** i18n keys the mock throws, reused verbatim so the FE needs no new message (`catalogs.documentTypes.*`). */
export const DOCUMENT_TYPE_MESSAGES = {
  categoryNameTaken: 'catalogs.documentTypes.errors.categoryNameTaken',
  categoryHasTypes: 'catalogs.documentTypes.errors.categoryHasTypes',
  reorderMismatch: 'catalogs.documentTypes.errors.reorderMismatch',
  unknownCategory: 'catalogs.documentTypes.errors.unknownCategory',
  typeNameTaken: 'catalogs.documentTypes.errors.typeNameTaken',
  typeInUse: 'catalogs.documentTypes.errors.typeInUse',
} as const;

/** `validation.invalidOption`: the FE key for a choice that is not offered (an inactive type). */
const INVALID_OPTION_KEY = 'validation.invalidOption';

/** Category as shown inside a type row or a picker. */
export interface DocumentCategoryRef {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly color: string | null;
}

/** Type as shown in a category tree or a picker; `documentCount` comes from the usage port. */
export interface DocumentTypeView {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly defaultFormat: DocumentFormat;
  readonly requiresSignature: boolean;
  readonly hasExpiration: boolean;
  readonly active: boolean;
  readonly documentCount: number;
}

/** Type with its category, for the detail read and the list rows. */
export interface DocumentTypeDetailView extends DocumentTypeView {
  readonly category: DocumentCategoryRef;
}

/** Category with its types (name order), for the settings tree and the grouped type picker. */
export interface DocumentCategoryView extends DocumentCategoryRef {
  readonly order: number;
  readonly types: DocumentTypeView[];
}

/** Ascending order of catalog text, as the mock sorts it (`localeCompare` in Spanish, numeric). */
export function compareCatalogText(a: string, b: string): number {
  return a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true });
}

export function categoryRef(category: DocumentCategory): DocumentCategoryRef {
  return {
    id: category.id,
    name: category.name,
    nameEn: category.nameEn,
    color: category.color,
  };
}

/**
 * Writes one `SETTINGS_CHANGE` activity entry, only when the change set is not empty (the shape every
 * catalog write logs). Valid only inside the caller's unit of work.
 */
export async function recordSettingsChange(
  activity: ActivityLogPort,
  actor: CurrentUser,
  entity: { readonly id: string; readonly label: string },
  changes: ActivityChanges | null,
): Promise<void> {
  if (changes === null) return;
  await activity.record({
    actor: actorOf(actor),
    action: 'SETTINGS_CHANGE',
    entityType: 'SETTING',
    entityId: entity.id,
    entityLabel: entity.label,
    changes,
  });
}

/**
 * The document classification catalog (PRD §8.9.1, HU-21): the reads and the uniqueness, placement and
 * usage rules that the category and type use cases share. It also serves the documents context (BE-4)
 * through its application API, so BE-4 never reads the settings tables (DT-110).
 */
export class DocumentTypeCatalog {
  constructor(
    private readonly categories: DocumentCategoryRepository,
    private readonly types: DocumentTypeRepository,
    private readonly usage: DocumentTypeUsagePort,
  ) {}

  /** Every category, ascending by `order`. */
  async listCategories(): Promise<DocumentCategory[]> {
    return [...(await this.categories.list())].sort((a, b) => a.order - b.order);
  }

  /** `NOT_FOUND` when the id does not exist. */
  async requireCategory(id: string): Promise<DocumentCategory> {
    const row = await this.categories.find(id);
    if (!row) throw new NotFoundError();
    return row;
  }

  async listTypes(): Promise<DocumentType[]> {
    return this.types.list();
  }

  /** `NOT_FOUND` when the id does not exist. */
  async requireType(id: string): Promise<DocumentType> {
    const row = await this.types.find(id);
    if (!row) throw new NotFoundError();
    return row;
  }

  /**
   * A type a new document may pick (BE-4 API): `NOT_FOUND` for an unknown id, `VALIDATION` on `typeId` for
   * an inactive one (HU-21 CA2: deactivation retires a type that documents use).
   */
  async requireActiveType(id: string): Promise<DocumentType> {
    const row = await this.requireType(id);
    if (!row.active) {
      throw new ValidationFailedError({ fieldErrors: { typeId: [INVALID_OPTION_KEY] } });
    }
    return row;
  }

  /** Documents that use the type, archived ones included (through the usage port, DT-110). */
  async countDocuments(typeId: string): Promise<number> {
    return this.usage.countDocuments(typeId);
  }

  async categoryHasTypes(categoryId: string): Promise<boolean> {
    return (await this.types.list()).some((type) => type.categoryId === categoryId);
  }

  /** Category names are unique, case-insensitively; `exceptId` is the category being edited. */
  async assertCategoryNameFree(name: string, exceptId?: string): Promise<void> {
    const taken = (await this.categories.list()).some(
      (category) => category.id !== exceptId && sameCatalogName(category.name, name),
    );
    if (taken) {
      throw new ConflictError({
        fieldErrors: { name: [DOCUMENT_TYPE_MESSAGES.categoryNameTaken] },
      });
    }
  }

  /**
   * The category must exist (`VALIDATION` on `categoryId`), and the type name is unique inside it,
   * case-insensitively (`CONFLICT` on `name`). `exceptId` is the type being edited.
   */
  async assertTypePlacement(categoryId: string, name: string, exceptId?: string): Promise<void> {
    const exists = (await this.categories.list()).some((category) => category.id === categoryId);
    if (!exists) {
      throw new ValidationFailedError({
        fieldErrors: { categoryId: [DOCUMENT_TYPE_MESSAGES.unknownCategory] },
      });
    }
    const taken = (await this.types.list()).some(
      (type) =>
        type.id !== exceptId && type.categoryId === categoryId && sameCatalogName(type.name, name),
    );
    if (taken) {
      throw new ConflictError({
        fieldErrors: { name: [DOCUMENT_TYPE_MESSAGES.typeNameTaken] },
      });
    }
  }

  /**
   * A type with its `documentCount`. Inside a unit of work the usage adapter locks the type row to count (see
   * `PrismaDocumentTypeUsage`), which the type writes accept; a list reads it outside one, without a lock.
   */
  async typeView(type: DocumentType): Promise<DocumentTypeView> {
    return {
      id: type.id,
      name: type.name,
      nameEn: type.nameEn,
      defaultFormat: type.defaultFormat,
      requiresSignature: type.requiresSignature,
      hasExpiration: type.hasExpiration,
      active: type.active,
      documentCount: await this.usage.countDocuments(type.id),
    };
  }

  /** `NOT_FOUND` when the type's category is missing (the mock's `typeDetailOrThrow`). */
  async typeDetail(type: DocumentType): Promise<DocumentTypeDetailView> {
    const category = await this.categories.find(type.categoryId);
    if (!category) throw new NotFoundError();
    return { ...(await this.typeView(type)), category: categoryRef(category) };
  }

  async categoryView(category: DocumentCategory): Promise<DocumentCategoryView> {
    const own = (await this.types.list())
      .filter((type) => type.categoryId === category.id)
      .sort((a, b) => compareCatalogText(a.name, b.name));
    const types: DocumentTypeView[] = [];
    for (const type of own) types.push(await this.typeView(type));
    return { ...categoryRef(category), order: category.order, types };
  }

  /** Every category in order, each with its types in name order. */
  async categoryViews(): Promise<DocumentCategoryView[]> {
    const views: DocumentCategoryView[] = [];
    for (const category of await this.listCategories()) {
      views.push(await this.categoryView(category));
    }
    return views;
  }
}
