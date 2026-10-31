import { Injectable } from '@nestjs/common';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type {
  ClientRow,
  FinanceLookupsSource,
  ProjectRow,
  UserRow,
} from '../application/finance-lookups';

/**
 * Reads the rows behind `FinanceLookups`. Archived rows are requested explicitly (`deletedAt: undefined`)
 * because the soft-delete extension would otherwise hide them. The `User` read is the one table outside
 * commercial: identity exports no user lookup, so it is a narrow read-only select of three columns
 * (DT-118 style), never a write.
 */
@Injectable()
export class PrismaFinanceLookups implements FinanceLookupsSource {
  constructor(private readonly host: TransactionHost) {}

  async findClient(id: string): Promise<ClientRow | null> {
    const row = await this.host.db.client.findFirst({
      where: { id, deletedAt: undefined },
      select: { id: true, code: true, tradeName: true, deletedAt: true },
    });
    return (
      row && {
        id: row.id,
        code: row.code,
        tradeName: row.tradeName,
        archived: row.deletedAt !== null,
      }
    );
  }

  async findProject(id: string): Promise<ProjectRow | null> {
    const row = await this.host.db.project.findFirst({
      where: { id, deletedAt: undefined },
      select: projectSelect,
    });
    return row && toProjectRow(row);
  }

  async findProjectsOfClient(clientId: string): Promise<ProjectRow[]> {
    const rows = await this.host.db.project.findMany({
      where: { deletedAt: undefined, clients: { some: { clientId } } },
      select: projectSelect,
      orderBy: { code: 'asc' },
    });
    return rows.map(toProjectRow);
  }

  async findUser(id: string): Promise<UserRow | null> {
    const row = await this.host.db.user.findFirst({
      where: { id, deletedAt: undefined },
      select: { id: true, name: true, role: true, deletedAt: true },
    });
    return row && { id: row.id, name: row.name, role: row.role, archived: row.deletedAt !== null };
  }
}

const projectSelect = {
  id: true,
  code: true,
  name: true,
  status: true,
  deletedAt: true,
  clients: { select: { clientId: true }, orderBy: { createdAt: 'asc' as const } },
};

function toProjectRow(row: {
  id: string;
  code: string;
  name: string;
  status: ProjectRow['status'];
  deletedAt: Date | null;
  clients: { clientId: string }[];
}): ProjectRow {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    clientIds: row.clients.map((c) => c.clientId),
    archived: row.deletedAt !== null,
  };
}
