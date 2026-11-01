import { Injectable } from '@nestjs/common';
import { TechnologyCatalog } from '../../settings/application/technology-catalog';
import type {
  ProjectTechnologyCatalogPort,
  ProjectTechnologyEntry,
} from '../application/ports/project-technology-catalog.port';

/** `ProjectTechnologyCatalogPort` over settings' exported `TechnologyCatalog` (rule (e)). */
@Injectable()
export class SettingsTechnologyCatalogAdapter implements ProjectTechnologyCatalogPort {
  constructor(private readonly catalog: TechnologyCatalog) {}

  async findByIds(ids: readonly string[]): Promise<ProjectTechnologyEntry[]> {
    if (ids.length === 0) return [];
    return (await this.catalog.findByIds(ids)).map((entry) => ({
      id: entry.id,
      name: entry.name,
      nameEn: entry.nameEn,
      category: entry.category,
      iconSlug: entry.iconSlug,
      color: entry.color,
      active: entry.active,
    }));
  }
}
