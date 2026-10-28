import type { FileAccessClaim, FileAccessResolver } from './ports/file-access.port';

/**
 * Multi-provider registry of `FileAccessResolver`s. Contexts call `register` from their module's
 * `onModuleInit`. No claims at all means the file is unattached.
 */
export class FileAccessRegistry {
  private readonly resolvers: FileAccessResolver[] = [];

  register(resolver: FileAccessResolver): void {
    if (!this.resolvers.includes(resolver)) this.resolvers.push(resolver);
  }

  /** Every claim on the file, in registration order. */
  async claimsFor(fileId: string): Promise<FileAccessClaim[]> {
    const claims: FileAccessClaim[] = [];
    for (const resolver of this.resolvers) {
      const claim = await resolver.resolve(fileId);
      if (claim) claims.push(claim);
    }
    return claims;
  }
}
