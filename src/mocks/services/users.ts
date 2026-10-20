// MOCK — users and roles of Hito 1 (PRD §4, §8.15 "Usuarios"; HU-02 CA1). `fn(ctx, input)`, framework-free
// (C11). Owner only: every service checks `can(user, …, "user")`, except that a user may read their own
// detail. Users are the store's `users`; pending invitations (Clerk in Hito 2) live in memory per store and
// are listed next to them as `INVITED` rows. The last Owner can never be demoted (INTEGRITY_LOCK). Replaced
// by `src/server/services/users.service.ts` in Hito 2 (C9).
import { diffFields } from "@/lib/activity-diff";
import type { Paginated } from "@/lib/validators/common";
import type { UserRole } from "@/lib/validators/enums";
import type {
  ChangeUserRoleInput,
  InviteUserInput,
  RevokeUserInvitationInput,
  UserDetailDTO,
  UserFilter,
  UserIdInput,
  UserListRowDTO,
} from "@/lib/validators/users";
import { can } from "@/server/auth/permissions";
import { ServiceError, type MockServiceContext } from "../ctx";
import { nextMockId } from "../ids";
import type { MockStore } from "../store";
import { logActivity, mockTx } from "./activity";
import { listRows, type ListSpec } from "./list";

const MESSAGES = {
  emailTaken: "settings.users.errors.emailTaken",
  lastOwner: "settings.users.errors.lastOwner",
} as const;

interface InvitationRow {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

/** Pending invitations per store; a rebuilt store starts with none. */
const invitationsByStore = new WeakMap<MockStore, InvitationRow[]>();

function invitationsOf(db: MockStore): InvitationRow[] {
  let rows = invitationsByStore.get(db);
  if (!rows) invitationsByStore.set(db, (rows = []));
  return rows;
}

function requireGrant(ctx: MockServiceContext, action: "read" | "create" | "update" | "delete") {
  if (!can(ctx.user, action, "user")) throw new ServiceError("FORBIDDEN");
}

function toListRow(user: UserDetailDTO): UserListRowDTO {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    imageUrl: user.imageUrl,
    role: user.role,
    status: "ACTIVE",
    createdAt: user.createdAt,
  };
}

function invitationRow(row: InvitationRow): UserListRowDTO {
  return { ...row, name: null, imageUrl: null, status: "INVITED" };
}

const userSpec: ListSpec<UserListRowDTO> = {
  searchText: (row) => [row.name, row.email],
  sorters: {
    name: (row) => row.name ?? row.email,
    email: (row) => row.email,
    role: (row) => row.role,
    createdAt: (row) => row.createdAt,
  },
  defaultSort: "name:asc",
};

export async function listUsers(
  ctx: MockServiceContext,
  input: UserFilter,
): Promise<Paginated<UserListRowDTO>> {
  requireGrant(ctx, "read");
  const rows = [...ctx.db.users.map(toListRow), ...invitationsOf(ctx.db).map(invitationRow)]
    .filter((row) => !input.role || input.role.includes(row.role))
    .filter((row) => !input.status || input.status.includes(row.status));
  return listRows(rows, input, userSpec);
}

/** The Owner reads anyone; every user reads their own detail. */
export async function getUser(ctx: MockServiceContext, input: UserIdInput): Promise<UserDetailDTO> {
  if (input.id !== ctx.user.id) requireGrant(ctx, "read");
  const user = ctx.db.users.find((item) => item.id === input.id);
  if (!user) throw new ServiceError("NOT_FOUND");
  return structuredClone(user);
}

/** A pending invitation; `CONFLICT` when the e-mail already has a user or an invitation. */
export async function inviteUser(
  ctx: MockServiceContext,
  input: InviteUserInput,
): Promise<UserListRowDTO> {
  requireGrant(ctx, "create");
  const email = input.email.toLowerCase();
  const invitations = invitationsOf(ctx.db);
  const taken =
    ctx.db.users.some((user) => user.email.toLowerCase() === email) ||
    invitations.some((row) => row.email === email);
  if (taken) throw new ServiceError("CONFLICT", { fieldErrors: { email: [MESSAGES.emailTaken] } });
  const row: InvitationRow = {
    id: nextMockId(ctx.db.idCounters, "uinv", (id) => invitations.some((item) => item.id === id)),
    email,
    role: input.role,
    createdAt: ctx.now.toISOString(),
  };
  invitations.push(row);
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "CREATE",
    entityType: "USER",
    entityId: row.id,
    entityLabel: email,
    metadata: { invitation: true, role: row.role },
  });
  return invitationRow(row);
}

export async function changeUserRole(
  ctx: MockServiceContext,
  input: ChangeUserRoleInput,
): Promise<UserDetailDTO> {
  requireGrant(ctx, "update");
  const user = ctx.db.users.find((item) => item.id === input.userId);
  if (!user) throw new ServiceError("NOT_FOUND");
  const owners = ctx.db.users.filter((item) => item.role === "OWNER");
  if (user.role === "OWNER" && input.role !== "OWNER" && owners.length <= 1) {
    throw new ServiceError("INTEGRITY_LOCK", { message: MESSAGES.lastOwner });
  }
  const changes = diffFields({ role: user.role }, { role: input.role }, { fields: ["role"] });
  if (changes) {
    user.role = input.role;
    user.updatedAt = ctx.now.toISOString();
    await logActivity(mockTx(ctx), {
      actorType: "USER",
      actorId: ctx.user.id,
      action: "UPDATE",
      entityType: "USER",
      entityId: user.id,
      entityLabel: user.name,
      changes,
    });
  }
  return structuredClone(user);
}

export async function revokeUserInvitation(
  ctx: MockServiceContext,
  input: RevokeUserInvitationInput,
): Promise<RevokeUserInvitationInput> {
  requireGrant(ctx, "delete");
  const invitations = invitationsOf(ctx.db);
  const index = invitations.findIndex((row) => row.id === input.invitationId);
  if (index < 0) throw new ServiceError("NOT_FOUND");
  invitations.splice(index, 1);
  return { invitationId: input.invitationId };
}
