// MOCK — Hito 1 has no object storage, so a PDF file version is served as a one-page PDF written here from the
// document's own data (S11 793/805/817: the viewer renders a real PDF through pdf.js). Hito 2 serves the stored
// bytes through a presigned URL instead.

/** A PDF string literal: backslash and parentheses escaped, anything outside printable Latin-1 as `?`. */
function pdfText(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 63;
    if (char === "\\" || char === "(" || char === ")") out += `\\${char}`;
    else if (code >= 32 && code <= 126) out += char;
    // WinAnsiEncoding covers Latin-1 accents (á, ñ…) as octal escapes.
    else if (code >= 160 && code <= 255) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += "?";
  }
  return `(${out})`;
}

export interface SamplePdfContent {
  title: string;
  lines: readonly string[];
}

/** A valid one-page A4 PDF 1.4 (Helvetica, WinAnsi) with a title and a few lines of text. */
export function samplePdf({ title, lines }: SamplePdfContent): Uint8Array {
  const text = [
    "BT",
    "/F1 20 Tf",
    "56 770 Td",
    `${pdfText(title)} Tj`,
    "/F1 12 Tf",
    ...lines.flatMap((line) => ["0 -28 Td", `${pdfText(line)} Tj`]),
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];

  // Every character is ASCII from here on, so string offsets are byte offsets.
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return new TextEncoder().encode(body);
}
