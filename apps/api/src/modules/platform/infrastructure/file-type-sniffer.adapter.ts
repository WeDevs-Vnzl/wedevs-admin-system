import type { ContentSnifferPort } from '../application/ports/content-sniffer.port';

type FileTypeModule = typeof import('file-type');

let loaded: Promise<FileTypeModule> | undefined;
/** `file-type` is ESM-only; a dynamic import keeps the CommonJS build working. */
function fileType(): Promise<FileTypeModule> {
  loaded ??= import('file-type');
  return loaded;
}

/** Magic-byte detection with `file-type` (C23). Returns `null` for unknown signatures and plain text. */
export class FileTypeSniffer implements ContentSnifferPort {
  async sniff(head: Uint8Array): Promise<{ mime: string } | null> {
    const { fileTypeFromBuffer } = await fileType();
    const detected = await fileTypeFromBuffer(head);
    return detected ? { mime: detected.mime } : null;
  }
}
