import type { PermissionResource } from '../../../../shared/application/authorization';

export const FILE_ACCESS_REGISTRY = Symbol('FILE_ACCESS_REGISTRY');

/** What a context says about a file it owns. */
export type FileAccessClaim =
  /** Any authenticated user may download it (e.g. the company logo). */
  | { readonly kind: 'authenticated' }
  /** Downloading needs `read` on this resource (and `ownerId` for "own records only" grants). */
  | {
      readonly kind: 'resource';
      readonly resource: PermissionResource;
      readonly ownerId?: string | null;
    };

/**
 * A context's answer to "does this file belong to something of mine?". Each context registers one in its
 * own module; the platform never reads another context's tables.
 */
export interface FileAccessResolver {
  /** `null` when the file is not attached to anything of this context. */
  resolve(fileId: string): Promise<FileAccessClaim | null>;
}
