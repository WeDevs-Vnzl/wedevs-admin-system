import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { NotFoundError } from '../../../../../shared/domain/domain-error';
import type { BillingProjectsPort } from '../../ports/billing-projects.port';
import type { BillingRepository } from '../../ports/billing.repository.port';
import { loadPage, type BillingPageView } from './billing-support';

/**
 * `GET /projects/{id}/billing` (PRD §8.4): plan, installments and recurring charges of a live project.
 * `can(read, billing)` → live project (unknown and archived are `NOT_FOUND`, C14) → one consistent read.
 */
export class GetBillingPage {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly projects: BillingProjectsPort,
    private readonly repository: BillingRepository,
  ) {}

  async execute(actor: CurrentUser, projectId: string): Promise<BillingPageView> {
    assertCan(this.authorization, actor, 'read', 'billing');
    if ((await this.projects.liveProject(projectId)) === null) throw new NotFoundError();
    return this.uow.run(() => loadPage(this.repository, projectId), {
      isolation: 'RepeatableRead',
    });
  }
}
