import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { RequiresGrant } from '../../../../shared/interface/grant.decorator';
import { ArchiveContact } from '../../application/use-cases/archive-contact.use-case';
import { CreateContact } from '../../application/use-cases/create-contact.use-case';
import { ListContacts } from '../../application/use-cases/list-contacts.use-case';
import { SearchContacts } from '../../application/use-cases/search-contacts.use-case';
import { SetPrimaryContact } from '../../application/use-cases/set-primary-contact.use-case';
import { UpdateContact } from '../../application/use-cases/update-contact.use-case';
import {
  ClientContactsParamsDto,
  ContactArchivedDto,
  ContactIdParamsDto,
  ContactListResponseDto,
  ContactViewDto,
  CreateContactDto,
  EntityRefDto,
  toEntityRefResponse,
  ListContactsQueryDto,
  SearchContactsQueryDto,
  UpdateContactDto,
  toContactResponse,
} from './dto/contacts.dto';

/**
 * Contacts (PRD §8.2 "Contacto", HU-04): they live under their client. Restore happens through the client
 * cascade or the trash, so there is no restore route here.
 */
@ApiTags('clients')
@Controller()
export class ContactsController {
  constructor(
    private readonly listContacts: ListContacts,
    private readonly searchContacts: SearchContacts,
    private readonly createContact: CreateContact,
    private readonly updateContact: UpdateContact,
    private readonly setPrimaryContact: SetPrimaryContact,
    private readonly archiveContact: ArchiveContact,
  ) {}

  @Get('clients/:id/contacts')
  @RequiresGrant('contact', 'read')
  @ApiOperation({ operationId: 'listContacts', summary: 'Contacts of a client, primary first' })
  @ApiOkResponse({ type: ContactListResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ClientContactsParamsDto,
    @Query() query: ListContactsQueryDto,
  ): Promise<ContactListResponseDto> {
    const page = await this.listContacts.execute(user, { clientId: params.id, query });
    return { ...page, items: page.items.map(toContactResponse) };
  }

  @Post('clients/:id/contacts')
  @RequiresGrant('contact', 'create')
  @ApiOperation({ operationId: 'createContact', summary: 'Create a contact of a live client' })
  @ApiBody({ type: CreateContactDto })
  @ApiCreatedResponse({ type: ContactViewDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTERNAL',
  )
  async create(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ClientContactsParamsDto,
    @Body() body: CreateContactDto,
  ): Promise<ContactViewDto> {
    return toContactResponse(
      await this.createContact.execute(user, { ...body, clientId: params.id }),
    );
  }

  @Get('contacts/search')
  @RequiresGrant('contact', 'read')
  @ApiOperation({
    operationId: 'searchContacts',
    summary: 'Contact typeahead (EntityRef, up to 20)',
  })
  @ApiOkResponse({ type: [EntityRefDto] })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async search(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: SearchContactsQueryDto,
  ): Promise<EntityRefDto[]> {
    return (await this.searchContacts.execute(user, query)).map(toEntityRefResponse);
  }

  @Patch('contacts/:id')
  @RequiresGrant('contact', 'update')
  @ApiOperation({
    operationId: 'updateContact',
    summary: 'Replace the editable fields of a contact',
  })
  @ApiBody({ type: UpdateContactDto })
  @ApiOkResponse({ type: ContactViewDto })
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
    @Param() params: ContactIdParamsDto,
    @Body() body: UpdateContactDto,
  ): Promise<ContactViewDto> {
    return toContactResponse(await this.updateContact.execute(user, { ...body, id: params.id }));
  }

  @Post('contacts/:id/primary')
  @HttpCode(200)
  @RequiresGrant('contact', 'update')
  @ApiOperation({
    operationId: 'setPrimaryContact',
    summary: 'Make a contact the primary one of its client',
  })
  @ApiOkResponse({ type: ContactViewDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTERNAL',
  )
  async setPrimary(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ContactIdParamsDto,
  ): Promise<ContactViewDto> {
    return toContactResponse(await this.setPrimaryContact.execute(user, { id: params.id }));
  }

  @Post('contacts/:id/archive')
  @HttpCode(200)
  @RequiresGrant('contact', 'delete')
  @ApiOperation({ operationId: 'archiveContact', summary: 'Archive a contact' })
  @ApiOkResponse({ type: ContactArchivedDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async archive(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: ContactIdParamsDto,
  ): Promise<ContactArchivedDto> {
    const result = await this.archiveContact.execute(user, { id: params.id });
    return { id: result.id, archivedAt: result.archivedAt.toISOString() };
  }
}
