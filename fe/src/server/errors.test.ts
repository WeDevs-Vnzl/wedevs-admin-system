import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ServiceError } from "./errors";
import { ServiceError as FromMocks } from "@/mocks/ctx";

describe("ServiceError", () => {
  it("carries the code and defaults the message to the common.errors key", () => {
    const error = new ServiceError("NOT_FOUND");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ServiceError");
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("common.errors.NOT_FOUND");
    expect(error.fieldErrors).toBeUndefined();
  });

  it("keeps a custom message key and field errors", () => {
    const error = new ServiceError("CONFLICT", {
      message: "clients.errors.duplicateTaxId",
      fieldErrors: { taxId: ["clients.errors.duplicateTaxId"] },
    });
    expect(error.message).toBe("clients.errors.duplicateTaxId");
    expect(error.fieldErrors).toEqual({ taxId: ["clients.errors.duplicateTaxId"] });
  });

  it("keeps the entity link a CONFLICT points at", () => {
    const entity = { id: "cli_1", label: "Acme", type: "CLIENT" } as const;
    expect(new ServiceError("CONFLICT", { entity }).entity).toEqual(entity);
    expect(new ServiceError("CONFLICT").entity).toBeUndefined();
  });

  it("is the same class the mock context re-exports", () => {
    expect(FromMocks).toBe(ServiceError);
  });

  it("is framework-free: no server-only, next, react or mocks import", () => {
    const source = readFileSync(new URL("./errors.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/^import [^;]* from "([^"]+)"/gm)].map((m) => m[1]);
    expect(imports).toEqual(["@/lib/validators/common"]);
    expect(source).not.toContain('"server-only"');
  });
});
