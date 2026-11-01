import { Injectable } from '@nestjs/common';
import {
  dateOnlyToDbDate,
  dbDateToDateOnly,
} from '../../../shared/infrastructure/prisma/decimal-mapper';
import type { EntityRef } from '../../../shared/domain/entity-ref';
import type { SortSpec } from '../../../shared/domain/list-query';
import { pageWindow } from '../../../shared/domain/pagination';
import type { RichTextDoc } from '../../../shared/domain/rich-text';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { archivedWhere, escapeLike } from '../../../shared/infrastructure/prisma/prisma-list';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type {
  ProjectListRequest,
  ProjectMetricsRow,
  ProjectRepository,
} from '../application/ports/project.repository.port';
import type { ProjectClientLink, ProjectRecord } from '../domain/project';
import type { ProjectLinkRecord } from '../domain/project-link';

const INCLUDE = {
  clients: { orderBy: [{ createdAt: 'asc' }, { clientId: 'asc' }] },
  technologies: true,
  links: { orderBy: [{ group: 'asc' }, { order: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ProjectInclude;

type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof INCLUDE }>;

function toRecord(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    summary: row.summary,
    description: (row.description as RichTextDoc | null) ?? null,
    descriptionText: row.descriptionText,
    status: row.status,
    startDate: row.startDate ? dbDateToDateOnly(row.startDate) : null,
    targetEndDate: row.targetEndDate ? dbDateToDateOnly(row.targetEndDate) : null,
    endDate: row.endDate ? dbDateToDateOnly(row.endDate) : null,
    clients: row.clients.map((link) => ({
      clientId: link.clientId,
      role: link.role,
      linkedAt: link.createdAt,
    })),
    technologyIds: row.technologies.map((link) => link.technologyId),
    links: row.links.map((link) => ({
      id: link.id,
      group: link.group,
      label: link.label,
      url: link.url,
      order: link.order,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.deletedAt,
  };
}

const dbDate = (value: string | null): Date | null => (value ? dateOnlyToDbDate(value) : null);
const json = (doc: RichTextDoc | null): Prisma.InputJsonValue | typeof Prisma.JsonNull =>
  doc ? (doc as unknown as Prisma.InputJsonValue) : Prisma.JsonNull;

/** The editable columns; `status` is written on insert and by `updateStatus` only. */
function fieldScalars(record: ProjectRecord) {
  return {
    name: record.name,
    summary: record.summary,
    description: json(record.description),
    descriptionText: record.descriptionText,
    startDate: dbDate(record.startDate),
    targetEndDate: dbDate(record.targetEndDate),
    endDate: dbDate(record.endDate),
  };
}

const scalars = (record: ProjectRecord) => ({ ...fieldScalars(record), status: record.status });

/** `ORDER BY` expressions of the sortable columns: trusted fragments, never user text. */
const SORT_SQL: Readonly<Record<string, { sql: Prisma.Sql; nullable?: boolean }>> = {
  code: { sql: Prisma.sql`p."code"` },
  name: { sql: Prisma.sql`unaccent(lower(p."name"))` },
  // Postgres sorts an enum in declaration order, which is the status order of the pipeline.
  status: { sql: Prisma.sql`p."status"` },
  startDate: { sql: Prisma.sql`p."startDate"`, nullable: true },
  targetEndDate: { sql: Prisma.sql`p."targetEndDate"`, nullable: true },
  createdAt: { sql: Prisma.sql`p."createdAt"` },
  contractedValueUsd: { sql: Prisma.sql`COALESCE(m."contractedUsd", 0)` },
  invoicedUsd: { sql: Prisma.sql`COALESCE(m."invoicedUsd", 0)` },
  collectedUsd: { sql: Prisma.sql`COALESCE(m."collectedUsd", 0)` },
  toInvoiceUsd: { sql: Prisma.sql`COALESCE(m."toInvoiceUsd", 0)` },
};

function orderBy(sort: SortSpec): Prisma.Sql {
  const column = SORT_SQL[sort.field];
  if (!column) throw new Error(`Sort field not in the project sort map: ${sort.field}`);
  const direction = Prisma.raw(sort.direction === 'desc' ? 'DESC' : 'ASC');
  const nulls = column.nullable ? Prisma.raw(' NULLS LAST') : Prisma.empty;
  return Prisma.sql`${column.sql} ${direction}${nulls}, p."id" ASC`;
}

/**
 * `WHERE` of the list, over `"Project" p`. Archived mode, facets and the free-text search (code, name and
 * the trade/legal names of the linked clients through `EXISTS`, accent- and case-insensitive).
 */
function listWhere(request: ProjectListRequest): Prisma.Sql {
  const { filters, archived } = request;
  const parts: Prisma.Sql[] = [];
  if (archived === 'exclude') parts.push(Prisma.sql`p."deletedAt" IS NULL`);
  if (archived === 'only') parts.push(Prisma.sql`p."deletedAt" IS NOT NULL`);

  const any = (list: readonly string[]) => Prisma.sql`ANY(${[...list]}::text[])`;
  if (filters.status?.length) parts.push(Prisma.sql`p."status"::text = ${any(filters.status)}`);
  if (filters.clientIds?.length) {
    parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "ProjectClient" pc
      WHERE pc."projectId" = p."id" AND pc."clientId" = ${any(filters.clientIds)})`);
  }
  if (filters.technologyIds?.length) {
    parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "ProjectTechnology" pt
      WHERE pt."projectId" = p."id" AND pt."technologyId" = ${any(filters.technologyIds)})`);
  }
  if (filters.tagIds?.length) {
    // Read-only facet over settings' assignment rows (`TagAssignment.projectId`).
    parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "TagAssignment" ta
      WHERE ta."projectId" = p."id" AND ta."tagId" = ${any(filters.tagIds)})`);
  }
  if (filters.deliveryFrom) {
    parts.push(Prisma.sql`p."targetEndDate" >= ${filters.deliveryFrom}::date`);
  }
  if (filters.deliveryTo) {
    parts.push(Prisma.sql`p."targetEndDate" <= ${filters.deliveryTo}::date`);
  }
  if (filters.withoutBillingPlan) {
    // Read-only join over finance's `BillingPlan` (DT-118 / Q-BE3-6), so the page and the total stay in SQL.
    parts.push(
      Prisma.sql`NOT EXISTS (SELECT 1 FROM "BillingPlan" bp WHERE bp."projectId" = p."id")`,
    );
  }
  const text = filters.q?.trim();
  if (text) parts.push(searchCondition(text));
  return parts.length > 0 ? Prisma.join(parts, ' AND ') : Prisma.sql`TRUE`;
}

function searchCondition(text: string): Prisma.Sql {
  const pattern = escapeLike(text);
  const like = (column: Prisma.Sql) =>
    Prisma.sql`unaccent(lower(${column})) LIKE '%' || unaccent(lower(${pattern})) || '%' ESCAPE '\\'`;
  return Prisma.sql`(${like(Prisma.sql`p."code"`)} OR ${like(Prisma.sql`p."name"`)} OR EXISTS (
    SELECT 1 FROM "ProjectClient" pcq JOIN "Client" cq ON cq."id" = pcq."clientId"
    WHERE pcq."projectId" = p."id"
      AND (${like(Prisma.sql`cq."tradeName"`)} OR ${like(Prisma.sql`cq."legalName"`)})))`;
}

/**
 * `Project` rows through the current transaction (or the base client outside a unit of work), with their
 * client links, stack and links. Writes need the caller's unit of work. Client and metrics reads here are
 * commercial's own narrow queries (rule (e): no other context's repository is used).
 */
@Injectable()
export class PrismaProjectRepository implements ProjectRepository {
  constructor(private readonly host: TransactionHost) {}

  async findById(id: string): Promise<ProjectRecord | null> {
    const row = await this.host.db.project.findUnique({ where: { id }, include: INCLUDE });
    return row ? toRecord(row) : null;
  }

  async findByIdForUpdate(id: string): Promise<ProjectRecord | null> {
    const tx = this.host.requireTransaction('ProjectRepository.findByIdForUpdate');
    // Blocks while another transaction holds the row; the read after it sees what that one committed.
    await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${id} FOR UPDATE`;
    return this.findById(id);
  }

  async insert(record: ProjectRecord, actorId: string): Promise<void> {
    const tx = this.host.requireTransaction('ProjectRepository.insert');
    await tx.project.create({
      data: {
        id: record.id,
        code: record.code,
        ...scalars(record),
        createdAt: record.createdAt,
        createdById: actorId,
        updatedById: actorId,
        clients: {
          create: record.clients.map((link) => ({
            clientId: link.clientId,
            role: link.role,
            createdAt: link.linkedAt,
          })),
        },
        technologies: { create: record.technologyIds.map((technologyId) => ({ technologyId })) },
        links: {
          create: record.links.map((link) => ({
            id: link.id,
            group: link.group,
            label: link.label,
            url: link.url,
            order: link.order,
          })),
        },
      },
    });
  }

  async updateFields(record: ProjectRecord, actorId: string): Promise<void> {
    const tx = this.host.requireTransaction('ProjectRepository.updateFields');
    await tx.project.update({
      where: { id: record.id },
      data: { ...fieldScalars(record), updatedById: actorId },
    });
  }

  async updateStatus(
    record: Pick<ProjectRecord, 'id' | 'status' | 'startDate' | 'endDate'>,
    actorId: string,
  ): Promise<void> {
    const tx = this.host.requireTransaction('ProjectRepository.updateStatus');
    await tx.project.update({
      where: { id: record.id },
      data: {
        status: record.status,
        startDate: dbDate(record.startDate),
        endDate: dbDate(record.endDate),
        updatedById: actorId,
      },
    });
  }

  async touch(id: string, actorId: string): Promise<void> {
    const tx = this.host.requireTransaction('ProjectRepository.touch');
    await tx.project.update({
      where: { id },
      data: { updatedById: actorId, updatedAt: new Date() },
    });
  }

  async replaceClients(projectId: string, clients: readonly ProjectClientLink[]): Promise<void> {
    const tx = this.host.requireTransaction('ProjectRepository.replaceClients');
    const keep = clients.map((link) => link.clientId);
    await tx.projectClient.deleteMany({ where: { projectId, clientId: { notIn: keep } } });
    const existing = await tx.projectClient.findMany({ where: { projectId } });
    for (const link of clients) {
      const current = existing.find((row) => row.clientId === link.clientId);
      if (!current) {
        await tx.projectClient.create({
          data: {
            projectId,
            clientId: link.clientId,
            role: link.role,
            createdAt: link.linkedAt,
          },
        });
      } else if (current.role !== link.role) {
        await tx.projectClient.update({
          where: { projectId_clientId: { projectId, clientId: link.clientId } },
          data: { role: link.role },
        });
      }
    }
  }

  async replaceTechnologies(projectId: string, technologyIds: readonly string[]): Promise<void> {
    const tx = this.host.requireTransaction('ProjectRepository.replaceTechnologies');
    const keep = [...new Set(technologyIds)];
    await tx.projectTechnology.deleteMany({ where: { projectId, technologyId: { notIn: keep } } });
    await tx.projectTechnology.createMany({
      data: keep.map((technologyId) => ({ projectId, technologyId })),
      skipDuplicates: true,
    });
  }

  async replaceLinks(projectId: string, links: readonly ProjectLinkRecord[]): Promise<void> {
    const tx = this.host.requireTransaction('ProjectRepository.replaceLinks');
    await tx.projectLink.deleteMany({
      where: { projectId, id: { notIn: links.map((link) => link.id) } },
    });
    for (const link of links) {
      const values = { group: link.group, label: link.label, url: link.url, order: link.order };
      await tx.projectLink.upsert({
        where: { id: link.id },
        create: { id: link.id, projectId, ...values },
        update: values,
      });
    }
  }

  async setArchived(
    ids: readonly string[],
    at: Date | null,
    actorId: string | null,
  ): Promise<void> {
    const tx = this.host.requireTransaction('ProjectRepository.setArchived');
    await tx.project.updateMany({
      where: { id: { in: [...ids] } },
      data: { deletedAt: at, deletedById: at === null ? null : actorId, updatedAt: new Date() },
    });
  }

  async list(request: ProjectListRequest): Promise<{ records: ProjectRecord[]; total: number }> {
    const where = listWhere(request);
    const { skip, take } = pageWindow(request.page, request.pageSize);
    const pageRows = await this.host.db.$queryRaw<{ id: string }[]>`
      SELECT p."id" FROM "Project" p
      LEFT JOIN "ProjectMetrics" m ON m."projectId" = p."id"
      WHERE ${where}
      ORDER BY ${orderBy(request.sort)}
      LIMIT ${take} OFFSET ${skip}`;
    const countRows = await this.host.db.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int AS "total" FROM "Project" p WHERE ${where}`;
    const total = countRows[0]?.total ?? 0;

    const ids = pageRows.map((row) => row.id);
    if (ids.length === 0) return { records: [], total };
    const rows = await this.host.db.project.findMany({
      where: { id: { in: ids }, ...archivedWhere('include') },
      include: INCLUDE,
    });
    const position = new Map(ids.map((id, index) => [id, index]));
    rows.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
    return { records: rows.map(toRecord), total };
  }

  async metricsFor(ids: readonly string[]): Promise<Map<string, ProjectMetricsRow>> {
    const rows = await this.host.db.projectMetrics.findMany({
      where: { projectId: { in: [...ids] } },
    });
    return new Map(
      rows.map((row) => [
        row.projectId,
        {
          contractedValueUsd: row.contractedUsd.toFixed(2),
          invoicedUsd: row.invoicedUsd.toFixed(2),
          collectedUsd: row.collectedUsd.toFixed(2),
          toInvoiceUsd: row.toInvoiceUsd.toFixed(2),
        },
      ]),
    );
  }

  async lockClients(ids: readonly string[]): Promise<void> {
    const tx = this.host.requireTransaction('ProjectRepository.lockClients');
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    // ORDER BY runs before the row locks (LockRows sits above Sort), so the locks are taken in id order;
    // COLLATE "C" is the byte order every caller of this method agrees on.
    await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = ANY(${unique}::text[])
      ORDER BY "id" COLLATE "C" FOR UPDATE`;
  }

  async liveClientIds(ids: readonly string[]): Promise<string[]> {
    // The soft-delete extension keeps archived clients out of `findMany`.
    const rows = await this.host.db.client.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async clientRefs(ids: readonly string[]): Promise<EntityRef[]> {
    if (ids.length === 0) return [];
    const rows = await this.host.db.client.findMany({
      where: { id: { in: [...new Set(ids)] }, ...archivedWhere('include') },
      select: { id: true, code: true, tradeName: true },
    });
    return rows.map((row) => ({
      type: 'CLIENT' as const,
      id: row.id,
      code: row.code,
      label: row.tradeName,
    }));
  }

  async countLiveProjectsOfClient(clientId: string): Promise<number> {
    return this.host.db.project.count({ where: { clients: { some: { clientId } } } });
  }

  async countLiveByTechnology(technologyId: string): Promise<number> {
    return this.host.db.project.count({ where: { technologies: { some: { technologyId } } } });
  }

  async detachTechnologyFromArchived(technologyId: string): Promise<void> {
    const tx = this.host.requireTransaction('ProjectRepository.detachTechnologyFromArchived');
    await tx.projectTechnology.deleteMany({
      where: { technologyId, project: { deletedAt: { not: null } } },
    });
  }
}
