import { describe, expect, it } from "vitest";
import { ENTITY_TYPE_VALUES } from "@/lib/validators/enums";
import { entityHref } from "./entity-routes";

describe("entityHref", () => {
  it.each([
    ["CLIENT", "/clients/cli_1"],
    ["PROJECT", "/projects/prj_1"],
    ["INVOICE", "/invoices/inv_1"],
    ["PAYMENT", "/payments/pay_1"],
    ["EXPENSE", "/expenses/exp_1"],
    ["RECURRING_EXPENSE", "/expenses/recurring/rex_1"],
    ["ACCOUNT", "/accounts/acc_1"],
    ["DOCUMENT", "/documents/doc_1"],
    ["NOTE", "/notes/not_1"],
    ["SHARE_LINK", "/documents/shares/shl_1"],
  ] as const)("routes %s to its PRD §11 detail page", (type, href) => {
    expect(entityHref({ type, id: href.split("/").pop() ?? "" })).toBe(href);
  });

  it.each([
    "CONTACT",
    "TRANSFER",
    "ACCOUNT_MOVEMENT",
    "FILE",
    "BILLING_PLAN",
    "INSTALLMENT",
    "RECURRING_CHARGE",
    "TAG",
    "SETTING",
    "USER",
  ] as const)("returns null for %s, which has no route of its own", (type) => {
    expect(entityHref({ type, id: "x_1" })).toBeNull();
  });

  it("covers every EntityType exactly once", () => {
    const routed = ENTITY_TYPE_VALUES.filter((type) => entityHref({ type, id: "x" }) !== null);
    expect(routed).toHaveLength(10);
    expect(
      ENTITY_TYPE_VALUES.filter((type) => entityHref({ type, id: "x" }) === null),
    ).toHaveLength(ENTITY_TYPE_VALUES.length - 10);
  });

  it("encodes the id so it stays one path segment", () => {
    expect(entityHref({ type: "CLIENT", id: "a/b c" })).toBe("/clients/a%2Fb%20c");
  });
});
