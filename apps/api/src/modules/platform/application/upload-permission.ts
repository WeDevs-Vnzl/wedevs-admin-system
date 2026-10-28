import type { PermissionResource } from '../../../shared/application/authorization';
import type { CurrentUser } from '../../../shared/application/current-user';
import type { AuthorizationPort } from '../../../shared/application/ports/authorization.port';
import { ForbiddenError } from '../../../shared/domain/domain-error';

/** Resources a file can be attached to (Q-BE1-3). */
export const ATTACHABLE_RESOURCES: readonly PermissionResource[] = [
  'note',
  'document',
  'invoice',
  'payment',
  'expense',
  'settings',
];

/**
 * Uploading needs `create` on at least one attachable resource (Q-BE1-3): Owner, Admin and Member pass,
 * Viewer gets `FORBIDDEN`. The authorization port stays the only source of the matrix (C13).
 */
export function assertCanUploadFiles(authorization: AuthorizationPort, user: CurrentUser): void {
  if (!ATTACHABLE_RESOURCES.some((resource) => authorization.can(user, 'create', resource))) {
    throw new ForbiddenError();
  }
}

/** Called when removing the stored asset fails after the database already committed (a job retries). */
export type CleanupFailureHandler = (
  error: unknown,
  context: { readonly fileId: string; readonly storageKey: string },
) => void;
