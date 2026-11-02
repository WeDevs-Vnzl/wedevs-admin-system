import type { CurrentUser } from '../../../shared/application/current-user';
import type {
  ExportColumn,
  ExportPage,
  ExportSource,
} from '../../../shared/application/ports/export-source.port';
import type { ListQuery } from '../../../shared/domain/list-query';
import type {
  ActivityRowOutput,
  ListActivity,
} from '../application/use-cases/list-activity.use-case';

/**
 * The activity log as a CSV export source (DT-171). Rows come from `ListActivity` with the caller's own
 * authorization (`can(read, activity)`: Owner and Admin) and the same filters, so the export is exactly what the
 * table shows. The address is the list's masked one (DT-114) and the user agent is not offered as a column.
 */
export class ActivityExportSource implements ExportSource<ActivityRowOutput> {
  readonly entity = 'ACTIVITY';

  readonly columns: Readonly<Record<string, ExportColumn<ActivityRowOutput>>> = {
    createdAt: { type: 'datetime', value: (row) => row.createdAt },
    actor: { type: 'text', value: (row) => row.actor.name ?? row.actor.type },
    action: { type: 'text', value: (row) => row.action },
    entityType: { type: 'text', value: (row) => row.entityType },
    entityLabel: { type: 'text', value: (row) => row.entityLabel },
    entityId: { type: 'text', value: (row) => row.entityId },
    ip: { type: 'text', value: (row) => row.ip },
  };

  constructor(private readonly listActivity: Pick<ListActivity, 'execute'>) {}

  async read(
    actor: CurrentUser,
    query: Omit<ListQuery, 'page' | 'pageSize'>,
    page: ExportPage,
  ): Promise<{ rows: readonly ActivityRowOutput[]; total: number }> {
    const result = await this.listActivity.execute(actor, {
      ...query,
      page: page.page,
      pageSize: page.pageSize,
    });
    return { rows: result.items, total: result.total };
  }
}
