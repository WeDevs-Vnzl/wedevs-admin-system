import type { CurrentUser } from '../../../../shared/application/current-user';
import type { AuthorizationPort } from '../../../../shared/application/ports/authorization.port';
import type { FileStatus } from '../../../../shared/domain/enums';
import type { FileAccessRegistry } from '../file-access.registry';
import type { FileRepository } from '../ports/file.repository.port';
import { assertCanUploadFiles } from '../upload-permission';

export interface FileSummary {
  readonly id: string;
  readonly status: FileStatus;
  readonly mimeType: string;
  readonly uploadedById: string;
  /** True when a context claims the file (access resolver) or a business row references it. */
  readonly attached: boolean;
}

/**
 * Exported to other contexts (e.g. settings validating a logo id) so they never read `File` themselves.
 * `null` when the file does not exist or is deleted. It exposes no name, key or URL.
 */
export class GetFileSummary {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly files: FileRepository,
    private readonly registry: FileAccessRegistry,
  ) {}

  async execute(user: CurrentUser, fileId: string): Promise<FileSummary | null> {
    assertCanUploadFiles(this.authorization, user);
    const file = await this.files.findById(fileId);
    if (!file) return null;
    const attached =
      (await this.registry.claimsFor(file.id)).length > 0 ||
      (await this.files.isReferenced(file.id));
    return {
      id: file.id,
      status: file.status,
      mimeType: file.mimeType,
      uploadedById: file.uploadedById,
      attached,
    };
  }
}
