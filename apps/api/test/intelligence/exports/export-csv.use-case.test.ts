import { describe, expect, it } from 'vitest';
import {
  EXPORT_ENTITY_VALUES,
  EXPORT_MAX_ROWS,
  EXPORT_PAGE_SIZE,
  ExportCsv,
  type ExportCsvInput,
} from '../../../src/modules/intelligence/application/use-cases/exports/export-csv.use-case';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import {
  ExportSourceRegistry,
  type ExportCellValue,
  type ExportColumn,
  type ExportSource,
} from '../../../src/shared/application/ports/export-source.port';
import {
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../../../src/shared/domain/domain-error';
import type { ListQuery } from '../../../src/shared/domain/list-query';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryActivityLog } from '../../support/fakes/in-memory-activity-log';
import { InMemoryUnitOfWork } from '../../support/fakes/in-memory-unit-of-work';

interface Row {
  name: string;
  amount: string | null;
  qty: number;
  due: Date | null;
  at: Date;
  paid: boolean;
}

const user: CurrentUser = {
  userId: 'usr_1',
  clerkId: 'clerk_1',
  role: 'OWNER',
  email: 'o@example.test',
  name: 'Owner',
};

const columns: Record<string, ExportColumn<Row>> = {
  name: { type: 'text', value: (r) => r.name },
  amount: { type: 'money', value: (r) => r.amount },
  qty: { type: 'integer', value: (r) => r.qty },
  due: { type: 'date', value: (r) => r.due },
  at: { type: 'datetime', value: (r) => r.at },
  paid: { type: 'boolean', value: (r) => r.paid },
  'client.label': { type: 'text', value: (r) => `L-${r.name}` },
  'a.b': { type: 'text', value: (r) => `AB-${r.name}` },
  a: { type: 'text', value: (r) => `A-${r.name}` },
};

const row = (i: number, over: Partial<Row> = {}): Row => ({
  name: `row-${i}`,
  amount: '10.50',
  qty: i,
  due: new Date('2026-03-05T00:00:00.000Z'),
  at: new Date('2026-03-05T14:30:00.000Z'),
  paid: true,
  ...over,
});

class FakeSource implements ExportSource<Row> {
  readonly columns = columns;
  readonly calls: { query: unknown; page: number; pageSize: number }[] = [];
  failWith: Error | null = null;
  constructor(
    readonly entity: string,
    public rows: Row[],
    private readonly log: string[] = [],
  ) {}
  async read(
    _actor: unknown,
    query: Omit<ListQuery, 'page' | 'pageSize'>,
    page: { page: number; pageSize: 25 | 50 | 100 },
  ) {
    this.log.push('read');
    this.calls.push({ query, page: page.page, pageSize: page.pageSize });
    if (this.failWith) throw this.failWith;
    const start = (page.page - 1) * page.pageSize;
    return { rows: this.rows.slice(start, start + page.pageSize), total: this.rows.length };
  }
}

const baseQuery: ExportCsvInput['query'] = { sort: null, archived: 'exclude', filters: {} };
const cols = (...ids: string[]) => ids.map((id) => ({ id, label: id.toUpperCase() }));

function build(rows: Row[] = [row(1)], entity = 'CLIENT') {
  const log: string[] = [];
  const registry = new ExportSourceRegistry();
  const source = new FakeSource(entity, rows, log);
  registry.register(source);
  const uow = new InMemoryUnitOfWork();
  const activity = new InMemoryActivityLog(uow);
  const clock = new FixedClock('2026-01-16T02:00:00.000Z'); // 2026-01-15 22:00 in Caracas
  const original = activity.record.bind(activity);
  activity.record = async (entry) => {
    log.push('activity');
    return original(entry);
  };
  const useCase = new ExportCsv(registry, uow, activity, clock);
  return { useCase, source, activity, log, registry };
}

const run = (useCase: ExportCsv, over: Partial<ExportCsvInput> = {}, entity: string = 'CLIENT') =>
  useCase.execute(user, { entity, query: baseQuery, columns: cols('name'), ...over });

describe('ExportCsv', () => {
  it('whitelists the eleven tables of DT-171', () => {
    expect([...EXPORT_ENTITY_VALUES].sort()).toEqual(
      [
        'ACTIVITY',
        'CLIENT',
        'CONTACT',
        'DOCUMENT',
        'EXPENSE',
        'INVOICE',
        'NOTE',
        'PAYMENT',
        'PROJECT',
        'TAG',
        'TECHNOLOGY',
      ].sort(),
    );
  });

  it('writes BOM, labelled header in the requested order, CRLF records and the filename', async () => {
    const { useCase } = build([row(1), row(2)]);
    const result = await run(useCase, {
      columns: [
        { id: 'qty', label: 'Cantidad' },
        { id: 'name', label: 'Nombre' },
      ],
    });
    expect(result.content).toBe('﻿Cantidad,Nombre\r\n1,row-1\r\n2,row-2\r\n');
    expect(result.rowCount).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.filename).toBe('client-2026-01-15.csv');
  });

  it('returns only the header for an empty result', async () => {
    const { useCase } = build([]);
    const result = await run(useCase);
    expect(result.content).toBe('﻿NAME\r\n');
    expect(result.rowCount).toBe(0);
  });

  it('guards formulas in cells and in labels, and quotes delimiters', async () => {
    const { useCase } = build([row(1, { name: '=HYPERLINK("x")' }), row(2, { name: 'a,b' })]);
    const result = await run(useCase, { columns: [{ id: 'name', label: '@evil' }] });
    expect(result.content).toBe('﻿\'@evil\r\n"\'=HYPERLINK(""x"")"\r\n"a,b"\r\n');
  });

  it('writes money verbatim (signed, trailing zeros) and empty for null', async () => {
    const { useCase } = build([
      row(1, { amount: '-1234.50' }),
      row(2, { amount: '0.10' }),
      row(3, { amount: null }),
    ]);
    const result = await run(useCase, { columns: cols('amount') });
    expect(result.content).toBe('﻿AMOUNT\r\n-1234.50\r\n0.10\r\n\r\n');
  });

  it('formats date, datetime, integer and boolean cells', async () => {
    const { useCase } = build([row(7), row(8, { due: null, paid: false })]);
    const result = await run(useCase, { columns: cols('due', 'at', 'qty', 'paid') });
    expect(result.content).toBe(
      '﻿DUE,AT,QTY,PAID\r\n2026-03-05,2026-03-05T14:30:00.000Z,7,true\r\n,2026-03-05T14:30:00.000Z,8,false\r\n',
    );
  });

  it('keys cells by position, so ids with dots never collide with nested paths', async () => {
    const { useCase } = build([row(1)]);
    const result = await run(useCase, { columns: cols('a', 'a.b', 'client.label') });
    expect(result.content).toBe('﻿A,A.B,CLIENT.LABEL\r\nA-row-1,AB-row-1,L-row-1\r\n');
  });

  it('reads pages of 100 and stops at 10,000 rows, flagging the truncation', async () => {
    const rows = Array.from({ length: EXPORT_MAX_ROWS + 1 }, (_, i) => row(i + 1));
    const { useCase, source } = build(rows);
    const result = await run(useCase);
    expect(result.rowCount).toBe(EXPORT_MAX_ROWS);
    expect(result.truncated).toBe(true);
    expect(result.content.split('\r\n')).toHaveLength(EXPORT_MAX_ROWS + 2); // header + rows + trailing ''
    expect(source.calls.every((c) => c.pageSize === EXPORT_PAGE_SIZE)).toBe(true);
    expect(source.calls.map((c) => c.page)).toEqual(
      Array.from({ length: EXPORT_MAX_ROWS / EXPORT_PAGE_SIZE }, (_, i) => i + 1),
    );
  });

  it('is not truncated at exactly 10,000 rows', async () => {
    const rows = Array.from({ length: EXPORT_MAX_ROWS }, (_, i) => row(i + 1));
    const { useCase } = build(rows);
    const result = await run(useCase);
    expect(result.rowCount).toBe(EXPORT_MAX_ROWS);
    expect(result.truncated).toBe(false);
  });

  it('hands the source the caller query without paging fields', async () => {
    const { useCase, source } = build();
    const query = {
      q: 'kai',
      sort: { field: 'name', direction: 'desc' as const },
      archived: 'only' as const,
      filters: { status: ['A', 'B'] },
    };
    await run(useCase, { query });
    expect(source.calls[0]?.query).toEqual(query);
  });

  it.each([
    ['an unknown column id', cols('nope')],
    ['a repeated column id', cols('name', 'name')],
    ['no column', []],
    ['a label over 200 characters', [{ id: 'name', label: 'x'.repeat(201) }]],
    ['an empty label', [{ id: 'name', label: '' }]],
    ['a prototype key as id', cols('constructor')],
  ])('rejects %s as VALIDATION before reading anything', async (_name, columnsInput) => {
    const { useCase, source, activity } = build();
    await expect(run(useCase, { columns: columnsInput })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
    expect(source.calls).toHaveLength(0);
    expect(activity.entries).toHaveLength(0);
  });

  it('reports the offending column in fieldErrors', async () => {
    const { useCase } = build();
    await expect(run(useCase, { columns: cols('name', 'nope') })).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { columns: ['validation.invalidOption'] },
    });
  });

  it('rejects an entity outside the whitelist as VALIDATION', async () => {
    const { useCase } = build([row(1)], 'USER');
    await expect(run(useCase, {}, 'USER')).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('answers NOT_FOUND for a whitelisted entity nobody registered', async () => {
    const { useCase } = build();
    await expect(run(useCase, {}, 'NOTE')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lets the source refuse and writes no entry', async () => {
    const { useCase, source, activity } = build();
    source.failWith = new ForbiddenError();
    await expect(run(useCase)).rejects.toBeInstanceOf(ForbiddenError);
    expect(activity.entries).toHaveLength(0);
  });

  it('writes one EXPORT entry after the rows are read, with counts and column ids only', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => row(i + 1));
    const { useCase, activity, log } = build(rows);
    await run(useCase, {
      query: { ...baseQuery, q: 'secret-term', filters: { status: 'SECRET' } },
      columns: [
        { id: 'name', label: 'Private label' },
        { id: 'a.b', label: 'Other' },
      ],
    });
    expect(activity.entries).toHaveLength(1);
    const [entry] = activity.entries;
    if (!entry) throw new Error('no EXPORT entry');
    expect(entry.action).toBe('EXPORT');
    expect(entry.actor).toEqual({ actorType: 'USER', userId: 'usr_1' });
    expect(entry.metadata).toEqual({
      entity: 'CLIENT',
      rowCount: 250,
      columns: ['name', 'a.b'],
      truncated: false,
    });
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('secret-term');
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('Private label');
    expect(log.indexOf('activity')).toBeGreaterThan(log.lastIndexOf('read'));
    expect(log.filter((l) => l === 'activity')).toHaveLength(1);
  });

  it('maps catalog and activity exports onto an activity entity type', async () => {
    for (const [entity, type] of [
      ['TECHNOLOGY', 'SETTING'],
      ['ACTIVITY', 'SETTING'],
      ['TAG', 'TAG'],
    ] as const) {
      const { useCase, activity } = build([row(1)], entity);
      await run(useCase, {}, entity);
      expect(activity.entries[0]).toMatchObject({ entityType: type, entityId: entity });
    }
  });

  it('does not export a cell value that is not a decimal string in a money column', async () => {
    const { useCase, activity } = build([row(1, { amount: 'abc' })]);
    await expect(run(useCase, { columns: cols('amount') })).rejects.toThrow();
    expect(activity.entries).toHaveLength(0);
  });

  it('keeps the column map typed to the cell union', () => {
    const cell: ExportCellValue = null;
    expect(cell).toBeNull();
  });
});
