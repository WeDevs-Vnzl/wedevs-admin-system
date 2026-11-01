import type { TechCategory } from '../../../../shared/domain/enums';

export const PROJECT_TECHNOLOGY_CATALOG = Symbol('PROJECT_TECHNOLOGY_CATALOG');

/** A catalog technology as the project stack needs it. */
export interface ProjectTechnologyEntry {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly category: TechCategory;
  readonly iconSlug: string | null;
  readonly color: string | null;
  /** The stack accepts only active technologies, except the ones a project already carries (HU-06 CA1). */
  readonly active: boolean;
}

/** Commercial's view of settings' technology catalog; bound to settings' `TechnologyCatalog`. */
export interface ProjectTechnologyCatalogPort {
  /** The technologies with the given ids, each once; unknown ids are left out. */
  findByIds(ids: readonly string[]): Promise<ProjectTechnologyEntry[]>;
}
