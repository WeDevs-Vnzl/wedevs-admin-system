import { Injectable } from '@nestjs/common';
import { FinanceLookups } from '../../commercial/application/finance-lookups';
import type {
  BillingProject,
  BillingProjectsPort,
} from '../application/ports/billing-projects.port';

/** `BillingProjectsPort` over commercial's exported `FinanceLookups` (rule (e)). */
@Injectable()
export class CommercialBillingProjectsAdapter implements BillingProjectsPort {
  constructor(private readonly lookups: FinanceLookups) {}

  async liveProject(id: string): Promise<BillingProject | null> {
    const project = await this.lookups.liveProject(id);
    if (project === null) return null;
    return {
      id: project.ref.id,
      code: project.ref.code ?? '',
      name: project.ref.label,
      clientIds: project.clientIds,
    };
  }
}
