import "server-only";
import { notFound } from "next/navigation";
import { getProject } from "./queries";
import { ServiceError } from "@/server/errors";
import type { ProjectDetailDTO } from "@/lib/validators/projects";

/**
 * The project of a detail or edit page. Unknown, archived (for roles that may not restore) and malformed ids
 * render the in-shell not-found page (`notFound()`); other errors propagate.
 */
export async function loadProjectOr404(id: string): Promise<ProjectDetailDTO> {
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
