// MOCK — technology catalog of Hito 1 (PRD §8.3 "Stack", §8.15, §12 `settings`). `fn(ctx, input)`,
// framework-free (C11). Projects reference technologies by id (`technologyIds`, PD-3); the usage count is
// derived here from the non-archived projects. Replaced by `src/server/services/technologies.service.ts`
// in Hito 2 (C9).
//
// DT-72: `nameEn` is the optional English name; English display falls back to `name` (see
// `src/features/technologies/label.ts`). The store row already carries it, so no store change.
import { diffFields } from "@/lib/activity-diff";
import { VALIDATION_MESSAGES, type Paginated } from "@/lib/validators/common";
import type {
  CreateTechnologyInput,
  SetTechnologyActiveInput,
  TechnologyDetailDTO,
  TechnologyFilter,
  TechnologyIdInput,
  TechnologyListRowDTO,
  UpdateTechnologyInput,
} from "@/lib/validators/technologies";
import { SLUG_PATTERN } from "@/lib/validators/technologies";
import type { MockServiceContext } from "../ctx";
import { ServiceError } from "../ctx";
import { logActivity, mockTx } from "./activity";
import { nextMockId } from "../ids";
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

// ───────────────────────────── Writes ─────────────────────────────

/** Slug of a name, the same rule the fixtures use (`React Native` → `react-native`, `C#` → `c-sharp`). */
function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replaceAll("#", "-sharp")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function findById(ctx: MockServiceContext, id: string): TechnologyRow {
  const tech = ctx.db.technologies.find((row) => row.id === id);
  if (!tech) throw new ServiceError("NOT_FOUND");
  return tech;
}

/**
 * `CONFLICT` when another technology already has the name (case-insensitive) or the slug. `exceptId` is the
 * technology being edited, which may keep its own name and slug.
 */
function assertUnique(
  ctx: MockServiceContext,
  name: string,
  slug: string,
  exceptId?: string,
): void {
  const others = ctx.db.technologies.filter((tech) => tech.id !== exceptId);
  const fieldErrors: Record<string, string[]> = {};
  if (others.some((tech) => tech.name.toLowerCase() === name.toLowerCase())) {
    fieldErrors.name = ["catalogs.technologies.errors.nameTaken"];
  }
  if (others.some((tech) => tech.slug === slug)) {
    fieldErrors.slug = ["catalogs.technologies.errors.slugTaken"];
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new ServiceError("CONFLICT", { fieldErrors });
  }
}

/** Creates a technology. The slug comes from the name when omitted; name and slug must be unique. */
export async function createTechnology(
  ctx: MockServiceContext,
  input: CreateTechnologyInput,
): Promise<TechnologyDetailDTO> {
  const slug = input.slug ?? slugOf(input.name);
  if (!SLUG_PATTERN.test(slug)) {
    throw new ServiceError("VALIDATION", { fieldErrors: { slug: [VALIDATION_MESSAGES.invalidFormat] } });
  }
  assertUnique(ctx, input.name, slug);

  const row: TechnologyRow = {
    id: nextMockId(ctx.db.idCounters, "tec", (id) =>
      ctx.db.technologies.some((tech) => tech.id === id),
    ),
    name: input.name,
    nameEn: input.nameEn ?? null,
    slug,
    category: input.category,
    iconSlug: input.iconSlug ?? null,
    color: input.color ?? null,
    active: input.active,
  };
  ctx.db.technologies.push(row);

  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "SETTINGS_CHANGE",
    entityType: "SETTING",
    entityId: row.id,
    entityLabel: row.name,
    changes: { technology: [null, row.name] },
  });
  return technologyListRow(ctx.db, row);
}

/** Edits every editable field. The name and slug stay unique; the activity entry keeps the field diff. */
export async function updateTechnology(
  ctx: MockServiceContext,
  input: UpdateTechnologyInput,
): Promise<TechnologyDetailDTO> {
  const row = findById(ctx, input.id);
  const slug = input.slug ?? slugOf(input.name);
  if (!SLUG_PATTERN.test(slug)) {
    throw new ServiceError("VALIDATION", { fieldErrors: { slug: [VALIDATION_MESSAGES.invalidFormat] } });
  }
  assertUnique(ctx, input.name, slug, row.id);

  const before = { ...row };
  Object.assign(row, {
    name: input.name,
    nameEn: input.nameEn ?? null,
    slug,
    category: input.category,
    iconSlug: input.iconSlug ?? null,
    color: input.color ?? null,
    active: input.active,
  });

  const changes = diffFields(before, row, {
    fields: ["name", "nameEn", "slug", "category", "iconSlug", "color", "active"],
  });
  if (changes) {
    await logActivity(mockTx(ctx), {
      actorType: "USER",
      actorId: ctx.user.id,
      action: "SETTINGS_CHANGE",
      entityType: "SETTING",
      entityId: row.id,
      entityLabel: row.name,
      changes,
    });
  }
  return technologyListRow(ctx.db, row);
}

/** Activates or deactivates a technology. Deactivation is the way to retire one that projects use. */
export async function setTechnologyActive(
  ctx: MockServiceContext,
  input: SetTechnologyActiveInput,
): Promise<TechnologyDetailDTO> {
  const row = findById(ctx, input.id);
  if (row.active !== input.active) {
    const changes = diffFields({ active: row.active }, { active: input.active }, {
      fields: ["active"],
    });
    row.active = input.active;
    await logActivity(mockTx(ctx), {
      actorType: "USER",
      actorId: ctx.user.id,
      action: "SETTINGS_CHANGE",
      entityType: "SETTING",
      entityId: row.id,
      entityLabel: row.name,
      changes,
    });
  }
  return technologyListRow(ctx.db, row);
}

/**
 * Removes a technology. A technology used by a non-archived project is locked (`INTEGRITY_LOCK`, HU-06 CA3):
 * the user deactivates it instead. Catalog rows are not soft-deleted (data-rules.md §6), so an unused one is
 * removed for good; archived projects lose the id so no stack points at a missing technology.
 */
export async function deleteTechnology(
  ctx: MockServiceContext,
  input: TechnologyIdInput,
): Promise<TechnologyIdInput> {
  const row = findById(ctx, input.id);
  if (technologyUsage(ctx.db, row.id) > 0) {
    throw new ServiceError("INTEGRITY_LOCK", { message: "catalogs.technologies.errors.inUse" });
  }

  ctx.db.technologies.splice(ctx.db.technologies.indexOf(row), 1);
  for (const project of ctx.db.projects) {
    if (project.technologyIds.includes(row.id)) {
      project.technologyIds = project.technologyIds.filter((id) => id !== row.id);
    }
  }

  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "SETTINGS_CHANGE",
    entityType: "SETTING",
    entityId: row.id,
    entityLabel: row.name,
    changes: { technology: [row.name, null] },
  });
  return { id: row.id };
}
