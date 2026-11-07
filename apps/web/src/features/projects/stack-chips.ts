import type { ProjectDetailDto } from "@/lib/api/types/projects";
import type { TechnologyChipDTO } from "@/lib/validators/technologies";

/**
 * The stack of a project as the shared technology chip the picker and the icons take. The wire chip carries no
 * `slug` (nothing on screen reads it), so it is filled with the icon slug to satisfy the type.
 */
export function stackChips(stack: ProjectDetailDto["stack"]): TechnologyChipDTO[] {
  // MOCK — until cleanup: `slug` exists on the chip type only because the mock services and fixtures need it.
  return stack.map((tech) => ({ ...tech, slug: tech.iconSlug ?? "" }));
}
