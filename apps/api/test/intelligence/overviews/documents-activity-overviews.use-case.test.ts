import { describe, expect, it } from 'vitest';
import { ForbiddenError, ValidationFailedError } from '../../../src/shared/domain/domain-error';
import { DEFAULT_LIST_QUERY, type ListQuery } from '../../../src/shared/domain/list-query';
import type { DocumentListRow } from '../../../src/modules/documents/application/document-support';
import { GetActivityOverview } from '../../../src/modules/intelligence/application/use-cases/overviews/get-activity-overview.use-case';
import { GetDocumentsOverview } from '../../../src/modules/intelligence/application/use-cases/overviews/get-documents-overview.use-case';
import { authorization, FakeListSource, userOf, world } from './world';

const document = (id: string) => ({ id, code: id, title: id }) as unknown as DocumentListRow;

describe('GetDocumentsOverview', () => {
  function build() {
    const w = world();
    const documents = new FakeListSource<DocumentListRow>();
    return {
      ...w,
      documents,
      useCase: new GetDocumentsOverview(authorization, documents, w.overview, w.clock),
    };
  }

  it('counts documents by category and status and by expiry window from the read port, at today', async () => {
    const { overview: read, useCase } = build();
    read.documentCategories = [
      {
        id: 'dcat_legal',
        name: 'Legal',
        nameEn: 'Legal',
        color: null,
        countByStatus: { FIRMADO: 3 },
      },
      { id: 'dcat_empty', name: 'Vacía', nameEn: null, color: '#fff', countByStatus: {} },
    ];
    read.expiring = { days30: 1, days60: 2, days90: 3 };

    const overview = await useCase.execute(userOf('VIEWER'));

    expect(overview.byCategoryAndStatus).toEqual(
      read.documentCategories.map((c) => ({
        category: { id: c.id, name: c.name, nameEn: c.nameEn, color: c.color },
        countByStatus: c.countByStatus,
      })),
    );
    expect(overview.expiringCounts).toEqual({ days30: 1, days60: 2, days90: 3 });
    expect(read.expiringAsked).toEqual(['2026-10-15']);
  });

  it('asks the owner for the documents expiring within 90 days, soonest first, ten at most', async () => {
    const { documents, useCase } = build();
    documents.items = Array.from({ length: 12 }, (_, i) => document(`d${i}`));

    const overview = await useCase.execute(userOf('OWNER'));

    expect(documents.queries[0]?.query).toMatchObject({
      sort: { field: 'expiresAt', direction: 'asc' },
      archived: 'exclude',
      filters: { expiringWithinDays: '90' },
    });
    expect(overview.expiringSoon).toHaveLength(10);
  });

  it('asks the owner for the five most recently updated documents', async () => {
    const { documents, useCase } = build();
    documents.items = Array.from({ length: 8 }, (_, i) => document(`d${i}`));
    const overview = await useCase.execute(userOf('MEMBER'));
    expect(documents.queries[1]?.query.sort).toEqual({ field: 'updatedAt', direction: 'desc' });
    expect(overview.recent).toHaveLength(5);
  });

  it('asks the owner for drafts untouched for more than 14 days, the oldest first', async () => {
    const { documents, useCase } = build();
    documents.items = [document('old'), document('newer')];
    const overview = await useCase.execute(userOf('ADMIN'));
    expect(documents.queries[2]?.query).toMatchObject({
      sort: { field: 'updatedAt', direction: 'asc' },
      filters: { staleDraft: 'true' },
    });
    expect(overview.staleDrafts.map((d) => d.id)).toEqual(['old', 'newer']);
  });

  it('is forbidden without read on documents, before any read', async () => {
    const { documents, overview, clock } = build();
    const denied = new GetDocumentsOverview(
      { can: () => false, canSeeFinancials: () => false },
      documents,
      overview,
      clock,
    );
    await expect(denied.execute(userOf('OWNER'))).rejects.toBeInstanceOf(ForbiddenError);
    expect(documents.queries).toEqual([]);
  });
});

describe('GetActivityOverview', () => {
  function build(now?: string) {
    const w = world();
    if (now) w.clock.set(now);
    return { ...w, useCase: new GetActivityOverview(authorization, w.overview, w.clock) };
  }
  const query = (
    filters: ListQuery['filters'] = {},
    extra: Partial<ListQuery> = {},
  ): ListQuery => ({
    ...DEFAULT_LIST_QUERY,
    filters,
    ...extra,
  });

  it('answers the three figures of the read port for the caller filter', async () => {
    const { overview: read, useCase } = build();
    read.activity = { total: 12, today: 3, users: 9 };

    const overview = await useCase.execute(
      userOf('OWNER'),
      query({ action: ['CREATE'] }, { q: 'kairos' }),
    );

    expect(overview).toEqual({ total: 12, today: 3, users: 9 });
    expect(read.activityRequests[0]?.filter).toMatchObject({
      actions: ['CREATE'],
      search: 'kairos',
    });
  });

  it('takes today in Caracas: before noon UTC the Caracas day is still the previous one', async () => {
    const { overview: read, useCase } = build('2026-10-15T02:00:00.000Z');
    await useCase.execute(userOf('ADMIN'), query());
    const request = read.activityRequests[0];
    expect(request?.todayStart.toISOString()).toBe('2026-10-14T04:00:00.000Z');
    expect(request?.tomorrowStart.toISOString()).toBe('2026-10-15T04:00:00.000Z');
  });

  it('rejects the filters GET /activity rejects, as VALIDATION, before reading', async () => {
    const { overview: read, useCase } = build();
    await expect(useCase.execute(userOf('OWNER'), query({ from: 'nope' }))).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
    expect(read.activityRequests).toEqual([]);
  });

  it.each(['MEMBER', 'VIEWER'] as const)('%s is forbidden (read activity)', async (role) => {
    const { overview: read, useCase } = build();
    await expect(useCase.execute(userOf(role), query())).rejects.toBeInstanceOf(ForbiddenError);
    expect(read.activityRequests).toEqual([]);
  });
});
