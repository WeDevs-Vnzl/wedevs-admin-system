import type { DateOnly } from '../../../../shared/domain/business-date';
import type { EntityRef } from '../../../../shared/domain/entity-ref';
import type { ProjectStatus } from '../../../../shared/domain/enums';
import type { ArchivedMode, SortSpec } from '../../../../shared/domain/list-query';
import type { ProjectClientLink, ProjectRecord } from '../../domain/project';
import type { ProjectLinkRecord } from '../../domain/project-link';

export const PROJECT_REPOSITORY = Symbol('PROJECT_REPOSITORY');

/** Facets of the project list, already parsed (`api-contract.md` §3). */
export interface ProjectListFilters {
  readonly status?: readonly ProjectStatus[];
  readonly clientIds?: readonly string[];
  readonly technologyIds?: readonly string[];
  readonly tagIds?: readonly string[];
  /** Delivery window over `targetEndDate`, inclusive. */
  readonly deliveryFrom?: DateOnly;
  readonly deliveryTo?: DateOnly;
  readonly q?: string;
}

export interface ProjectListRequest {
  readonly filters: ProjectListFilters;
  readonly archived: ArchivedMode;
  readonly sort: SortSpec;
  readonly page: number;
  readonly pageSize: number;
}

/** The money columns of the list and detail headline, decimal strings (`"0.00"` when the row is absent). */
export interface ProjectMetricsRow {
  readonly contractedValueUsd: string;
  readonly invoicedUsd: string;
  readonly collectedUsd: string;
  readonly toInvoiceUsd: string;
}

/**
 * `Project` rows with their client links, stack and links (PRD §10.2). Reads and writes run in the
 * caller's unit of work when one is open. `findById` returns archived rows too (`archivedAt` set): the
 * use case decides what an archived row means (C14, C19). Writes need the caller's unit of work.
 */
export interface ProjectRepository {
  findById(id: string): Promise<ProjectRecord | null>;
  /**
   * `findById` after taking the row lock (`FOR UPDATE`), held until the unit of work ends: every mutation
   * of a project loads it this way, so two of them on one project run one after the other and the second
   * reads what the first committed. Needs the caller's unit of work.
   */
  findByIdForUpdate(id: string): Promise<ProjectRecord | null>;
  /** Inserts the project with its clients, stack and links. */
  insert(record: ProjectRecord, actorId: string): Promise<void>;
  /** Writes the editable scalar columns (name…endDate). Never `status`: only `updateStatus` moves it. */
  updateFields(record: ProjectRecord, actorId: string): Promise<void>;
  /** Writes `status` with the dates a status change may set (HU-08); the caller checked the transition. */
  updateStatus(
    record: Pick<ProjectRecord, 'id' | 'status' | 'startDate' | 'endDate'>,
    actorId: string,
  ): Promise<void>;
  /** Bumps `updatedAt` after a change of clients, stack or links. */
  touch(id: string, actorId: string): Promise<void>;
  /** Makes `clients` the exact client set: removes, re-roles and adds. */
  replaceClients(projectId: string, clients: readonly ProjectClientLink[]): Promise<void>;
  replaceTechnologies(projectId: string, technologyIds: readonly string[]): Promise<void>;
  /** Makes `links` the exact link set of the project (links not listed are deleted). */
  replaceLinks(projectId: string, links: readonly ProjectLinkRecord[]): Promise<void>;
  /** Archives (`at` set) or restores (`at` null) the projects. */
  setArchived(ids: readonly string[], at: Date | null, actorId: string | null): Promise<void>;

  list(request: ProjectListRequest): Promise<{ records: ProjectRecord[]; total: number }>;
  /** `ProjectMetrics` rows by project id; absent rows are absent from the map. */
  metricsFor(ids: readonly string[]): Promise<Map<string, ProjectMetricsRow>>;

  /** The ids among `ids` that are live clients (exist and are not archived). */
  liveClientIds(ids: readonly string[]): Promise<string[]>;
  /** Display refs of clients, archived ones included; unknown ids are absent. */
  clientRefs(ids: readonly string[]): Promise<EntityRef[]>;
  /** Live projects linked to the client (the value of `ClientMetrics.projectCount`). */
  countLiveProjectsOfClient(clientId: string): Promise<number>;

  /** Live projects whose stack lists the technology. */
  countLiveByTechnology(technologyId: string): Promise<number>;
  /** Drops the technology from the stacks of archived projects; joins the caller's unit of work. */
  detachTechnologyFromArchived(technologyId: string): Promise<void>;
}
