export const CONTENT_SNIFFER = Symbol('CONTENT_SNIFFER');

/** Detects the real MIME type from magic bytes. `null` = no signature matched (e.g. plain text). */
export interface ContentSnifferPort {
  sniff(head: Uint8Array): Promise<{ readonly mime: string } | null>;
}
