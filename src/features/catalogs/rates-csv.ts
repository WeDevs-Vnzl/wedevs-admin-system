import {
  MAX_RATE_CSV_ROWS,
  RATE_CSV_COLUMNS,
  rateCsvRowSchema,
  type ImportRatesCsvResult,
  type RateCsvRow,
} from "@/lib/validators/catalogs";

type RowError = ImportRatesCsvResult["errors"][number];

export type ParsedRatesCsv =
  | {
      status: "ok";
      /** Valid rows, ready for `importRatesCsvAction`. */
      rows: RateCsvRow[];
      /** 1-based CSV data row (header excluded) of each valid row, in the same order. */
      lines: number[];
      /** Rows that failed validation, with i18n message keys. */
      errors: RowError[];
    }
  | { status: "empty" | "invalidHeader" | "tooManyRows" };

/** RFC 4180 records of `text`: quoted fields may hold commas, doubled quotes and line breaks. */
function readRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  // Blank lines carry no data.
  return records.filter((row) => row.some((cell) => cell.trim() !== ""));
}

const REQUIRED_COLUMNS = ["date", "currency", "usdRate"] as const;

/**
 * Parses a rates CSV (PRD §8.15 import): a header with `date`, `currency`, `usdRate` and an optional `source`
 * (`RATE_CSV_COLUMNS`, any order, case-insensitive), then one rate per row. Every row is validated with the
 * shared `rateCsvRowSchema`; invalid rows are reported by their 1-based data row and left out.
 */
export function parseRatesCsv(text: string): ParsedRatesCsv {
  const records = readRecords(text.replace(/^﻿/, ""));
  const [header, ...data] = records;
  if (!header) return { status: "empty" };

  const names = header.map((cell) => cell.trim().toLowerCase());
  const indexOf = Object.fromEntries(
    RATE_CSV_COLUMNS.map((column) => [column, names.indexOf(column.toLowerCase())]),
  ) as Record<(typeof RATE_CSV_COLUMNS)[number], number>;
  if (REQUIRED_COLUMNS.some((column) => indexOf[column] < 0)) return { status: "invalidHeader" };
  if (data.length === 0) return { status: "empty" };
  if (data.length > MAX_RATE_CSV_ROWS) return { status: "tooManyRows" };

  const rows: RateCsvRow[] = [];
  const lines: number[] = [];
  const errors: RowError[] = [];
  data.forEach((record, index) => {
    const cell = (column: (typeof RATE_CSV_COLUMNS)[number]) => {
      const position = indexOf[column];
      return position < 0 ? undefined : record[position]?.trim();
    };
    const source = cell("source");
    const parsed = rateCsvRowSchema.safeParse({
      date: cell("date") ?? "",
      currency: cell("currency") ?? "",
      usdRate: cell("usdRate") ?? "",
      source: source ? source.toUpperCase() : undefined,
    });
    if (parsed.success) {
      rows.push(parsed.data);
      lines.push(index + 1);
    } else {
      errors.push({
        row: index + 1,
        messages: [...new Set(parsed.error.issues.map((issue) => issue.message))],
      });
    }
  });
  return { status: "ok", rows, lines, errors };
}

/**
 * The import errors as CSV rows: the service reports positions in the rows it got (`lines` maps them back),
 * merged with the parse errors and sorted by row.
 */
export function mergeImportErrors(
  parseErrors: readonly RowError[],
  lines: readonly number[],
  serviceErrors: readonly RowError[],
): RowError[] {
  const mapped = serviceErrors.flatMap((error) => {
    const row = lines[error.row - 1];
    return row === undefined ? [] : [{ row, messages: error.messages }];
  });
  return [...parseErrors, ...mapped].sort((a, b) => a.row - b.row);
}
