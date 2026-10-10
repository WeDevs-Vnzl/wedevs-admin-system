import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en/accounts.json";
import es from "@/i18n/messages/es/accounts.json";
import { VALIDATION_MESSAGES } from "./common";
import {
  ACCOUNT_MESSAGES,
  LEDGER_ENTRY_KIND_VALUES,
  accountBalanceDtoSchema,
  accountDtoSchema,
  accountLedgerQuerySchema,
  accountsOverviewDtoSchema,
  createAccountInputSchema,
  createMovementInputSchema,
  createTransferInputSchema,
  ledgerRowSchema,
  maskAccountIdentifier,
  movementDtoSchema,
  reconcileAccountInputSchema,
  reconciliationDtoSchema,
  transferDtoSchema,
  updateAccountInputSchema,
} from "./accounts";

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

function hasKey(catalog: unknown, path: string[]): boolean {
  let node: unknown = catalog;
  for (const part of path) {
    if (typeof node !== "object" || node === null || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" && node.length > 0;
}

const ref = (id: string, type: "ACCOUNT" | "USER" | "PAYMENT") => ({ id, label: id, type });

describe("account message keys", () => {
  it("exist in the accounts namespace for es and en", () => {
    for (const key of Object.values(ACCOUNT_MESSAGES)) {
      const [, ...path] = key.split(".");
      expect(hasKey(es, path), `es ${key}`).toBe(true);
      expect(hasKey(en, path), `en ${key}`).toBe(true);
    }
  });
});

describe("masked identifiers (C5)", () => {
  it("keeps only the last 4 digits of a numeric account", () => {
    expect(maskAccountIdentifier("0134 5678 9012 3456 7890")).toBe("•••• 7890");
    expect(maskAccountIdentifier("0134-5678-90")).toBe("•••• 7890");
  });

  it("keeps the first and last characters of a wallet or address", () => {
    expect(maskAccountIdentifier("0x1a2b3c4d5e6f7a8b9c0d")).toBe("0x1a…9c0d");
    expect(maskAccountIdentifier("pay@acme.com")).toBe("pay@….com");
    expect(maskAccountIdentifier("abc")).toBe("a…c");
    expect(maskAccountIdentifier("ab")).toBe("••");
  });

  it("is idempotent on an already-masked value", () => {
    expect(maskAccountIdentifier("•••• 7890")).toBe("•••• 7890");
    expect(maskAccountIdentifier(maskAccountIdentifier("0x1a2b3c4d5e6f7a8b9c0d"))).toBe(
      "0x1a…9c0d",
    );
  });

  it("the parsed account input never holds the full identifier", () => {
    const full = "01345678901234567890";
    const parsed = createAccountInputSchema.parse({ ...account, identifierMasked: full });
    expect(parsed.identifierMasked).toBe("•••• 7890");
    expect(JSON.stringify(parsed)).not.toContain(full);
  });

  it("blank leaves it unset and null clears it", () => {
    expect(
      createAccountInputSchema.parse({ ...account, identifierMasked: "  " }).identifierMasked,
    ).toBeUndefined();
    expect(
      createAccountInputSchema.parse({ ...account, identifierMasked: null }).identifierMasked,
    ).toBeNull();
  });
});

const account = {
  name: "Banesco Bs",
  type: "BANCO_NACIONAL",
  currency: "VES",
  openingDate: "2026-01-01",
};

describe("account input", () => {
  it("accepts an account and defaults balance and active flag", () => {
    const parsed = createAccountInputSchema.parse(account);
    expect(parsed).toMatchObject({ openingBalance: "0", active: true });
  });

  it("accepts a negative opening balance but not numbers or 3 decimals", () => {
    expect(
      createAccountInputSchema.safeParse({ ...account, openingBalance: "-50.00" }).success,
    ).toBe(true);
    expect(createAccountInputSchema.safeParse({ ...account, openingBalance: 100 }).success).toBe(
      false,
    );
    expect(
      messages(createAccountInputSchema.safeParse({ ...account, openingBalance: "1.001" })),
    ).toContain(VALIDATION_MESSAGES.moneyTooManyDecimals);
  });

  it("rejects an unknown type and a blank name", () => {
    expect(createAccountInputSchema.safeParse({ ...account, type: "CAJA" }).success).toBe(false);
    expect(createAccountInputSchema.safeParse({ ...account, name: " " }).success).toBe(false);
  });

  it("update needs the id", () => {
    expect(updateAccountInputSchema.safeParse({ ...account, id: "acc1" }).success).toBe(true);
    expect(updateAccountInputSchema.safeParse(account).success).toBe(false);
  });

  it("DTO exposes only the masked identifier and USD balance with the latest rate", () => {
    const dto = {
      id: "acc1",
      ...account,
      institution: null,
      identifierMasked: "•••• 7890",
      holderName: null,
      openingBalance: "0.00",
      active: true,
      notes: null,
      balance: "1000.00",
      balanceUsd: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    expect(accountDtoSchema.safeParse(dto).success).toBe(true);
    expect(Object.keys(accountDtoSchema.shape)).not.toContain("identifier");
    expect(
      accountsOverviewDtoSchema.safeParse({ accounts: [dto], totalBalanceUsd: "27.36" }).success,
    ).toBe(true);
  });
});

describe("transfers", () => {
  const transfer = {
    date: "2026-10-09",
    fromAccountId: "acc1",
    toAccountId: "acc2",
    amountFrom: "100.00",
    amountTo: "3654.00",
    usdRate: "1",
  };

  it("accepts a cross-currency transfer with its rate and defaults the fee", () => {
    const parsed = createTransferInputSchema.parse({ ...transfer, rate: "36.54" });
    expect(parsed).toMatchObject({ feeAmount: "0", rate: "36.54" });
  });

  it("rejects a transfer from an account to itself", () => {
    expect(
      messages(createTransferInputSchema.safeParse({ ...transfer, toAccountId: "acc1" })),
    ).toContain(ACCOUNT_MESSAGES.sameAccount);
  });

  it("rejects numbers, non-positive and 3-decimal amounts and bad rates", () => {
    expect(createTransferInputSchema.safeParse({ ...transfer, amountFrom: 100 }).success).toBe(
      false,
    );
    expect(createTransferInputSchema.safeParse({ ...transfer, amountTo: "0" }).success).toBe(false);
    expect(createTransferInputSchema.safeParse({ ...transfer, amountFrom: "1.234" }).success).toBe(
      false,
    );
    expect(createTransferInputSchema.safeParse({ ...transfer, feeAmount: "-1" }).success).toBe(
      false,
    );
    expect(createTransferInputSchema.safeParse({ ...transfer, usdRate: "0" }).success).toBe(false);
    expect(createTransferInputSchema.safeParse({ ...transfer, rate: "0" }).success).toBe(false);
  });

  it("DTO", () => {
    const dto = {
      id: "t1",
      date: "2026-10-09",
      fromAccount: ref("acc1", "ACCOUNT"),
      toAccount: ref("acc2", "ACCOUNT"),
      amountFrom: "100.00",
      amountTo: "3654.00",
      feeAmount: "1.00",
      rate: "36.54000000",
      amountUsd: "100.00",
      reference: null,
      notes: null,
      createdAt: "2026-10-09T10:00:00Z",
    };
    expect(transferDtoSchema.safeParse(dto).success).toBe(true);
  });
});

describe("manual movements", () => {
  const movement = {
    accountId: "acc1",
    type: "APORTE_CAPITAL",
    date: "2026-10-09",
    amount: "500.00",
    usdRate: "1",
    partnerId: "u1",
    description: "Aporte inicial",
  };

  it("contributions and withdrawals take a positive amount and a partner", () => {
    expect(createMovementInputSchema.safeParse(movement).success).toBe(true);
    expect(createMovementInputSchema.safeParse({ ...movement, type: "RETIRO_SOCIO" }).success).toBe(
      true,
    );
    expect(
      messages(createMovementInputSchema.safeParse({ ...movement, amount: "-5.00" })),
    ).toContain(VALIDATION_MESSAGES.moneyMustBePositive);
    expect(
      messages(createMovementInputSchema.safeParse({ ...movement, partnerId: undefined })),
    ).toContain(ACCOUNT_MESSAGES.partnerRequired);
  });

  it("an adjustment is signed, non-zero and needs no partner", () => {
    const adjustment = { ...movement, type: "AJUSTE", partnerId: undefined };
    expect(createMovementInputSchema.safeParse({ ...adjustment, amount: "-12.34" }).success).toBe(
      true,
    );
    expect(createMovementInputSchema.safeParse({ ...adjustment, amount: "12.34" }).success).toBe(
      true,
    );
    expect(
      messages(createMovementInputSchema.safeParse({ ...adjustment, amount: "0.00" })),
    ).toContain(ACCOUNT_MESSAGES.adjustmentNonZero);
  });

  it("rejects numbers, 3 decimals, an unknown type and a blank description", () => {
    expect(createMovementInputSchema.safeParse({ ...movement, amount: 500 }).success).toBe(false);
    expect(createMovementInputSchema.safeParse({ ...movement, amount: "1.005" }).success).toBe(
      false,
    );
    expect(createMovementInputSchema.safeParse({ ...movement, type: "DEPOSITO" }).success).toBe(
      false,
    );
    expect(createMovementInputSchema.safeParse({ ...movement, description: "" }).success).toBe(
      false,
    );
  });

  it("DTO carries a signed amount", () => {
    const dto = {
      id: "mv1",
      account: ref("acc1", "ACCOUNT"),
      type: "RETIRO_SOCIO",
      date: "2026-10-09",
      amount: "-200.00",
      amountUsd: "-200.00",
      partner: ref("u1", "USER"),
      description: "Retiro",
      createdAt: "2026-10-09T10:00:00Z",
    };
    expect(movementDtoSchema.safeParse(dto).success).toBe(true);
  });
});

describe("ledger, balance and reconciliation", () => {
  it("the ledger query filters by account, date range and entry kind", () => {
    const query = accountLedgerQuerySchema.parse({
      accountId: "acc1",
      kind: "PAYMENT",
      dateFrom: "2026-10-01",
    });
    expect(query.kind).toEqual(["PAYMENT"]);
    expect(accountLedgerQuerySchema.safeParse({}).success).toBe(false);
    expect(accountLedgerQuerySchema.safeParse({ accountId: "a", kind: "OTHER" }).success).toBe(
      false,
    );
    expect([...LEDGER_ENTRY_KIND_VALUES]).toContain("TRANSFER_OUT");
  });

  it("ledger row has a signed amount and a running balance", () => {
    const row = {
      id: "e1",
      date: "2026-10-09",
      kind: "EXPENSE",
      source: null,
      description: "Hosting",
      amount: "-20.00",
      balance: "980.00",
    };
    expect(ledgerRowSchema.safeParse(row).success).toBe(true);
    expect(ledgerRowSchema.safeParse({ ...row, amount: -20 }).success).toBe(false);
  });

  it("balance DTO", () => {
    const dto = {
      accountId: "acc1",
      currency: "VES",
      at: "2026-10-09",
      balance: "1000.00",
      balanceUsd: "27.36",
    };
    expect(accountBalanceDtoSchema.safeParse(dto).success).toBe(true);
  });

  it("reconciliation records the real balance and may suggest an adjustment", () => {
    expect(
      reconcileAccountInputSchema.safeParse({
        accountId: "acc1",
        date: "2026-10-09",
        statementBalance: "995.50",
      }).success,
    ).toBe(true);
    expect(
      reconcileAccountInputSchema.safeParse({
        accountId: "acc1",
        date: "2026-10-09",
        statementBalance: 995.5,
      }).success,
    ).toBe(false);
    const dto = {
      id: "rec1",
      accountId: "acc1",
      date: "2026-10-09",
      statementBalance: "995.50",
      systemBalance: "1000.00",
      difference: "-4.50",
      suggestedAdjustment: "-4.50",
      notes: null,
      createdAt: "2026-10-09T10:00:00Z",
    };
    expect(reconciliationDtoSchema.safeParse(dto).success).toBe(true);
    expect(
      reconciliationDtoSchema.safeParse({ ...dto, difference: "0.00", suggestedAdjustment: null })
        .success,
    ).toBe(true);
  });
});
