import { describe, expect, it } from "vitest";
import { CSV_BOM, CSV_EOL, guardFormula, quoteCsvField, toCsv, type CsvColumn } from "./csv";

const cols: CsvColumn[] = [
  { key: "name", header: "Name" },
  { key: "amount", header: "Amount", type: "money" },
];

const body = (csv: string) => csv.slice(CSV_BOM.length);

describe("toCsv layout", () => {
  it("starts with a UTF-8 BOM, uses CRLF and ends with a line break", () => {
    const csv = toCsv([{ name: "Acme", amount: "10.50" }], cols);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(body(csv)).toBe("Name,Amount\r\nAcme,10.50\r\n");
    expect(csv.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
  });

  it("can omit the BOM", () => {
    expect(toCsv([], cols, { bom: false })).toBe("Name,Amount\r\n");
  });

  it("writes only the header when there are no rows", () => {
    expect(body(toCsv([], cols))).toBe(`Name,Amount${CSV_EOL}`);
  });

  it("writes cells in column order, ignoring other row properties", () => {
    const csv = toCsv([{ amount: "1", extra: "x", name: "A" }], cols);
    expect(body(csv)).toBe("Name,Amount\r\nA,1\r\n");
  });

  it("reads dotted paths and leaves missing values empty", () => {
    const columns: CsvColumn[] = [
      { key: "client.label", header: "Client" },
      { key: "client.code", header: "Code" },
      { key: "gone.deep", header: "Gone" },
      { key: "flat", header: "Flat" },
    ];
    const csv = toCsv([{ client: { label: "Acme" }, flat: null }, { client: null }], columns);
    expect(body(csv)).toBe("Client,Code,Gone,Flat\r\nAcme,,,\r\n,,,\r\n");
  });
});

describe("RFC 4180 quoting", () => {
  it("quotes commas, quotes, CR and LF and doubles inner quotes", () => {
    expect(quoteCsvField("plain")).toBe("plain");
    expect(quoteCsvField("a,b")).toBe('"a,b"');
    expect(quoteCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(quoteCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(quoteCsvField("a\r\nb")).toBe('"a\r\nb"');
    expect(quoteCsvField("")).toBe("");
  });

  it("applies quoting to headers and cells", () => {
    const csv = toCsv([{ name: 'Acme, "Inc"\nSA' }], [{ key: "name", header: "Name, full" }]);
    expect(body(csv)).toBe('"Name, full"\r\n"Acme, ""Inc""\nSA"\r\n');
  });

  it("keeps accents and non-Latin text as is", () => {
    expect(body(toCsv([{ name: "Andrés Peña — ñ ✓" }], [cols[0]!]))).toBe(
      "Name\r\nAndrés Peña — ñ ✓\r\n",
    );
  });
});

describe("formula-injection guard", () => {
  it.each(["=SUM(A1)", "+1+1", "-2+3", "@cmd", "\tTAB", "\rCR"])("prefixes %j", (cell) => {
    expect(guardFormula(cell)).toBe(`'${cell}`);
  });

  it.each(["safe", "a=b", "1+1", " =lead", "", "'quoted"])("leaves %j alone", (cell) => {
    expect(guardFormula(cell)).toBe(cell);
  });

  it("guards text cells and headers, quoting the result when needed", () => {
    const csv = toCsv(
      [{ name: '=HYPERLINK("http://x","y")' }, { name: "\rfoo" }],
      [{ key: "name", header: "-Name" }],
    );
    expect(body(csv)).toBe('\'-Name\r\n"\'=HYPERLINK(""http://x"",""y"")"\r\n"\'\rfoo"\r\n');
  });
});

describe("cell types", () => {
  it("writes numbers, booleans and dates as text", () => {
    const columns: CsvColumn[] = [
      { key: "count", header: "Count" },
      { key: "negative", header: "Negative" },
      { key: "flag", header: "Flag" },
      { key: "off", header: "Off" },
      { key: "at", header: "At" },
    ];
    const csv = toCsv(
      [{ count: 3, negative: -5, flag: true, off: false, at: new Date("2026-10-09T10:00:00Z") }],
      columns,
    );
    expect(body(csv)).toBe(
      "Count,Negative,Flag,Off,At\r\n3,-5,true,false,2026-10-09T10:00:00.000Z\r\n",
    );
  });

  it("rejects non-finite numbers and unsupported values", () => {
    expect(() => toCsv([{ name: Number.NaN }], [cols[0]!])).toThrow(RangeError);
    expect(() => toCsv([{ name: Infinity }], [cols[0]!])).toThrow(RangeError);
    expect(() => toCsv([{ name: { a: 1 } }], [cols[0]!])).toThrow(TypeError);
    expect(() => toCsv([{ name: ["a"] }], [cols[0]!])).toThrow(TypeError);
  });
});

describe("money columns", () => {
  it("writes decimal strings verbatim, negatives included, without the guard", () => {
    const csv = toCsv(
      [{ amount: "-1234.50" }, { amount: "0.1000" }, { amount: "100" }, { amount: ".5" }],
      [{ key: "amount", header: "Amount", type: "money" }],
    );
    expect(body(csv)).toBe("Amount\r\n-1234.50\r\n0.1000\r\n100\r\n.5\r\n");
  });

  it("writes an empty cell for a missing amount", () => {
    const money: CsvColumn = { key: "amount", header: "Amount", type: "money" };
    expect(body(toCsv([{ amount: null }, {}, { amount: "" }], [money]))).toBe(
      "Amount\r\n\r\n\r\n\r\n",
    );
  });

  it("refuses anything that is not a decimal string (C15)", () => {
    const money: CsvColumn = { key: "amount", header: "Amount", type: "money" };
    for (const amount of [12.5, "1,234.50", "1e3", "=1+1", "abc", true, {}]) {
      expect(() => toCsv([{ amount }], [money]), String(amount)).toThrow(TypeError);
    }
  });
});

describe("columns", () => {
  it("needs at least one column", () => {
    expect(() => toCsv([], [])).toThrow(RangeError);
  });

  it("rejects repeated keys", () => {
    expect(() =>
      toCsv(
        [],
        [
          { key: "a", header: "A" },
          { key: "a", header: "Again" },
        ],
      ),
    ).toThrow(RangeError);
  });
});
