import type { EntityRef } from '../../../shared/domain/entity-ref';
import type { ProjectStatus, UserRole } from '../../../shared/domain/enums';

export const FINANCE_LOOKUPS_SOURCE = Symbol('FINANCE_LOOKUPS_SOURCE');

export interface ClientRow {
  readonly id: string;
  readonly code: string;
  readonly tradeName: string;
  readonly archived: boolean;
}

export interface ProjectRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly clientIds: readonly string[];
  readonly archived: boolean;
}

export interface UserRow {
  readonly id: string;
  readonly name: string;
  readonly role: UserRole;
  readonly archived: boolean;
}

/**
 * Read-only source of the rows `FinanceLookups` answers from. Rows come back with their `archived` flag
 * (soft delete included); the lookups decide what "live" means. Joins the caller's unit of work when one is open.
 */
export interface FinanceLookupsSource {
  findClient(id: string): Promise<ClientRow | null>;
  findProject(id: string): Promise<ProjectRow | null>;
  /** Projects linked to the client, archived ones included, ordered by code. */
  findProjectsOfClient(clientId: string): Promise<ProjectRow[]>;
  findUser(id: string): Promise<UserRow | null>;
}

export interface LiveProject {
  readonly ref: EntityRef;
  readonly status: ProjectStatus;
  readonly clientIds: readonly string[];
}

export interface PartnerRef {
  readonly id: string;
  readonly label: string;
  readonly role: UserRole;
}

/**
 * Commercial's exported API for finance rules (boundary rule e, C14): a client id, a project id or a partner
 * id sent by the caller is never trusted without a lookup. Read-only and without a `can()` of its own: the
 * finance use case authorized before calling. Every method answers `null`/`false` for an unknown or archived
 * row; the caller throws its own error. Depends on nothing in `finance`.
 */
export class FinanceLookups {
  constructor(private readonly source: FinanceLookupsSource) {}

  async liveClientRef(id: string): Promise<EntityRef | null> {
    const client = await this.source.findClient(id);
    if (client === null || client.archived) return null;
    return { type: 'CLIENT', id: client.id, code: client.code, label: client.tradeName };
  }

  async liveProject(id: string): Promise<LiveProject | null> {
    const project = await this.source.findProject(id);
    return project === null || project.archived ? null : toLiveProject(project);
  }

  /** True when the project is live and linked to the client. */
  async projectBelongsToClient(projectId: string, clientId: string): Promise<boolean> {
    const project = await this.source.findProject(projectId);
    return project !== null && !project.archived && project.clientIds.includes(clientId);
  }

  async liveProjectsOfClient(clientId: string): Promise<LiveProject[]> {
    const projects = await this.source.findProjectsOfClient(clientId);
    return projects.filter((p) => !p.archived).map(toLiveProject);
  }

  /** An active user, the only kind that can be the partner of a movement. */
  async partnerRef(userId: string): Promise<PartnerRef | null> {
    const user = await this.source.findUser(userId);
    if (user === null || user.archived) return null;
    return { id: user.id, label: user.name, role: user.role };
  }
}

function toLiveProject(project: ProjectRow): LiveProject {
  return {
    ref: { type: 'PROJECT', id: project.id, code: project.code, label: project.name },
    status: project.status,
    clientIds: project.clientIds,
  };
}
