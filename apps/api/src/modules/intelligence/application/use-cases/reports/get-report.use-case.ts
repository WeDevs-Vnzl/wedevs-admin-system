import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import { NotFoundError } from '../../../../../shared/domain/domain-error';
import { parseReportSlug } from '../../../domain/report-range';
import type { FinanceFactsReadPort } from '../../ports/finance-facts-read.port';
import type { ReportInputsReadPort } from '../../ports/report-inputs-read.port';
import { buildReport } from './report-builders';
import { resolveReportFilter, type ReportFilterInput } from './report-support';
import type { ReportOutput } from './report-types';

export interface GetReportInput extends ReportFilterInput {
  /** The kebab-case id of the report (`collected-by-month`); outside the whitelist it is `NOT_FOUND`. */
  readonly slug: string;
}

/**
 * `GET /reports/{slug}` (PRD §8.13.1, HU-31): one of the ten financial reports over `FinanceFact`, Owner and
 * Admin only (`read report`). Every amount is a USD snapshot summed in the database (C15, C16); the
 * filters narrow the facts. Authorizes first, then validates the slug and the filter, then reads.
 */
export class GetReport {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly facts: FinanceFactsReadPort,
    private readonly inputs: ReportInputsReadPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, input: GetReportInput): Promise<ReportOutput> {
    assertCan(this.authorization, actor, 'read', 'report');
    const id = parseReportSlug(input.slug);
    if (id === null) throw new NotFoundError();
    const filter = await resolveReportFilter(this.inputs, this.clock, input);
    return buildReport({ facts: this.facts, inputs: this.inputs }, id, filter);
  }
}
