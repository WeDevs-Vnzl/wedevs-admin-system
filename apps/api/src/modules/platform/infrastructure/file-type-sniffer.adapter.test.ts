import { describe, expect, it } from 'vitest';
import { FileTypeSniffer } from './file-type-sniffer.adapter';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);

/** A minimal ZIP local-file header for an entry named `name` (stored, empty). */
function zipHead(name: string): Uint8Array {
  const nameBytes = ascii(name);
  const header = new Uint8Array(30 + nameBytes.length);
  header.set(bytes(0x50, 0x4b, 0x03, 0x04, 20, 0), 0); // PK\3\4, version 20
  header[26] = nameBytes.length; // file name length (little endian)
  header.set(nameBytes, 30);
  return header;
}

describe('FileTypeSniffer (real magic bytes)', () => {
  const sniffer = new FileTypeSniffer();

  it('detects a PDF', async () => {
    expect(await sniffer.sniff(ascii('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n'))).toEqual({
      mime: 'application/pdf',
    });
  });

  it('detects a PNG', async () => {
    const png = bytes(
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      0,
      0,
      0,
      0x0d,
      0x49,
      0x48,
      0x44,
      0x52,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      1,
      8,
      6,
      0,
      0,
      0,
    );
    expect(await sniffer.sniff(png)).toEqual({ mime: 'image/png' });
  });

  it('detects a DOCX as its Office type and a generic ZIP as a ZIP', async () => {
    const docx = await sniffer.sniff(zipHead('word/document.xml'));
    expect(docx?.mime).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(await sniffer.sniff(zipHead('readme.txt'))).toEqual({ mime: 'application/zip' });
  });

  it('detects executables so the allowlist can reject them', async () => {
    const exe = await sniffer.sniff(ascii('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff'));
    expect(exe?.mime).toBe('application/x-msdownload');
    const elf = await sniffer.sniff(
      bytes(0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    );
    expect(elf?.mime).toBe('application/x-elf');
  });

  it('returns null for plain text and for empty input', async () => {
    expect(await sniffer.sniff(ascii('# Just markdown\n\nsome text'))).toBeNull();
    expect(await sniffer.sniff(new Uint8Array(0))).toBeNull();
  });
});
