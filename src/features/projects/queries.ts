import "server-only";
import {
  getProjectsOverviewInputSchema,
  projectFilterSchema,
  projectIdInputSchema,
  type ProjectFilterInput,
} from "@/lib/validators/projects";
import * as projects from "@/mocks/services/projects";
import { can } from "@/server/auth/permissions";
import { getServiceContext, ServiceError } from "@/server/context";

// Reads for the project screens (RSC). Every read over business records needs the `read` grant (DT-71); a
// missing project is a `NOT_FOUND` that the page turns into `notFound()`.

async function readContext() {
  const ctx = await getServiceContext();
  if (!can(ctx.user, "read", "project")) throw new ServiceError("FORBIDDEN");
  return ctx;
}

export async function listProjects(filter: ProjectFilterInput = {}) {
  return projects.listProjects(await readContext(), projectFilterSchema.parse(filter));
}

export async function getProject(id: string) {
  return projects.getProject(await readContext(), projectIdInputSchema.parse({ id }));
}

export async function getProjectsOverview() {
  return projects.getProjectsOverview(
    await readContext(),
    getProjectsOverviewInputSchema.parse({}),
  );
}
