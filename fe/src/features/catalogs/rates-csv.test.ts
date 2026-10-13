import { describe, expect, it } from "vitest";
import { MAX_RATE_CSV_ROWS } from "@/lib/validators/catalogs";
import { mergeImportErrors, parseRatesCsv } from "./rates-csv";

describe("parseRatesCsv", () => {
  it("reads the header columns, a BOM, CRLF, quotes and a blank source as MANUAL", () => {
    const text =
      '﻿date,currency,usdRate,source\r\n2026-10-12,ves,"757.50",BCV\r\n2026-10-12,EUR,0.86,\r\n\r\n';
    expect(parseRatesCsv(text)).toEqual({
      status: "ok",
      rows: [
        { date: "2026-10-12", currency: "VES", usdRate: "757.50", source: "BCV" },
        { date: "2026-10-12", currency: "EUR", usdRate: "0.86", source: "MANUAL" },
      ],
      lines: [1, 2],
      errors: [],
    });
  });

  it("accepts the columns in any order and without the optional source", () => {
    expect(parseRatesCsv("currency,usdRate,date\nCOP,4012.5,2026-10-12\n")).toMatchObject({
      status: "ok",
      rows: [{ date: "2026-10-12", currency: "COP", usdRate: "4012.5", source: "MANUAL" }],
    });
  });

  it("reports invalid rows by their 1-based data row and keeps the valid ones", () => {
    const result = parseRatesCsv(
      "date,currency,usdRate\n2026-13-40,VES,1\n2026-10-12,USD,1\n2026-10-12,VES,abc\n2026-10-12,VES,760\n",
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.rows).toEqual([
      { date: "2026-10-12", currency: "VES", usdRate: "760", source: "MANUAL" },
    ]);
    expect(result.lines).toEqual([4]);
    expect(result.errors.map((error) => error.row)).toEqual([1, 2, 3]);
    expect(result.errors[1]!.messages).toEqual(["catalogs.validation.rateCurrencyIsUsd"]);
  });

  it("refuses a file without the required header or without data", () => {
    expect(parseRatesCsv("fecha,moneda,tasa\n2026-10-12,VES,1\n")).toEqual({
      status: "invalidHeader",
    });
    expect(parseRatesCsv("date,currency,usdRate\n")).toEqual({ status: "empty" });
    expect(parseRatesCsv("")).toEqual({ status: "empty" });
  });

  it("refuses a file over the row limit", () => {
    const body = Array.from({ length: MAX_RATE_CSV_ROWS + 1 }, () => "2026-10-12,VES,1").join("\n");
    expect(parseRatesCsv(`date,currency,usdRate\n${body}`)).toEqual({ status: "tooManyRows" });
  });
});

describe("mergeImportErrors", () => {
  it("maps service errors back to CSV rows and sorts them with the parse errors", () => {
    expect(
      mergeImportErrors(
        [{ row: 2, messages: ["a"] }],
        [5, 7, 9],
        [{ row: 2, messages: ["catalogs.rates.errors.unknownCurrency"] }],
      ),
    ).toEqual([
      { row: 2, messages: ["a"] },
      { row: 7, messages: ["catalogs.rates.errors.unknownCurrency"] },
    ]);
  });
});
