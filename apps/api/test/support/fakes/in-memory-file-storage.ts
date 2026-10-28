import type {
  FileStoragePort,
  UploadIntent,
} from '../../../src/modules/platform/application/ports/file-storage.port';
import type { UploadContext } from '../../../src/modules/platform/domain/upload-rules';

/**
 * Fake `FileStoragePort`: objects live in a map, so a test "uploads" with `put`. Reusable by BE-3/BE-4.
 * Download URLs are deterministic and carry the expiry and the attachment name, never a secret.
 */
export class InMemoryFileStorage implements FileStoragePort {
  readonly bucket = 'memory';
  private readonly objects = new Map<string, Uint8Array>();
  readonly destroyed: string[] = [];
  readonly intents: { storageKey: string; context: UploadContext; expiresAt: Date }[] = [];
  /** Makes the next `destroy` calls fail (the cleanup-failure paths). */
  failDestroy = false;

  put(storageKey: string, bytes: Uint8Array): void {
    this.objects.set(storageKey, bytes);
  }

  has(storageKey: string): boolean {
    return this.objects.has(storageKey);
  }

  createUploadIntent(input: {
    storageKey: string;
    context: UploadContext;
    expiresAt: Date;
  }): Promise<UploadIntent> {
    this.intents.push(input);
    return Promise.resolve({
      url: 'https://storage.test/upload',
      fields: { public_id: input.storageKey, signature: 'fake-signature' },
      expiresAt: input.expiresAt,
    });
  }

  getObjectInfo(storageKey: string): Promise<{ bytes: number } | null> {
    const bytes = this.objects.get(storageKey);
    return Promise.resolve(bytes ? { bytes: bytes.byteLength } : null);
  }

  readHead(storageKey: string, n: number): Promise<Uint8Array> {
    const bytes = this.objects.get(storageKey);
    if (!bytes) return Promise.reject(new Error(`no object ${storageKey}`));
    return Promise.resolve(bytes.slice(0, n));
  }

  signedDownloadUrl(
    storageKey: string,
    input: { fileName: string; expiresAt: Date },
  ): Promise<string> {
    const query = new URLSearchParams({
      name: input.fileName,
      exp: String(input.expiresAt.getTime()),
    });
    return Promise.resolve(`https://storage.test/download/${storageKey}?${query.toString()}`);
  }

  destroy(storageKey: string): Promise<void> {
    if (this.failDestroy) return Promise.reject(new Error('storage unavailable'));
    this.objects.delete(storageKey);
    this.destroyed.push(storageKey);
    return Promise.resolve();
  }
}
