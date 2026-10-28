import type { TechCategory } from '../../../shared/domain/enums';
import type { TechnologyRepository } from './ports/technology.repository.port';

/** Chip of a technology as another context reads it (stack icons, graph nodes). */
export type TechnologyCatalogEntry = {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly category: TechCategory;
  readonly iconSlug: string | null;
  readonly color: string | null;
  /** Inactive technologies are returned too: the caller decides what an inactive one means (HU-06 CA1). */
  readonly active: boolean;
};

/**
 * Exported application API of settings' technology catalog (PRD §8.3 stack). Commercial's project stack
 * check reads it through this class, never through the technology table. Bound by the technologies
 * module; consumers import the class.
 */
export class TechnologyCatalog {
  constructor(private readonly technologies: TechnologyRepository) {}

  /** The technologies with the given ids, each once; unknown ids are left out. */
  async findByIds(ids: readonly string[]): Promise<TechnologyCatalogEntry[]> {
    const rows = await this.technologies.findByIds([...new Set(ids)]);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      nameEn: row.nameEn,
      category: row.category,
      iconSlug: row.iconSlug,
      color: row.color,
      active: row.active,
    }));
  }
}
