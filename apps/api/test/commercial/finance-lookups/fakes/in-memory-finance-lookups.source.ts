import type {
  ClientRow,
  FinanceLookupsSource,
  ProjectRow,
  UserRow,
} from '../../../../src/modules/commercial/application/finance-lookups';

/** In-memory `FinanceLookupsSource`: rows are seeded by the test, archived ones included. */
export class InMemoryFinanceLookupsSource implements FinanceLookupsSource {
  readonly clients = new Map<string, ClientRow>();
  readonly projects = new Map<string, ProjectRow>();
  readonly users = new Map<string, UserRow>();

  findClient(id: string): Promise<ClientRow | null> {
    return Promise.resolve(this.clients.get(id) ?? null);
  }

  findProject(id: string): Promise<ProjectRow | null> {
    return Promise.resolve(this.projects.get(id) ?? null);
  }

  findProjectsOfClient(clientId: string): Promise<ProjectRow[]> {
    return Promise.resolve(
      [...this.projects.values()].filter((p) => p.clientIds.includes(clientId)),
    );
  }

  findUser(id: string): Promise<UserRow | null> {
    return Promise.resolve(this.users.get(id) ?? null);
  }
}
