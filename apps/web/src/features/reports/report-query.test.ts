import { describe, expect, it } from "vitest";
import { reportFilterSchema } from "@/lib/validators/reports";
import { toReportQuery } from "./report-query";

describe("toReportQuery", () => {
  it("sends a preset alone, without dates", () => {
    expect(toReportQuery(reportFilterSchema.parse({ preset: "QUARTER" }))).toEqual({
      preset: "QUARTER",
    });
  });

  it("sends the dates of a custom range as from and to", () => {
    expect(
      toReportQuery(
        reportFilterSchema.parse({
          preset: "CUSTOM",
          dateFrom: "2026-01-01",
          dateTo: "2026-03-31",
        }),
      ),
    ).toEqual({ preset: "CUSTOM", from: "2026-01-01", to: "2026-03-31" });
  });

  it("sends the client, project and tag filters only when they are set", () => {
    expect(
      toReportQuery(
        reportFilterSchema.parse({ preset: "YEAR", clientId: "cli_1", tagId: "tag_9" }),
      ),
    ).toEqual({ preset: "YEAR", clientId: "cli_1", tagId: "tag_9" });
  });
});
