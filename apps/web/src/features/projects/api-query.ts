import type { ProjectListQuery, ProjectListSort } from "@/lib/api/types/projects";
import type { ProjectFilter } from "@/lib/validators/projects";

/**
 * Sort tokens of `GET /api/v1/projects`. The record is exhaustive over the generated union, so a contract
 * change that adds or removes a token fails `tsc` here (C8).
 */
const PROJECT_SORTS: Record<ProjectListSort, true> = {
  "code:asc": true,
  "code:desc": true,
  "name:asc": true,
  "name:desc": true,
  "status:asc": true,
  "status:desc": true,
  "startDate:asc": true,
  "startDate:desc": true,
  "targetEndDate:asc": true,
  "targetEndDate:desc": true,
  "createdAt:asc": true,
  "createdAt:desc": true,
  "contractedValueUsd:asc": true,
  "contractedValueUsd:desc": true,
  "invoicedUsd:asc": true,
  "invoicedUsd:desc": true,
  "collectedUsd:asc": true,
  "collectedUsd:desc": true,
  "toInvoiceUsd:asc": true,
  "toInvoiceUsd:desc": true,
};

function isProjectListSort(value: string): value is ProjectListSort {
  return Object.hasOwn(PROJECT_SORTS, value);
}

/** The table's parsed filter → the query parameters of `GET /api/v1/projects` (`api-contract.md` §3). */
export function toProjectListQuery(filter: ProjectFilter): ProjectListQuery {
  const query: ProjectListQuery = {
    page: filter.page,
    pageSize: filter.pageSize,
    archived: filter.includeArchived ? "include" : "exclude",
  };
  if (filter.q !== undefined) query.q = filter.q;
  if (filter.sort !== undefined && isProjectListSort(filter.sort)) query.sort = filter.sort;
  if (filter.status !== undefined) query.status = filter.status;
  if (filter.clientId !== undefined) query.clientId = filter.clientId;
  if (filter.technologyId !== undefined) query.technologyId = filter.technologyId;
  if (filter.tagId !== undefined) query.tagId = filter.tagId;
  if (filter.deliveryFrom !== undefined) query.deliveryFrom = filter.deliveryFrom;
  if (filter.deliveryTo !== undefined) query.deliveryTo = filter.deliveryTo;
  // The BE reads the flag as the literal `true`; `false` is the same as not filtering.
  if (filter.withoutBillingPlan === true) query.withoutBillingPlan = "true";
  return query;
}
