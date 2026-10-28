// Pure text transforms behind the markdown editor's toolbar (wireframe 4.9). Each one takes the source and the
// selection and returns the new source with the selection to restore, so the toolbar never touches the DOM text.

export type MarkdownFormat =
  | "h1"
  | "h2"
  | "h3"
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "link"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "table"
  | "quote"
  | "codeBlock";

export interface FormatResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

const PLACEHOLDER = "text";

const INLINE_MARKS: Partial<Record<MarkdownFormat, string>> = {
  bold: "**",
  italic: "*",
  strike: "~~",
  code: "`",
};

const LINE_PREFIXES: Partial<Record<MarkdownFormat, (index: number) => string>> = {
  h1: () => "# ",
  h2: () => "## ",
  h3: () => "### ",
  bulletList: () => "- ",
  orderedList: (index) => `${index + 1}. `,
  taskList: () => "- [ ] ",
  quote: () => "> ",
};

const TABLE_TEMPLATE = "| Column | Column |\n| --- | --- |\n|  |  |";

/** Replaces `[from, to)` with `insert` and selects `[selectFrom, selectTo)` inside the inserted text. */
function splice(
  value: string,
  from: number,
  to: number,
  insert: string,
  selectFrom: number,
  selectTo: number,
): FormatResult {
  return {
    value: value.slice(0, from) + insert + value.slice(to),
    selectionStart: from + selectFrom,
    selectionEnd: from + selectTo,
  };
}

export function applyMarkdownFormat(
  value: string,
  start: number,
  end: number,
  format: MarkdownFormat,
): FormatResult {
  const selected = value.slice(start, end);
  const text = selected || PLACEHOLDER;

  const mark = INLINE_MARKS[format];
  if (mark) {
    return splice(
      value,
      start,
      end,
      `${mark}${text}${mark}`,
      mark.length,
      mark.length + text.length,
    );
  }

  const prefix = LINE_PREFIXES[format];
  if (prefix) {
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const nextBreak = value.indexOf("\n", end);
    const lineEnd = nextBreak === -1 ? value.length : nextBreak;
    const lines = value
      .slice(lineStart, lineEnd)
      .split("\n")
      .map((line, index) => prefix(index) + line);
    const block = lines.join("\n");
    return splice(value, lineStart, lineEnd, block, block.length, block.length);
  }

  if (format === "link") {
    const insert = `[${text}](https://)`;
    const urlStart = text.length + 3;
    return splice(value, start, end, insert, urlStart, urlStart + "https://".length);
  }

  if (format === "codeBlock") {
    const body = selected || "code";
    return splice(value, start, end, `\`\`\`\n${body}\n\`\`\``, 4, 4 + body.length);
  }

  // table
  const lead = start > 0 && value[start - 1] !== "\n" ? "\n\n" : "";
  const insert = lead + TABLE_TEMPLATE;
  return splice(value, start, end, insert, insert.length, insert.length);
}

/** 1-based line and column of `offset` in `value` (the editor's status bar). */
export function cursorPosition(value: string, offset: number): { line: number; column: number } {
  const before = value.slice(0, offset);
  const line = before.split("\n").length;
  const column = offset - (before.lastIndexOf("\n") + 1) + 1;
  return { line, column };
}

/** Words of the source, markdown punctuation left out (the editor's status bar). */
export function countWords(value: string): number {
  return value
    .replace(/[#*_~`>[\]()|-]/g, " ")
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}
