import type {
  ProjectTechnologyCatalogPort,
  ProjectTechnologyEntry,
} from '../../../../src/modules/commercial/application/ports/project-technology-catalog.port';

export const NEXT_JS: ProjectTechnologyEntry = {
  id: 'tec_next',
  name: 'Next.js',
  nameEn: null,
  category: 'FRONTEND',
  iconSlug: 'nextdotjs',
  color: null,
  active: true,
};
export const RUST: ProjectTechnologyEntry = {
  id: 'tec_rust',
  name: 'Rust',
  nameEn: null,
  category: 'LENGUAJE',
  iconSlug: 'rust',
  color: null,
  active: true,
};
export const REACT: ProjectTechnologyEntry = {
  id: 'tec_react',
  name: 'React',
  nameEn: null,
  category: 'FRONTEND',
  iconSlug: 'react',
  color: null,
  active: false,
};

export class FakeTechnologyCatalog implements ProjectTechnologyCatalogPort {
  private readonly entries = new Map<string, ProjectTechnologyEntry>();

  constructor(...seed: ProjectTechnologyEntry[]) {
    for (const entry of seed) this.entries.set(entry.id, entry);
  }

  async findByIds(ids: readonly string[]): Promise<ProjectTechnologyEntry[]> {
    return [...new Set(ids)].flatMap((id) => {
      const entry = this.entries.get(id);
      return entry ? [entry] : [];
    });
  }
}
