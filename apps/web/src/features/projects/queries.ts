import "server-only";
import { getServerApi } from "@/lib/api/server";
import { envelopeToActionError } from "@/lib/api/errors";
import {
  projectFilterSchema,
  projectIdInputSchema,
  type ProjectFilterInput,
} from "@/lib/validators/projects";
// MOCK — until cleanup: other modules still catch `ServiceError` from these reads (documents/notes prefill,
// `loadProjectOr404`); CLEAN replaces `@/server/errors` and those consumers.
import { ServiceError } from "@/server/errors";
import { toProjectListQuery } from "./api-query";

// Reads for the project screens (RSC): one BE call each, through the typed client. Authorization is the BE's
// (C13): a missing project, an archived one for a role without the trash grant, or a refused read arrive as
// 404/403 and are rethrown as the `ServiceError` the page and the other modules already catch.

/** The failure of a read: a known BE refusal becomes a `ServiceError`, anything else a plain error. */
function failure(request: string, error: unknown, status: number): Error {
  const code = envelopeToActionError(error).code;
  // MOCK — until cleanup: the BE error code → the `ServiceError` the cross-module readers catch.
  if (code === "NOT_FOUND" || code === "FORBIDDEN" || code === "VALIDATION") {
    return new ServiceError(code);
  }
  return new Error(`${request} failed with ${status}`);
}

/** One page of projects (`GET /api/v1/projects`); money fields are `null` for roles without the finance grant. */
export async function listProjects(filter: ProjectFilterInput = {}) {
  const api = await getServerApi();
  const { data, error, response } = await api.GET("/api/v1/projects", {
    params: { query: toProjectListQuery(projectFilterSchema.parse(filter)) },
  });
  if (!data) throw failure("GET /api/v1/projects", error, response.status);
  return data;
}

/** One project (`GET /api/v1/projects/{id}`). A BE 404 is `ServiceError("NOT_FOUND")`, which the page turns into `notFound()`. */
export async function getProject(id: string) {
  const { id: projectId } = projectIdInputSchema.parse({ id });
  const api = await getServerApi();
  const { data, error, response } = await api.GET("/api/v1/projects/{id}", {
    params: { path: { id: projectId } },
  });
  if (!data) throw failure(`GET /api/v1/projects/${projectId}`, error, response.status);
  return data;
}

/** The `/projects` overview (`GET /api/v1/projects/overview`; empty lists and `null` money for non-finance roles). */
export async function getProjectsOverview() {
  const api = await getServerApi();
  const { data, error, response } = await api.GET("/api/v1/projects/overview");
  if (!data) throw failure("GET /api/v1/projects/overview", error, response.status);
  return data;
}

/** The §8.4.4 summary of the billing tab (`GET /api/v1/projects/{id}/summary`); a role without the finance grant gets `FORBIDDEN`. */
export async function getProjectFinancials(id: string) {
  const { id: projectId } = projectIdInputSchema.parse({ id });
  const api = await getServerApi();
  const { data, error, response } = await api.GET("/api/v1/projects/{id}/summary", {
    params: { path: { id: projectId } },
  });
  if (!data) throw failure(`GET /api/v1/projects/${projectId}/summary`, error, response.status);
  return data;
}
