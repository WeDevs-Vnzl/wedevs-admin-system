import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { diffFields } from '../../../../shared/domain/activity-diff';
import type { DateOnly } from '../../../../shared/domain/business-date';
import { ValidationFailedError } from '../../../../shared/domain/domain-error';
import type { ProjectStatus } from '../../../../shared/domain/enums';
import {
  assertStatusDates,
  PROJECT_KEYS,
  type ProjectStatusChangeView,
} from '../../domain/project';
import {
  canTransitionProject,
  projectStatusHints,
  type ProjectStatusHint,
} from '../../domain/project-status';
import type { ProjectBillingPort } from '../ports/project-billing.port';
import type { ProjectRepository } from '../ports/project.repository.port';
import { loadLiveProject, reloadProject } from './project-references';
import type { ProjectSync } from './project-sync';
import type { ProjectViews } from './project-views';

export interface SetProjectStatusInput {
  readonly id: string;
  readonly status: ProjectStatus;
  readonly startDate?: DateOnly | undefined;
  readonly endDate?: DateOnly | undefined;
  readonly cancelPendingInstallments: boolean;
  readonly finishRecurringCharges: boolean;
  readonly confirm: boolean;
}

const invalid = (field: string, key: string): ValidationFailedError =>
  new ValidationFailedError({ fieldErrors: { [field]: [key] } });

/**
 * `POST /projects/{id}/status` (HU-08; Member may update). Order: `can(update, project)` → one unit of
 * work: live project, `canTransitionProject` (`status`: `projects.errors.invalidTransition`), `EN_CURSO`
 * needs a start date (CA1), `ENTREGADO` an end date (CA2), the end is not before the start,
 * `CANCELADO` needs `confirm`. Cancelling passes its options to `ProjectBillingPort.cancelForProject`
 * and records what was cancelled in the entry's metadata; the `STATUS_CHANGE` entry carries the
 * `[before, after]` diff of status and dates (CA4). The hints come from the billing port.
 */
export class SetProjectStatus {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly projects: ProjectRepository,
    private readonly billing: ProjectBillingPort,
    private readonly sync: ProjectSync,
    private readonly views: ProjectViews,
  ) {}

  async execute(
    actor: CurrentUser,
    input: SetProjectStatusInput,
  ): Promise<ProjectStatusChangeView> {
    assertCan(this.authorization, actor, 'update', 'project');

    const hints = await this.uow.run(async () => {
      const before = await loadLiveProject(this.projects, input.id);
      if (!canTransitionProject(before.status, input.status)) {
        throw invalid('status', PROJECT_KEYS.invalidTransition);
      }
      const startDate = input.startDate ?? before.startDate;
      const endDate = input.endDate ?? before.endDate;
      assertStatusDates(input.status, { startDate, endDate });
      if (startDate !== null && endDate !== null && endDate < startDate) {
        throw invalid('endDate', PROJECT_KEYS.invalidDate);
      }
      if (input.status === 'CANCELADO' && !input.confirm) {
        throw invalid('confirm', PROJECT_KEYS.required);
      }

      await this.projects.updateFields(
        { ...before, status: input.status, startDate, endDate },
        actor.userId,
      );
      const cancelled =
        input.status === 'CANCELADO'
          ? await this.billing.cancelForProject(before.id, {
              cancelPendingInstallments: input.cancelPendingInstallments,
              finishRecurringCharges: input.finishRecurringCharges,
            })
          : null;

      const after = await reloadProject(this.projects, before.id);
      const changes = diffFields(
        { status: before.status, startDate: before.startDate, endDate: before.endDate },
        { status: after.status, startDate: after.startDate, endDate: after.endDate },
        { fields: ['status', 'startDate', 'endDate'] },
      );
      await this.sync.log(actor, 'STATUS_CHANGE', after, {
        ...(changes ? { changes } : {}),
        ...(cancelled
          ? {
              metadata: {
                cancelledInstallments: cancelled.installments,
                finishedRecurringCharges: cancelled.recurringCharges,
              },
            }
          : {}),
      });
      await this.sync.reindex(after);

      const result: ProjectStatusHint[] = projectStatusHints(after.status, {
        hasBillingPlan:
          after.status === 'EN_CURSO' ? await this.billing.hasBillingPlan(after.id) : true,
        hasActiveRecurringCharge:
          after.status === 'MANTENIMIENTO'
            ? await this.billing.hasActiveRecurringCharge(after.id)
            : true,
      });
      return result;
    });

    const project = await this.views.detail(actor, await reloadProject(this.projects, input.id));
    return { project, hints };
  }
}
