import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { USER_ROLE_VALUES } from '../../../../../shared/domain/enums';
import {
  VALIDATION_MESSAGES,
  timestampSchema,
} from '../../../../../shared/interface/common.schemas';
import { createListQueryDto } from '../../../../../shared/interface/list-query.dto';

export const userRoleSchema = z.enum(USER_ROLE_VALUES);

export const USER_SORT_FIELDS = ['name', 'email', 'role', 'createdAt'] as const;

export class ListUsersQueryDto extends createListQueryDto({
  sortFields: USER_SORT_FIELDS,
  defaultSort: { field: 'name', direction: 'asc' },
  filters: { role: userRoleSchema },
}) {}

export const userListRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  imageUrl: z.string().nullable(),
  role: userRoleSchema,
  createdAt: timestampSchema,
});

export const userListResponseSchema = z.object({
  items: z.array(userListRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  pageCount: z.number().int(),
});
export class UserListResponseDto extends createZodDto(userListResponseSchema) {}

export const userDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  imageUrl: z.string().nullable(),
  role: userRoleSchema,
  locale: z.string(),
  theme: z.string(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export class UserDetailDto extends createZodDto(userDetailSchema) {}

export const changeUserRoleSchema = z.object({ role: userRoleSchema });
export class ChangeUserRoleDto extends createZodDto(changeUserRoleSchema) {}

export const inviteUserSchema = z.object({
  email: z.email({ error: VALIDATION_MESSAGES.invalidEmail }).max(254),
  role: userRoleSchema.default('ADMIN'),
});
export class InviteUserDto extends createZodDto(inviteUserSchema) {}

export const invitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: userRoleSchema,
  createdAt: timestampSchema,
});
export class InvitationDto extends createZodDto(invitationSchema) {}

export const invitationListResponseSchema = z.object({ items: z.array(invitationSchema) });
export class InvitationListResponseDto extends createZodDto(invitationListResponseSchema) {}

export const revokeInvitationResponseSchema = z.object({ invitationId: z.string() });
export class RevokeInvitationResponseDto extends createZodDto(revokeInvitationResponseSchema) {}
