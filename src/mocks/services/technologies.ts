// MOCK — technology catalog reads of Hito 1 (PRD §8.3 "Stack", §8.15, §12 `settings`). `fn(ctx, input)`,
// framework-free (C11). Projects reference technologies by id (`technologyIds`, PD-3); the usage count is
// derived here from the non-archived projects. Replaced by `src/server/services/technologies.service.ts`
// in Hito 2 (C9).
import type { Paginated } from "@/lib/validators/common";
import type {
  TechnologyFilter,
  TechnologyIdInput,
  TechnologyListRowDTO,
} from "@/lib/validators/technologies";
import type { MockServiceContext } from "../ctx";
import { ServiceError } from "../ctx";
import type { TechnologyRow } from "../fixtures/catalogs";
import type { MockStore } from "../store";
import { listRows, type ListSpec } from "./list";

/** Non-archived projects using the technology. */
export function technologyUsage(db: MockStore, technologyId: string): number {
  return db.projects.filter(
    (project) => !project.archivedAt && project.technologyIds.includes(technologyId),
  ).length;
}

function technologyListRow(db: MockStore, tech: TechnologyRow): TechnologyListRowDTO {
  return { ...tech, usageCount: technologyUsage(db, tech.id) };
}

const technologySpec: ListSpec<TechnologyListRowDTO> = {
  searchText: (row) => [row.name, row.nameEn, row.slug],
  sorters: {
    name: (row) => row.name,
    category: (row) => row.category,
    usageCount: (row) => row.usageCount,
    active: (row) => row.active,
  },
  defaultSort: "name:asc",
};

export async function listTechnologies(
  ctx: MockServiceContext,
  input: TechnologyFilter,
): Promise<Paginated<TechnologyListRowDTO>> {
  const rows = ctx.db.technologies
    .filter((tech) => !input.category || input.category.includes(tech.category))
    .filter((tech) => input.active === undefined || tech.active === input.active)
    .map((tech) => technologyListRow(ctx.db, tech));
  return listRows(rows, input, technologySpec);
}

/** One technology with its usage count. `NOT_FOUND` when the id does not exist. */
export async function getTechnology(
  ctx: MockServiceContext,
  input: TechnologyIdInput,
): Promise<TechnologyListRowDTO> {
  const tech = ctx.db.technologies.find((row) => row.id === input.id);
  if (!tech) throw new ServiceError("NOT_FOUND");
  return technologyListRow(ctx.db, tech);
}
