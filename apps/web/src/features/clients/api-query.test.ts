import { describe, expect, it } from "vitest";
import { clientFilterSchema } from "@/lib/validators/clients";
import { toClientListQuery } from "./api-query";

describe("toClientListQuery", () => {
  it("maps the table filter to the flat parameters of GET /api/v1/clients", () => {
    expect(
      toClientListQuery(
        clientFilterSchema.parse({
          page: 2,
          pageSize: 50,
          sort: "tradeName:desc",
          q: "kai",
          status: ["ACTIVO", "PROSPECTO"],
          kind: "EMPRESA",
          country: "VE",
          tagId: "tag_a",
          createdFrom: "2026-01-01",
          createdTo: "2026-02-01",
          hasOverdue: true,
          includeArchived: true,
        }),
      ),
    ).toEqual({
      page: 2,
      pageSize: 50,
      archived: "include",
      sort: "tradeName:desc",
      q: "kai",
      status: ["ACTIVO", "PROSPECTO"],
      kind: ["EMPRESA"],
      country: ["VE"],
      tagId: ["tag_a"],
      createdFrom: "2026-01-01",
      createdTo: "2026-02-01",
      hasOverdue: "true",
    });
  });

  it("leaves out what the table did not set", () => {
    expect(toClientListQuery(clientFilterSchema.parse({}))).toEqual({
      page: 1,
      pageSize: 25,
      archived: "exclude",
    });
  });

  it("sends a money sort as asked: the BE refuses it for roles without the grant", () => {
    expect(
      toClientListQuery(clientFilterSchema.parse({ sort: "receivableUsd:desc" })),
    ).toMatchObject({ sort: "receivableUsd:desc" });
  });
});
