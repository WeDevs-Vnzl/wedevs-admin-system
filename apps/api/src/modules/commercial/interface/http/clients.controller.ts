import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { RequiresGrant } from '../../../../shared/interface/grant.decorator';
import { ArchiveClients } from '../../application/use-cases/archive-clients.use-case';
import { CreateClient } from '../../application/use-cases/create-client.use-case';
import { GetClient } from '../../application/use-cases/get-client.use-case';
import { ListClients } from '../../application/use-cases/list-clients.use-case';
import { RestoreClient } from '../../application/use-cases/restore-client.use-case';
import { SearchClients } from '../../application/use-cases/search-clients.use-case';
import { SetClientStatus } from '../../application/use-cases/set-client-status.use-case';
import { UpdateClient } from '../../application/use-cases/update-client.use-case';
import {
  ArchiveClientDto,
  ArchiveClientsDto,
  ClientArchiveResultDto,
  ClientDetailDto,
  ClientIdParamsDto,
  ClientListResponseDto,
  ClientsArchiveResultDto,
  CreateClientDto,
  ListClientsQueryDto,
  SearchClientsQueryDto,
  SetClientStatusDto,
  UpdateClientDto,
  toClientDetailResponse,
  toClientListRowResponse,
} from './dto/clients.dto';
import { EntityRefDto, toEntityRefResponse } from './dto/contacts.dto';

/**
 * Clients (PRD §8.2, HU-03). Every route declares its grant (C13) and the use case runs `can()` as the
 * authority. Money fields of the list are `null` without `canSeeFinancials`; the overview and the
 * financial summary are BE-5 (Q-BE2-4). `search` and `archive` are declared before the `:id` routes.
 */
@ApiTags('clients')
@Controller('clients')
export class ClientsController {
  constructor(
    private readonly listClients: ListClients,
    private readonly searchClients: SearchClients,
    private readonly getClient: GetClient,
    private readonly createClient: CreateClient,
    private readonly updateClient: UpdateClient,
    private readonly setClientStatus: SetClientStatus,
    private readonly archiveClients: ArchiveClients,
    private readonly restoreClient: RestoreClient,
  ) {}

  @Get()
  @RequiresGrant('client', 'read')
  @ApiOperation({
    operationId: 'listClients',
    summary: 'List clients (money fields null without canSeeFinancials)',
  })
  @ApiOkResponse({ type: ClientListResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: ListClientsQueryDto,
  ): Promise<ClientListResponseDto> {
    const page = await this.listClients.execute(user, query);
    return { ...page, items: page.items.map(toClientListRowResponse) };
  }

  @Get('search')
  @RequiresGrant('client', 'read')
  @ApiOperation({ operationId: 'searchClients', summary: 'Client typeahead (EntityRef, up to 20)' })
  @ApiOkResponse({ type: [EntityRefDto] })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async search(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: SearchClientsQueryDto,
  ): Promise<EntityRefDto[]> {
    return (await this.searchClients.execute(user, query)).map(toEntityRefResponse);
  }

  @Get(':id')
  @RequiresGrant('client', 'read')
  @ApiOperation({ operationId: 'getClient', summary: 'One client with its live contacts' })
  @ApiOkResponse({ type: ClientDetailDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async get(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ClientIdParamsDto,
  ): Promise<ClientDetailDto> {
    return toClientDetailResponse(await this.getClient.execute(user, { id: params.id }));
  }

  @Post()
  @RequiresGrant('client', 'create')
  @ApiOperation({ operationId: 'createClient', summary: 'Create a client (CLI-#### code)' })
  @ApiBody({ type: CreateClientDto })
  @ApiCreatedResponse({ type: ClientDetailDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'CONFLICT', 'INTERNAL')
  async create(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: CreateClientDto,
  ): Promise<ClientDetailDto> {
    return toClientDetailResponse(await this.createClient.execute(user, body));
  }

  @Patch(':id')
  @RequiresGrant('client', 'update')
  @ApiOperation({ operationId: 'updateClient', summary: 'Replace the editable fields of a client' })
  @ApiBody({ type: UpdateClientDto })
  @ApiOkResponse({ type: ClientDetailDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTERNAL',
  )
  async update(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ClientIdParamsDto,
    @Body() body: UpdateClientDto,
  ): Promise<ClientDetailDto> {
    return toClientDetailResponse(
      await this.updateClient.execute(user, { ...body, id: params.id }),
    );
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequiresGrant('client', 'update')
  @ApiOperation({ operationId: 'setClientStatus', summary: 'Change the status of a client' })
  @ApiBody({ type: SetClientStatusDto })
  @ApiOkResponse({ type: ClientDetailDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async setStatus(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ClientIdParamsDto,
    @Body() body: SetClientStatusDto,
  ): Promise<ClientDetailDto> {
    return toClientDetailResponse(
      await this.setClientStatus.execute(user, { id: params.id, status: body.status }),
    );
  }

  @Post('archive')
  @HttpCode(200)
  @RequiresGrant('client', 'delete')
  @ApiOperation({
    operationId: 'archiveClients',
    summary: 'Archive several clients and their contacts, all or nothing',
  })
  @ApiBody({ type: ArchiveClientsDto })
  @ApiOkResponse({ type: ClientsArchiveResultDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'INTEGRITY_LOCK',
    'INTERNAL',
  )
  async archiveMany(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: ArchiveClientsDto,
  ): Promise<ClientsArchiveResultDto> {
    const archived = await this.archiveClients.execute(user, body);
    return {
      archived: archived.map((row) => ({ ...row, archivedAt: row.archivedAt.toISOString() })),
    };
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequiresGrant('client', 'delete')
  @ApiOperation({
    operationId: 'archiveClient',
    summary:
      'Archive a client and its contacts (confirm needed with active projects or open invoices)',
  })
  @ApiBody({ type: ArchiveClientDto })
  @ApiOkResponse({ type: ClientArchiveResultDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'INTEGRITY_LOCK',
    'INTERNAL',
  )
  async archive(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ClientIdParamsDto,
    @Body() body: ArchiveClientDto,
  ): Promise<ClientArchiveResultDto> {
    const [row] = await this.archiveClients.execute(user, {
      ids: [params.id],
      confirm: body.confirm,
    });
    if (!row) throw new Error('ArchiveClients returned no result for one id');
    return { ...row, archivedAt: row.archivedAt.toISOString() };
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequiresGrant('trash', 'restore')
  @ApiOperation({
    operationId: 'restoreClient',
    summary: 'Restore an archived client and its cascade contacts',
  })
  @ApiOkResponse({ type: ClientDetailDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTERNAL',
  )
  async restore(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ClientIdParamsDto,
  ): Promise<ClientDetailDto> {
    return toClientDetailResponse(await this.restoreClient.execute(user, { id: params.id }));
  }
}
