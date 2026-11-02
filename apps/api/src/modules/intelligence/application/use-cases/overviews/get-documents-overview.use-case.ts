import type { DocumentListRow } from '../../../../documents/application/document-support';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import { todayInCaracas } from '../../../../../shared/domain/business-date';
import type { DocumentStatus } from '../../../../../shared/domain/enums';
import type { ExpiringCounts, OverviewReadPort } from '../../ports/overview-read.port';
import { SHORT_LIST, firstRows, queryOf, type ListSource } from './overview-support';

const EXPIRING_LIST = 10;
/** The mock listed every stale draft; the list contract's largest page bounds it. */
const STALE_DRAFT_LIST = 100;
const EXPIRING_WINDOW_DAYS = '90';

export interface DocumentsOverview {
  byCategoryAndStatus: {
    category: { id: string; name: string; nameEn: string | null; color: string | null };
    countByStatus: Partial<Record<DocumentStatus, number>>;
  }[];
  expiringCounts: ExpiringCounts;
  expiringSoon: DocumentListRow[];
  recent: DocumentListRow[];
  staleDrafts: DocumentListRow[];
}

/**
 * `GET /documents/overview` (PRD §8.9.5, carried). `can(read, document)` first. The rows are the owner's
 * (`ListDocuments`), so the link chips follow `read` (DT-142) and archived documents never show; the counts
 * are live aggregates. "Stale" is the owner's rule: a draft untouched for more than 14 days by its clock.
 */
export class GetDocumentsOverview {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly documents: ListSource<DocumentListRow>,
    private readonly overview: OverviewReadPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser): Promise<DocumentsOverview> {
    assertCan(this.authorization, actor, 'read', 'document');
    const today = todayInCaracas(this.clock.now());
    const [categories, expiringCounts, expiringSoon, recent, staleDrafts] = await Promise.all([
      this.overview.documentCategoryCounts(),
      this.overview.documentExpiringCounts(today),
      firstRows(
        this.documents,
        actor,
        queryOf(
          { field: 'expiresAt', direction: 'asc' },
          { expiringWithinDays: EXPIRING_WINDOW_DAYS },
        ),
        EXPIRING_LIST,
      ),
      firstRows(
        this.documents,
        actor,
        queryOf({ field: 'updatedAt', direction: 'desc' }),
        SHORT_LIST,
      ),
      firstRows(
        this.documents,
        actor,
        queryOf({ field: 'updatedAt', direction: 'asc' }, { staleDraft: 'true' }, 100),
        STALE_DRAFT_LIST,
      ),
    ]);
    return {
      byCategoryAndStatus: categories.map(({ countByStatus, ...category }) => ({
        category,
        countByStatus,
      })),
      expiringCounts,
      expiringSoon,
      recent,
      staleDrafts,
    };
  }
}
