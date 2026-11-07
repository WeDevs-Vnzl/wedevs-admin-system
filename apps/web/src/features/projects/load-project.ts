import "server-only";
import { notFound } from "next/navigation";
import { getProject } from "./queries";
// MOCK — until cleanup: the class the BE reads throw (see `queries.ts`).
import { ServiceError } from "@/lib/service-error";
import type { ProjectDetailDto } from "@/lib/api/types/projects";

/**
 * The project of a detail or edit page. Unknown, archived (for roles that may not restore) and malformed ids
 * render the in-shell not-found page (`notFound()`); other errors propagate.
 */
export async function loadProjectOr404(id: string): Promise<ProjectDetailDto> {
  try {
    return await getProject(id);
  } catch (error) {
    if (
      error instanceof ServiceError &&
      (error.code === "NOT_FOUND" || error.code === "VALIDATION")
    ) {
      notFound();
    }
    if (error instanceof Error && error.name === "ZodError") notFound();
    throw error;
  }
}
