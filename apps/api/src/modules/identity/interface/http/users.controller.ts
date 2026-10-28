import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { Authenticated, RequiresGrant } from '../../../../shared/interface/grant.decorator';
import { ChangeUserRole } from '../../application/use-cases/change-user-role.use-case';
import { GetUser } from '../../application/use-cases/get-user.use-case';
import { InviteUser } from '../../application/use-cases/invite-user.use-case';
import { ListInvitations } from '../../application/use-cases/list-invitations.use-case';
import { ListUsers } from '../../application/use-cases/list-users.use-case';
import { RevokeInvitation } from '../../application/use-cases/revoke-invitation.use-case';
import {
  ChangeUserRoleDto,
  InvitationDto,
  InvitationListResponseDto,
  InviteUserDto,
  ListUsersQueryDto,
  RevokeInvitationResponseDto,
  UserDetailDto,
  UserListResponseDto,
} from './dto/users.dto';
import { toInvitationDto, toUserDetailDto, toUserListRowDto } from './mappers';

/** Users, roles and invitations (HU-02 CA1: Owner only; a user may read their own detail). */
@ApiTags('identity')
@Controller('users')
export class UsersController {
  constructor(
    private readonly listUsers: ListUsers,
    private readonly getUser: GetUser,
    private readonly changeUserRole: ChangeUserRole,
    private readonly listInvitations: ListInvitations,
    private readonly inviteUser: InviteUser,
    private readonly revokeInvitation: RevokeInvitation,
  ) {}

  @Get()
  @RequiresGrant('user', 'read')
  @ApiOperation({ operationId: 'listUsers', summary: 'List users (Owner only)' })
  @ApiOkResponse({ type: UserListResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: ListUsersQueryDto,
  ): Promise<UserListResponseDto> {
    const page = await this.listUsers.execute(user, query);
    return { ...page, items: page.items.map(toUserListRowDto) };
  }

  // Declared before `:id` so `invitations` is never read as a user id.
  @Get('invitations')
  @RequiresGrant('user', 'read')
  @ApiOperation({
    operationId: 'listUserInvitations',
    summary: 'Pending invitations (read from Clerk, at most 100, unpaginated)',
  })
  @ApiOkResponse({ type: InvitationListResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'INTERNAL')
  async invitations(@CurrentUser() user: CurrentUserModel): Promise<InvitationListResponseDto> {
    return { items: (await this.listInvitations.execute(user)).map(toInvitationDto) };
  }

  @Post('invitations')
  @RequiresGrant('user', 'create')
  @ApiOperation({ operationId: 'inviteUser', summary: 'Invite a person by e-mail with a role' })
  @ApiCreatedResponse({ type: InvitationDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'CONFLICT', 'INTERNAL')
  async invite(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: InviteUserDto,
  ): Promise<InvitationDto> {
    return toInvitationDto(await this.inviteUser.execute(user, body));
  }

  @Post('invitations/:id/revoke')
  @HttpCode(200)
  @RequiresGrant('user', 'delete')
  @ApiOperation({ operationId: 'revokeUserInvitation', summary: 'Revoke a pending invitation' })
  @ApiOkResponse({ type: RevokeInvitationResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INTERNAL')
  async revoke(
    @CurrentUser() user: CurrentUserModel,
    @Param('id') id: string,
  ): Promise<RevokeInvitationResponseDto> {
    await this.revokeInvitation.execute(user, { invitationId: id });
    return { invitationId: id };
  }

  // `@Authenticated()` because a user may read their own detail; the use case runs `can()` otherwise.
  @Get(':id')
  @Authenticated()
  @ApiOperation({ operationId: 'getUser', summary: 'User detail (Owner, or the user themself)' })
  @ApiOkResponse({ type: UserDetailDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INTERNAL')
  async get(
    @CurrentUser() user: CurrentUserModel,
    @Param('id') id: string,
  ): Promise<UserDetailDto> {
    return toUserDetailDto(await this.getUser.execute(user, { id }));
  }

  @Patch(':id')
  @RequiresGrant('user', 'update')
  @ApiOperation({
    operationId: 'changeUserRole',
    summary: 'Change the role of a user (Owner only)',
  })
  @ApiOkResponse({ type: UserDetailDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'INTEGRITY_LOCK',
    'CONFLICT',
    'INTERNAL',
  )
  async changeRole(
    @CurrentUser() user: CurrentUserModel,
    @Param('id') id: string,
    @Body() body: ChangeUserRoleDto,
  ): Promise<UserDetailDto> {
    return toUserDetailDto(
      await this.changeUserRole.execute(user, { userId: id, role: body.role }),
    );
  }
}
