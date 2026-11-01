import type { UploadContext } from '../../domain/upload-rules';

export const FILE_STORAGE = Symbol('FILE_STORAGE');

export type FileDisposition = 'attachment' | 'inline';

export interface UploadIntent {
  /** Where the browser POSTs the multipart form. */
  readonly url: string;
  /** Form fields to send with the file, signed by the storage provider. */
  readonly fields: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}

/** Private object storage (Cloudinary today). No provider type crosses this port (DT-85). */
export interface FileStoragePort {
  /** Logical bucket recorded on the `File` row. */
  readonly bucket: string;
  createUploadIntent(input: {
    readonly storageKey: string;
    readonly context: UploadContext;
    readonly expiresAt: Date;
  }): Promise<UploadIntent>;
  /** `null` when the object does not exist (the browser never uploaded it). */
  getObjectInfo(storageKey: string): Promise<{ readonly bytes: number } | null>;
  /** The first `n` bytes of the object, for magic-byte sniffing. */
  readHead(storageKey: string, n: number): Promise<Uint8Array>;
  /**
   * Short-lived signed URL for the object, named `fileName`. `disposition` defaults to `attachment`
   * (a download); `inline` leaves the browser to render the file.
   */
  signedDownloadUrl(
    storageKey: string,
    input: {
      readonly fileName: string;
      readonly expiresAt: Date;
      readonly disposition?: FileDisposition;
    },
  ): Promise<string>;
  /** Deletes the object. Idempotent: a missing object is not an error. */
  destroy(storageKey: string): Promise<void>;
}
