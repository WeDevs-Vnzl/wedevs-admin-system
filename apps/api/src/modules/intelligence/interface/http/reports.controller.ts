import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { RequiresGrant } from '../../../../shared/interface/grant.decorator';
import { GetKpis } from '../../application/use-cases/reports/get-kpis.use-case';
import { GetReport } from '../../application/use-cases/reports/get-report.use-case';
import type { ReportOutput } from '../../application/use-cases/reports/report-types';
import { KpisResponseDto, REPORT_RESPONSE_DTOS, ReportFilterQueryDto } from './reports.dto';

/** `reportId` wire id → report schema, read from each DTO's literal so the two cannot drift. */
const REPORT_DISCRIMINATOR_MAPPING: Record<string, string> = Object.fromEntries(
  REPORT_RESPONSE_DTOS.map((dto) => [dto.schema.shape.reportId.value, getSchemaPath(dto)]),
);

/**
 * Reports and KPIs (PRD §8.13, HU-31): Owner and Admin only. `/reports/kpis` is declared before
 * `/reports/:slug` so the literal wins; the slug is whitelisted by the use case. The use cases run `can()`
 * first; the route grant is the coarse check (C13).
 */
@ApiTags('reports')
@Controller('reports')
@RequiresGrant('report', 'read')
export class ReportsController {
  constructor(
    private readonly getKpis: GetKpis,
    private readonly getReport: GetReport,
  ) {}

  @Get('kpis')
  @ApiOperation({
    operationId: 'getKpis',
    summary: 'The 18 KPIs: value, previous period, change and a 12-month sparkline',
  })
  @ApiOkResponse({ type: KpisResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION', 'INTERNAL')
  kpis(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: ReportFilterQueryDto,
  ): Promise<KpisResponseDto> {
    return this.getKpis.execute(user, query);
  }

  @Get(':slug')
  @ApiOperation({
    operationId: 'getReport',
    summary: 'One of the ten reports, by the kebab-case id (`collected-by-month`)',
  })
  @ApiExtraModels(...REPORT_RESPONSE_DTOS)
  @ApiOkResponse({
    schema: {
      oneOf: REPORT_RESPONSE_DTOS.map((dto) => ({ $ref: getSchemaPath(dto) })),
      // The mapping ties each wire id to its schema; without it generated clients type `reportId` as the
      // schema name and cannot narrow the union.
      discriminator: { propertyName: 'reportId', mapping: REPORT_DISCRIMINATOR_MAPPING },
    },
  })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION', 'INTERNAL')
  report(
    @CurrentUser() user: CurrentUserModel,
    @Param('slug') slug: string,
    @Query() query: ReportFilterQueryDto,
  ): Promise<ReportOutput> {
    return this.getReport.execute(user, { ...query, slug });
  }
}
