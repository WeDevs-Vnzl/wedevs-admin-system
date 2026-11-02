import { Body, Controller, HttpCode, Param, Post, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { parseSort } from '../../../../shared/domain/list-query';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { Authenticated } from '../../../../shared/interface/grant.decorator';
import { ExportCsv } from '../../application/use-cases/exports/export-csv.use-case';
import { ExportBodyDto, ExportParamsDto } from './dto/exports.dto';

/**
 * Server CSV export (PRD §7.3, DT-171). `@Authenticated()` because the grant belongs to the table: the
 * source reads through that table's own list use case, which runs its `can()` and money gates (C13). The
 * answer is the file, not a JSON envelope; the row count and the cut are headers.
 */
@ApiTags('exports')
@Controller('exports')
export class ExportsController {
  constructor(private readonly exportCsv: ExportCsv) {}

  @Post(':entity')
  @HttpCode(200)
  @Authenticated()
  @ApiOperation({
    operationId: 'exportCsv',
    summary: 'CSV of a table (at most 10,000 rows, UTF-8 BOM) with the columns and filters sent',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description:
      'The file (text/csv; charset=utf-8). X-Export-Row-Count and X-Export-Truncated describe it.',
    headers: {
      'Content-Disposition': { schema: { type: 'string' } },
      'X-Export-Row-Count': { schema: { type: 'integer' } },
      'X-Export-Truncated': { schema: { type: 'string', enum: ['true', 'false'] } },
    },
    content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION', 'INTERNAL')
  async export(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ExportParamsDto,
    @Body() body: ExportBodyDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const result = await this.exportCsv.execute(user, {
      entity: params.entity,
      query: {
        sort: body.query.sort === undefined ? null : parseSort(body.query.sort),
        archived: body.query.archived,
        filters: body.query.filters,
        ...(body.query.q === undefined ? {} : { q: body.query.q }),
      },
      columns: body.columns,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-Export-Row-Count', String(result.rowCount));
    res.setHeader('X-Export-Truncated', String(result.truncated));
    res.setHeader('Cache-Control', 'no-store');
    return result.content;
  }
}
