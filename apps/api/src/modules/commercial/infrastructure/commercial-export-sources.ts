import type { CurrentUser } from '../../../shared/application/current-user';
import type {
  ExportColumn,
  ExportPage,
  ExportSource,
} from '../../../shared/application/ports/export-source.port';
import { ValidationFailedError } from '../../../shared/domain/domain-error';
import type { ListQuery } from '../../../shared/domain/list-query';
import type { Paginated } from '../../../shared/domain/pagination';
import type { NoteListRow } from '../application/use-cases/note-support';
import type { ClientListRow } from '../domain/client';
import type { ContactView } from '../domain/contact';
import type { ProjectListRowView } from '../domain/project';

type Query = Omit<ListQuery, 'page' | 'pageSize'>;

/** A table's list use case: the export reads through it, so its `can()` and money gates apply (DT-171). */
interface ListUseCase<Row> {
  execute(actor: CurrentUser, query: ListQuery): Promise<Paginated<Row>>;
}

const text = <Row>(value: (row: Row) => string | null): ExportColumn<Row> => ({
  type: 'text',
  value,
});
const money = <Row>(value: (row: Row) => string | null): ExportColumn<Row> => ({
  type: 'money',
  value,
});
const names = (items: readonly { readonly name: string }[]): string =>
  items.map((item) => item.name).join('; ');

async function readThrough<Row>(
  list: ListUseCase<Row>,
  actor: CurrentUser,
  query: Query,
  page: ExportPage,
): Promise<{ rows: readonly Row[]; total: number }> {
  const result = await list.execute(actor, { ...query, page: page.page, pageSize: page.pageSize });
  return { rows: result.items, total: result.total };
}

/** The columns of the clients table (`CLIENT_COLUMN_IDS` of the FE). Money cells are `null` without financials. */
export const CLIENT_EXPORT_COLUMNS: Readonly<Record<string, ExportColumn<ClientListRow>>> = {
  code: text((row) => row.client.code),
  tradeName: text((row) => row.client.tradeName),
  kind: text((row) => row.client.kind),
  country: text((row) => row.client.country),
  status: text((row) => row.client.status),
  projectCount: { type: 'integer', value: (row) => row.projectCount },
  totalInvoicedUsd: money((row) => row.totalInvoicedUsd),
  receivableUsd: money((row) => row.receivableUsd),
  tags: text((row) => names(row.tags)),
  lastActivityAt: { type: 'datetime', value: (row) => row.lastActivityAt },
};

export const CONTACT_EXPORT_COLUMNS: Readonly<Record<string, ExportColumn<ContactView>>> = {
  fullName: text((row) => row.contact.fullName),
  position: text((row) => row.contact.position),
  email: text((row) => row.contact.email),
  phone: text((row) => row.contact.phone),
  isPrimary: { type: 'boolean', value: (row) => row.contact.isPrimary },
  tags: text((row) => names(row.tags)),
  createdAt: { type: 'datetime', value: (row) => row.contact.createdAt },
};

export const PROJECT_EXPORT_COLUMNS: Readonly<Record<string, ExportColumn<ProjectListRowView>>> = {
  code: text((row) => row.code),
  name: text((row) => row.name),
  clients: text((row) => row.clients.map((link) => link.client.label).join('; ')),
  status: text((row) => row.status),
  startDate: { type: 'date', value: (row) => row.startDate },
  targetEndDate: { type: 'date', value: (row) => row.targetEndDate },
  stack: text((row) => names(row.stack)),
  contractedValueUsd: money((row) => row.contractedValueUsd),
  invoicedUsd: money((row) => row.invoicedUsd),
  collectedUsd: money((row) => row.collectedUsd),
  toInvoiceUsd: money((row) => row.toInvoiceUsd),
  tags: text((row) => names(row.tags)),
};

/** The notes table: the excerpt, never the rich content or the attachments' files (C23). */
export const NOTE_EXPORT_COLUMNS: Readonly<Record<string, ExportColumn<NoteListRow>>> = {
  title: text((row) => row.title ?? row.excerpt),
  excerpt: text((row) => row.excerpt),
  author: text((row) => row.author.name),
  links: text((row) => row.links.map((link) => link.label).join('; ')),
  tags: text((row) => names(row.tags)),
  attachments: { type: 'integer', value: (row) => row.attachmentCount },
  pinned: { type: 'boolean', value: (row) => row.pinned },
  createdAt: { type: 'datetime', value: (row) => row.createdAt },
  updatedAt: { type: 'datetime', value: (row) => row.updatedAt },
};

export class ClientExportSource implements ExportSource<ClientListRow> {
  readonly entity = 'CLIENT';
  readonly columns = CLIENT_EXPORT_COLUMNS;

  constructor(private readonly list: ListUseCase<ClientListRow>) {}

  read(actor: CurrentUser, query: Query, page: ExportPage) {
    return readThrough(this.list, actor, query, page);
  }
}

/** Contacts are listed per client, so the export names the client in `filters.clientId` (required). */
export class ContactExportSource implements ExportSource<ContactView> {
  readonly entity = 'CONTACT';
  readonly columns = CONTACT_EXPORT_COLUMNS;

  constructor(
    private readonly list: {
      execute(
        actor: CurrentUser,
        input: { readonly clientId: string; readonly query: ListQuery },
      ): Promise<Paginated<ContactView>>;
    },
  ) {}

  async read(actor: CurrentUser, query: Query, page: ExportPage) {
    const raw = query.filters.clientId;
    const clientId = typeof raw === 'string' ? raw : raw?.[0];
    if (!clientId) {
      throw new ValidationFailedError({ fieldErrors: { clientId: ['validation.required'] } });
    }
    const result = await this.list.execute(actor, {
      clientId,
      query: { ...query, page: page.page, pageSize: page.pageSize },
    });
    return { rows: result.items, total: result.total };
  }
}

export class ProjectExportSource implements ExportSource<ProjectListRowView> {
  readonly entity = 'PROJECT';
  readonly columns = PROJECT_EXPORT_COLUMNS;

  constructor(private readonly list: ListUseCase<ProjectListRowView>) {}

  read(actor: CurrentUser, query: Query, page: ExportPage) {
    return readThrough(this.list, actor, query, page);
  }
}

export class NoteExportSource implements ExportSource<NoteListRow> {
  readonly entity = 'NOTE';
  readonly columns = NOTE_EXPORT_COLUMNS;

  constructor(private readonly list: ListUseCase<NoteListRow>) {}

  read(actor: CurrentUser, query: Query, page: ExportPage) {
    return readThrough(this.list, actor, query, page);
  }
}
