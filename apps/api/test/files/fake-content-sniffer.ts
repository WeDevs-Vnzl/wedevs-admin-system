import type { ContentSnifferPort } from '../../src/modules/platform/application/ports/content-sniffer.port';

/** Fake sniffer: the first byte decides. `%` = PDF, `P` = PNG, `M` = Windows executable, else none. */
export class FakeContentSniffer implements ContentSnifferPort {
  sniff(head: Uint8Array): Promise<{ mime: string } | null> {
    switch (head[0]) {
      case 0x25:
        return Promise.resolve({ mime: 'application/pdf' });
      case 0x50:
        return Promise.resolve({ mime: 'image/png' });
      case 0x4d:
        return Promise.resolve({ mime: 'application/x-msdownload' });
      default:
        return Promise.resolve(null);
    }
  }
}

export const PDF_HEAD = new TextEncoder().encode('%PDF-1.7\n%fake body');
export const PNG_HEAD = new TextEncoder().encode('PNG-fake-body');
export const EXE_HEAD = new TextEncoder().encode('MZ-fake-executable');
