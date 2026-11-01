import { Injectable } from '@nestjs/common';
import { toDateOnly } from '../../../shared/domain/business-date';
import { roundMoney } from '../../../shared/domain/money';
import { firstWords } from '../../../shared/domain/rich-text';
import {
  dbDateToDateOnly,
  decimalToString,
} from '../../../shared/infrastructure/prisma/decimal-mapper';
import type { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { graphNodeId } from '../domain';
import type {
  GraphNodeFacts,
  GraphNodeType,
  GraphPresence,
  GraphReadPort,
  GraphReadScope,
  GraphRef,
  GraphRelationKey,
  GraphRelationRow,
} from '../application/ports/graph-read.port';

/** Technology icons on a project card (PRD §8.12.2). */
const STACK_ICONS = 4;
/** Words of a note's excerpt on its hover card. */
const EXCERPT_WORDS = 20;

const money = (value: Prisma.Decimal): string => roundMoney(decimalToString(value));
const ZERO = '0.00';

/** Column of each link table that points at each entity type. */
const DOCUMENT_LINK_COLUMN = {
  CLIENT: 'clientId',
  CONTACT: 'contactId',
  PROJECT: 'projectId',
  INVOICE: 'invoiceId',
  PAYMENT: 'paymentId',
  EXPENSE: 'expenseId',
} as const;
const NOTE_LINK_COLUMN = { ...DOCUMENT_LINK_COLUMN, DOCUMENT: 'documentId' } as const;
const TAG_COLUMN = { ...NOTE_LINK_COLUMN, NOTE: 'noteId' } as const;

type LinkTable = 'documentLink' | 'noteLink' | 'tagAssignment';
type LinkRow = Record<string, string | null>;
type Push = (self: GraphRef, row: GraphRelationRow) => void;
type Facts = { ref: GraphRef; facts: GraphNodeFacts }[];

interface FactsQuery {
  /** `null` lists every row of the type. */
  readonly ids: readonly string[] | null;
  readonly includeArchived: boolean;
  /** Loads the tags and technologies the global filters read. */
  readonly withFilters: boolean;
}

const columnsOf = (table: LinkTable): Readonly<Record<string, string>> =>
  table === 'documentLink'
    ? DOCUMENT_LINK_COLUMN
    : table === 'noteLink'
      ? NOTE_LINK_COLUMN
      : TAG_COLUMN;

function groupByType(refs: readonly GraphRef[]): Map<GraphNodeType, string[]> {
  const groups = new Map<GraphNodeType, Set<string>>();
  for (const ref of refs) {
    const ids = groups.get(ref.type) ?? new Set<string>();
    ids.add(ref.id);
    groups.set(ref.type, ids);
  }
  return new Map([...groups].map(([type, ids]) => [type, [...ids]]));
}

function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const list = out.get(keyOf(row)) ?? [];
    list.push(row);
    out.set(keyOf(row), list);
  }
  return out;
}

/**
 * Read model of the graph (PRD §8.12, DT-170): batched per-type queries over the tables of the listed
 * contexts, never one query per node. It reads archived rows too (the use case decides what is visible)
 * and never selects `File`, tokens or hashes.
 */
@Injectable()
export class PrismaGraphRead implements GraphReadPort {
  constructor(private readonly host: TransactionHost) {}

  private get db() {
    return this.host.db;
  }

  // ─────────────────────────────── facts ───────────────────────────────

  async facts(
    refs: readonly GraphRef[],
    scope: GraphReadScope,
  ): Promise<Map<string, GraphNodeFacts>> {
    const groups = groupByType(refs.filter((ref) => scope.types.has(ref.type)));
    const lists = await Promise.all(
      [...groups].map(([type, ids]) =>
        this.factsOfType(type, { ids, includeArchived: true, withFilters: false }, scope),
      ),
    );
    return new Map(lists.flat().map(({ ref, facts }) => [graphNodeId(ref.type, ref.id), facts]));
  }

  async listFacts(
    type: GraphNodeType,
    scope: GraphReadScope,
    options: { readonly includeArchived: boolean },
  ): Promise<Facts> {
    if (!scope.types.has(type)) return [];
    return this.factsOfType(
      type,
      { ids: null, includeArchived: options.includeArchived, withFilters: true },
      scope,
    );
  }

  private async factsOfType(
    type: GraphNodeType,
    query: FactsQuery,
    scope: GraphReadScope,
  ): Promise<Facts> {
    const { db } = this;
    // `deletedAt: undefined` states the key, so the soft-delete extension leaves the query alone.
    const where = {
      ...(query.ids ? { id: { in: [...query.ids] } } : {}),
      deletedAt: query.includeArchived ? undefined : null,
    };
    const catalogWhere = query.ids ? { id: { in: [...query.ids] } } : {};
    const orderBy = { id: 'asc' } as const;
    const out: Facts = [];
    const add = (id: string, facts: GraphNodeFacts) => out.push({ ref: { type, id }, facts });
    const tagsOf = async (rows: readonly { id: string }[]) =>
      query.withFilters
        ? this.tagIdsByEntity(
            type,
            rows.map((row) => row.id),
          )
        : null;
    const withTags = (tags: Map<string, string[]> | null, id: string) =>
      tags ? { tagIds: tags.get(id) ?? [] } : {};

    switch (type) {
      case 'CLIENT': {
        const rows = await db.client.findMany({
          where,
          orderBy,
          select: {
            id: true,
            tradeName: true,
            code: true,
            status: true,
            kind: true,
            country: true,
            createdAt: true,
            deletedAt: true,
          },
        });
        // The receivable comes from the read model (C16): nothing is recomputed here.
        const receivables = scope.financials
          ? new Map(
              (
                await db.clientMetrics.findMany({
                  where: { clientId: { in: rows.map((row) => row.id) } },
                  select: { clientId: true, receivableUsd: true },
                })
              ).map((row) => [row.clientId, money(row.receivableUsd)]),
            )
          : null;
        const tags = await tagsOf(rows);
        for (const row of rows) {
          add(row.id, {
            label: row.tradeName,
            code: row.code,
            status: row.status,
            meta: {
              kind: row.kind,
              country: row.country,
              receivableUsd: receivables ? (receivables.get(row.id) ?? ZERO) : null,
            },
            archived: row.deletedAt !== null,
            date: toDateOnly(row.createdAt),
            ...withTags(tags, row.id),
          });
        }
        return out;
      }
      case 'CONTACT': {
        const rows = await db.contact.findMany({
          where,
          orderBy,
          select: {
            id: true,
            fullName: true,
            position: true,
            email: true,
            createdAt: true,
            deletedAt: true,
          },
        });
        const tags = await tagsOf(rows);
        for (const row of rows) {
          add(row.id, {
            label: row.fullName,
            meta: { position: row.position, email: row.email },
            archived: row.deletedAt !== null,
            date: toDateOnly(row.createdAt),
            ...withTags(tags, row.id),
          });
        }
        return out;
      }
      case 'PROJECT': {
        const rows = await db.project.findMany({
          where,
          orderBy,
          select: {
            id: true,
            name: true,
            code: true,
            status: true,
            startDate: true,
            targetEndDate: true,
            createdAt: true,
            deletedAt: true,
          },
        });
        const stacks = groupBy(
          await db.projectTechnology.findMany({
            where: { projectId: { in: rows.map((row) => row.id) } },
            select: {
              projectId: true,
              technology: { select: { id: true, name: true, slug: true, iconSlug: true } },
            },
          }),
          (row) => row.projectId,
        );
        const tags = await tagsOf(rows);
        for (const row of rows) {
          const technologies = (stacks.get(row.id) ?? [])
            .map((item) => item.technology)
            .sort((a, b) => a.name.localeCompare(b.name, 'es') || a.id.localeCompare(b.id));
          add(row.id, {
            label: row.name,
            code: row.code,
            status: row.status,
            meta: {
              stack: technologies
                .slice(0, STACK_ICONS)
                .map((tech) => tech.iconSlug ?? tech.slug)
                .join(','),
              startDate: row.startDate ? dbDateToDateOnly(row.startDate) : null,
              targetEndDate: row.targetEndDate ? dbDateToDateOnly(row.targetEndDate) : null,
            },
            archived: row.deletedAt !== null,
            date: row.startDate ? dbDateToDateOnly(row.startDate) : toDateOnly(row.createdAt),
            ...withTags(tags, row.id),
            ...(query.withFilters ? { technologyIds: technologies.map((tech) => tech.id) } : {}),
          });
        }
        return out;
      }
      case 'INVOICE': {
        const rows = await db.invoice.findMany({
          where,
          orderBy,
          select: {
            id: true,
            invoiceNumber: true,
            code: true,
            status: true,
            currency: true,
            total: true,
            balance: true,
            dueDate: true,
            issueDate: true,
            deletedAt: true,
          },
        });
        const tags = await tagsOf(rows);
        for (const row of rows) {
          add(row.id, {
            label: row.invoiceNumber,
            code: row.code,
            status: row.status,
            meta: {
              currency: row.currency,
              total: scope.financials ? money(row.total) : null,
              balance: scope.financials ? money(row.balance) : null,
              dueDate: dbDateToDateOnly(row.dueDate),
            },
            archived: row.deletedAt !== null,
            date: dbDateToDateOnly(row.issueDate),
            ...withTags(tags, row.id),
          });
        }
        return out;
      }
      case 'PAYMENT': {
        const rows = await db.payment.findMany({
          where,
          orderBy,
          select: {
            id: true,
            code: true,
            status: true,
            currency: true,
            amount: true,
            date: true,
            deletedAt: true,
            method: { select: { name: true } },
          },
        });
        const tags = await tagsOf(rows);
        for (const row of rows) {
          add(row.id, {
            label: row.code,
            code: row.code,
            status: row.status,
            meta: {
              currency: row.currency,
              amount: scope.financials ? money(row.amount) : null,
              date: dbDateToDateOnly(row.date),
              method: row.method.name,
            },
            archived: row.deletedAt !== null,
            date: dbDateToDateOnly(row.date),
            ...withTags(tags, row.id),
          });
        }
        return out;
      }
      case 'EXPENSE': {
        const rows = await db.expense.findMany({
          where,
          orderBy,
          select: {
            id: true,
            description: true,
            code: true,
            status: true,
            currency: true,
            amount: true,
            date: true,
            deletedAt: true,
          },
        });
        const tags = await tagsOf(rows);
        for (const row of rows) {
          add(row.id, {
            label: row.description,
            code: row.code,
            status: row.status,
            meta: {
              currency: row.currency,
              amount: scope.financials ? money(row.amount) : null,
              date: dbDateToDateOnly(row.date),
            },
            archived: row.deletedAt !== null,
            date: dbDateToDateOnly(row.date),
            ...withTags(tags, row.id),
          });
        }
        return out;
      }
      case 'ACCOUNT': {
        const rows = await db.account.findMany({
          where,
          orderBy,
          select: {
            id: true,
            name: true,
            currency: true,
            type: true,
            openingDate: true,
            deletedAt: true,
          },
        });
        for (const row of rows) {
          add(row.id, {
            label: row.name,
            meta: { currency: row.currency, accountType: row.type },
            archived: row.deletedAt !== null,
            date: dbDateToDateOnly(row.openingDate),
            ...(query.withFilters ? { tagIds: null } : {}),
          });
        }
        return out;
      }
      case 'DOCUMENT': {
        const rows = await db.document.findMany({
          where,
          orderBy,
          select: {
            id: true,
            title: true,
            code: true,
            status: true,
            effectiveDate: true,
            createdAt: true,
            deletedAt: true,
            type: { select: { name: true } },
            currentVersion: { select: { versionNumber: true } },
          },
        });
        const tags = await tagsOf(rows);
        for (const row of rows) {
          add(row.id, {
            label: row.title,
            code: row.code,
            status: row.status,
            meta: {
              documentType: row.type.name,
              version: row.currentVersion?.versionNumber ?? null,
            },
            archived: row.deletedAt !== null,
            date: row.effectiveDate
              ? dbDateToDateOnly(row.effectiveDate)
              : toDateOnly(row.createdAt),
            ...withTags(tags, row.id),
          });
        }
        return out;
      }
      case 'NOTE': {
        const rows = await db.note.findMany({
          where,
          orderBy,
          select: {
            id: true,
            title: true,
            contentText: true,
            createdAt: true,
            deletedAt: true,
            author: { select: { name: true } },
          },
        });
        const tags = await tagsOf(rows);
        for (const row of rows) {
          add(row.id, {
            label: row.title?.trim() || firstWords(row.contentText) || row.id,
            meta: { author: row.author.name, excerpt: firstWords(row.contentText, EXCERPT_WORDS) },
            archived: row.deletedAt !== null,
            date: toDateOnly(row.createdAt),
            ...withTags(tags, row.id),
          });
        }
        return out;
      }
      case 'TECHNOLOGY': {
        const rows = await db.technology.findMany({
          where: catalogWhere,
          orderBy,
          select: { id: true, name: true, iconSlug: true, category: true, color: true },
        });
        for (const row of rows) {
          add(row.id, {
            label: row.name,
            meta: { iconSlug: row.iconSlug, category: row.category, color: row.color },
            archived: false,
            date: null,
            ...(query.withFilters ? { tagIds: null } : {}),
          });
        }
        return out;
      }
      case 'TAG': {
        const rows = await db.tag.findMany({
          where: catalogWhere,
          orderBy,
          select: { id: true, name: true, color: true },
        });
        for (const row of rows) {
          add(row.id, {
            label: row.name,
            meta: { color: row.color },
            archived: false,
            date: null,
            ...(query.withFilters ? { tagIds: null } : {}),
          });
        }
        return out;
      }
    }
  }

  /** Tag ids of the given records of one type. */
  private async tagIdsByEntity(
    type: GraphNodeType,
    ids: readonly string[],
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    await this.linksTo('tagAssignment', type, ids, 'tagId', (recordId, tagId) =>
      out.set(recordId, [...(out.get(recordId) ?? []), tagId]),
    );
    return out;
  }

  // ───────────────────────────── presence ─────────────────────────────

  async presence(
    refs: readonly GraphRef[],
    scope: GraphReadScope,
  ): Promise<Map<string, GraphPresence>> {
    const groups = groupByType(refs.filter((ref) => scope.types.has(ref.type)));
    const lists = await Promise.all(
      [...groups].map(async ([type, ids]) => {
        const rows = await this.presenceOfType(type, ids);
        return rows.map(
          (row) => [graphNodeId(type, row.id), { archived: row.deletedAt !== null }] as const,
        );
      }),
    );
    return new Map(lists.flat());
  }

  private async presenceOfType(
    type: GraphNodeType,
    ids: string[],
  ): Promise<{ id: string; deletedAt: Date | null }[]> {
    const { db } = this;
    const select = { id: true, deletedAt: true } as const;
    const where = { id: { in: ids }, deletedAt: undefined };
    switch (type) {
      case 'CLIENT':
        return db.client.findMany({ where, select });
      case 'CONTACT':
        return db.contact.findMany({ where, select });
      case 'PROJECT':
        return db.project.findMany({ where, select });
      case 'INVOICE':
        return db.invoice.findMany({ where, select });
      case 'PAYMENT':
        return db.payment.findMany({ where, select });
      case 'EXPENSE':
        return db.expense.findMany({ where, select });
      case 'ACCOUNT':
        return db.account.findMany({ where, select });
      case 'DOCUMENT':
        return db.document.findMany({ where, select });
      case 'NOTE':
        return db.note.findMany({ where, select });
      case 'TECHNOLOGY': {
        const rows = await db.technology.findMany({
          where: { id: { in: ids } },
          select: { id: true },
        });
        return rows.map((row) => ({ id: row.id, deletedAt: null }));
      }
      case 'TAG': {
        const rows = await db.tag.findMany({ where: { id: { in: ids } }, select: { id: true } });
        return rows.map((row) => ({ id: row.id, deletedAt: null }));
      }
    }
  }

  // ──────────────────────────── relations ─────────────────────────────

  async relations(
    refs: readonly GraphRef[],
    scope: GraphReadScope,
  ): Promise<Map<string, GraphRelationRow[]>> {
    const out = new Map<string, GraphRelationRow[]>();
    const push: Push = (self, row) => {
      if (!scope.types.has(row.other.type)) return;
      const key = graphNodeId(self.type, self.id);
      out.set(key, [...(out.get(key) ?? []), row]);
    };
    const groups = groupByType(refs.filter((ref) => scope.types.has(ref.type)));
    await Promise.all(
      [...groups].map(([type, ids]) =>
        this.relationsOfType(type, ids, push, (other) => scope.types.has(other)),
      ),
    );
    return out;
  }

  private async relationsOfType(
    type: GraphNodeType,
    ids: string[],
    push: Push,
    want: (type: GraphNodeType) => boolean,
  ): Promise<void> {
    const { db } = this;
    const edge =
      (outgoing: boolean) =>
      (
        id: string,
        other: GraphNodeType,
        otherId: string,
        relation: GraphRelationKey,
        label?: string | null,
      ) =>
        push(
          { type, id },
          { other: { type: other, id: otherId }, relation, outgoing, ...(label ? { label } : {}) },
        );
    const out = edge(true);
    const into = edge(false);
    const tasks: Promise<void>[] = [];
    const run = (task: () => Promise<void>) => void tasks.push(task());
    const attachments = () => {
      if (type in DOCUMENT_LINK_COLUMN && want('DOCUMENT')) {
        run(() =>
          this.linksTo('documentLink', type, ids, 'documentId', (id, otherId) =>
            into(id, 'DOCUMENT', otherId, 'adjunto_a'),
          ),
        );
      }
      if (type in NOTE_LINK_COLUMN && want('NOTE')) {
        run(() =>
          this.linksTo('noteLink', type, ids, 'noteId', (id, otherId) =>
            into(id, 'NOTE', otherId, 'anotado_en'),
          ),
        );
      }
    };
    const tags = () => {
      if (type in TAG_COLUMN && want('TAG')) {
        run(() =>
          this.linksTo('tagAssignment', type, ids, 'tagId', (id, otherId) =>
            out(id, 'TAG', otherId, 'etiquetado'),
          ),
        );
      }
    };
    // Rows of a link table that start at this record and point at any entity (`documentId`, `noteId`, `tagId`).
    const fanOut = (
      table: LinkTable,
      ownColumn: 'documentId' | 'noteId' | 'tagId',
      relation: GraphRelationKey,
      outgoing: boolean,
    ) =>
      run(async () => {
        const model = this.db[table] as unknown as { findMany(args: unknown): Promise<LinkRow[]> };
        const rows = await model.findMany({ where: { [ownColumn]: { in: ids } } });
        for (const row of rows) {
          for (const [otherType, column] of Object.entries(columnsOf(table))) {
            const otherId = row[column];
            if (otherId && want(otherType as GraphNodeType)) {
              const self = row[ownColumn] as string;
              (outgoing ? out : into)(self, otherType as GraphNodeType, otherId, relation);
            }
          }
        }
      });

    switch (type) {
      case 'CLIENT':
        if (want('CONTACT')) {
          run(async () => {
            const rows = await db.contact.findMany({
              where: { clientId: { in: ids }, deletedAt: undefined },
              select: { id: true, clientId: true },
            });
            for (const row of rows) out(row.clientId, 'CONTACT', row.id, 'contacto');
          });
        }
        if (want('PROJECT')) {
          run(async () => {
            const rows = await db.projectClient.findMany({
              where: { clientId: { in: ids } },
              select: { projectId: true, clientId: true, role: true },
            });
            for (const row of rows) {
              out(row.clientId, 'PROJECT', row.projectId, 'participa', row.role);
            }
          });
        }
        if (want('INVOICE')) {
          run(async () => {
            const rows = await db.invoice.findMany({
              where: { clientId: { in: ids }, deletedAt: undefined },
              select: { id: true, clientId: true },
            });
            for (const row of rows) out(row.clientId, 'INVOICE', row.id, 'facturado_a');
          });
        }
        if (want('PAYMENT')) {
          run(async () => {
            const rows = await db.payment.findMany({
              where: { clientId: { in: ids }, deletedAt: undefined },
              select: { id: true, clientId: true },
            });
            for (const row of rows) out(row.clientId, 'PAYMENT', row.id, 'pago');
          });
        }
        attachments();
        tags();
        break;
      case 'CONTACT':
        if (want('CLIENT')) {
          run(async () => {
            const rows = await db.contact.findMany({
              where: { id: { in: ids }, deletedAt: undefined },
              select: { id: true, clientId: true },
            });
            for (const row of rows) into(row.id, 'CLIENT', row.clientId, 'contacto');
          });
        }
        attachments();
        tags();
        break;
      case 'PROJECT':
        if (want('CLIENT')) {
          run(async () => {
            const rows = await db.projectClient.findMany({
              where: { projectId: { in: ids } },
              select: { projectId: true, clientId: true, role: true },
            });
            for (const row of rows) {
              into(row.projectId, 'CLIENT', row.clientId, 'participa', row.role);
            }
          });
        }
        if (want('INVOICE')) {
          run(async () => {
            const rows = await db.invoiceLine.findMany({
              where: { projectId: { in: ids } },
              select: { projectId: true, invoiceId: true },
              distinct: ['projectId', 'invoiceId'],
            });
            for (const row of rows) {
              if (row.projectId) out(row.projectId, 'INVOICE', row.invoiceId, 'incluido_en');
            }
          });
        }
        if (want('EXPENSE')) {
          run(async () => {
            const rows = await db.expense.findMany({
              where: { projectId: { in: ids }, deletedAt: undefined },
              select: { id: true, projectId: true },
            });
            for (const row of rows) {
              if (row.projectId) into(row.projectId, 'EXPENSE', row.id, 'imputado_a');
            }
          });
        }
        if (want('TECHNOLOGY')) {
          run(async () => {
            const rows = await db.projectTechnology.findMany({
              where: { projectId: { in: ids } },
              select: { projectId: true, technologyId: true },
            });
            for (const row of rows) out(row.projectId, 'TECHNOLOGY', row.technologyId, 'usa');
          });
        }
        attachments();
        tags();
        break;
      case 'INVOICE':
        if (want('CLIENT')) {
          run(async () => {
            const rows = await db.invoice.findMany({
              where: { id: { in: ids }, deletedAt: undefined },
              select: { id: true, clientId: true },
            });
            for (const row of rows) into(row.id, 'CLIENT', row.clientId, 'facturado_a');
          });
        }
        if (want('PROJECT')) {
          run(async () => {
            const rows = await db.invoiceLine.findMany({
              where: { invoiceId: { in: ids }, projectId: { not: null } },
              select: { invoiceId: true, projectId: true },
              distinct: ['invoiceId', 'projectId'],
            });
            for (const row of rows) {
              if (row.projectId) into(row.invoiceId, 'PROJECT', row.projectId, 'incluido_en');
            }
          });
        }
        if (want('PAYMENT')) {
          run(async () => {
            const rows = await db.paymentAllocation.findMany({
              where: { invoiceId: { in: ids }, deletedAt: null },
              select: { invoiceId: true, paymentId: true, amountInvoiceCurrency: true },
            });
            for (const row of rows) {
              into(
                row.invoiceId,
                'PAYMENT',
                row.paymentId,
                'paga',
                money(row.amountInvoiceCurrency),
              );
            }
          });
        }
        attachments();
        tags();
        break;
      case 'PAYMENT':
        if (want('CLIENT') || want('ACCOUNT')) {
          run(async () => {
            const rows = await db.payment.findMany({
              where: { id: { in: ids }, deletedAt: undefined },
              select: { id: true, clientId: true, accountId: true },
            });
            for (const row of rows) {
              into(row.id, 'CLIENT', row.clientId, 'pago');
              out(row.id, 'ACCOUNT', row.accountId, 'acreditado_en');
            }
          });
        }
        if (want('INVOICE')) {
          run(async () => {
            const rows = await db.paymentAllocation.findMany({
              where: { paymentId: { in: ids }, deletedAt: null },
              select: { paymentId: true, invoiceId: true, amountInvoiceCurrency: true },
            });
            for (const row of rows) {
              out(
                row.paymentId,
                'INVOICE',
                row.invoiceId,
                'paga',
                money(row.amountInvoiceCurrency),
              );
            }
          });
        }
        attachments();
        tags();
        break;
      case 'EXPENSE':
        if (want('PROJECT') || want('ACCOUNT')) {
          run(async () => {
            const rows = await db.expense.findMany({
              where: { id: { in: ids }, deletedAt: undefined },
              select: { id: true, projectId: true, accountId: true },
            });
            for (const row of rows) {
              if (row.projectId) out(row.id, 'PROJECT', row.projectId, 'imputado_a');
              if (row.accountId) out(row.id, 'ACCOUNT', row.accountId, 'pagado_desde');
            }
          });
        }
        attachments();
        tags();
        break;
      case 'ACCOUNT':
        if (want('PAYMENT')) {
          run(async () => {
            const rows = await db.payment.findMany({
              where: { accountId: { in: ids }, deletedAt: undefined },
              select: { id: true, accountId: true },
            });
            for (const row of rows) into(row.accountId, 'PAYMENT', row.id, 'acreditado_en');
          });
        }
        if (want('EXPENSE')) {
          run(async () => {
            const rows = await db.expense.findMany({
              where: { accountId: { in: ids }, deletedAt: undefined },
              select: { id: true, accountId: true },
            });
            for (const row of rows) {
              if (row.accountId) into(row.accountId, 'EXPENSE', row.id, 'pagado_desde');
            }
          });
        }
        break;
      case 'DOCUMENT':
        fanOut('documentLink', 'documentId', 'adjunto_a', true);
        if (want('NOTE')) {
          run(() =>
            this.linksTo('noteLink', type, ids, 'noteId', (id, otherId) =>
              into(id, 'NOTE', otherId, 'anotado_en'),
            ),
          );
        }
        tags();
        break;
      case 'NOTE':
        fanOut('noteLink', 'noteId', 'anotado_en', true);
        tags();
        break;
      case 'TECHNOLOGY':
        if (want('PROJECT')) {
          run(async () => {
            const rows = await db.projectTechnology.findMany({
              where: { technologyId: { in: ids } },
              select: { projectId: true, technologyId: true },
            });
            for (const row of rows) into(row.technologyId, 'PROJECT', row.projectId, 'usa');
          });
        }
        break;
      case 'TAG':
        fanOut('tagAssignment', 'tagId', 'etiquetado', false);
        break;
    }
    await Promise.all(tasks);
  }

  /**
   * Rows of a link table that point at the given records of `type` through the table's column for that
   * type, reported as `(recordId, value of linkColumn)`.
   */
  private async linksTo(
    table: LinkTable,
    type: GraphNodeType,
    ids: readonly string[],
    linkColumn: 'documentId' | 'noteId' | 'tagId',
    report: (recordId: string, linkedId: string) => void,
  ): Promise<void> {
    const column = columnsOf(table)[type];
    if (!column || ids.length === 0) return;
    const model = this.db[table] as unknown as { findMany(args: unknown): Promise<LinkRow[]> };
    const rows = await model.findMany({
      where: { [column]: { in: [...ids] } },
      select: { [linkColumn]: true, [column]: true },
    });
    for (const row of rows) {
      const recordId = row[column];
      const linkedId = row[linkColumn];
      if (recordId && linkedId) report(recordId, linkedId);
    }
  }
}
