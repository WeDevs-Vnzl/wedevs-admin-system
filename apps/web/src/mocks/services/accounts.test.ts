import { describe, expect, it, beforeEach } from "vitest";
import {
  ACCOUNT_MESSAGES,
  accountFilterSchema,
  accountLedgerQuerySchema,
  createAccountInputSchema,
  createMovementInputSchema,
  createTransferInputSchema,
  reconcileAccountInputSchema,
  updateAccountInputSchema,
  type CreateTransferInput,
} from "@/lib/validators/accounts";
import { ServiceError } from "../ctx";
import { makeTestContext } from "../test-helpers";
import {
  createAccount,
  createMovement,
  createTransfer,
  getAccount,
  getAccountLedger,
  listAccounts,
  reconcileAccount,
  updateAccount,
} from "./accounts";

// Seed of the accounts fixtures (today is 2026-10-09): Zelle USD 1000 + 500 − 200 − 100 = 1200; Binance USDT
// receives 99 from the transfer of 100; the VES account 5000 − 1500 (adjustment) = 3500.

let ctx: ReturnType<typeof makeTestContext>["ctx"];
let db: ReturnType<typeof makeTestContext>["db"];

beforeEach(() => {
  ({ ctx, db } = makeTestContext("OWNER"));
});

const balanceOf = async (id: string) => (await getAccount(ctx, id)).balance;

const transferInput = (overrides: Partial<CreateTransferInput> = {}) =>
  createTransferInputSchema.parse({
    date: "2026-10-01",
    fromAccountId: "acc_zelle",
    toAccountId: "acc_binance",
    amountFrom: "100",
    amountTo: "99",
    feeAmount: "0",
    usdRate: "1",
    ...overrides,
  });

describe("account balances (HU-15 CA1, §9.7)", () => {
  it("computes each balance from its opening, contributions, withdrawals, transfers and adjustments", async () => {
    expect(await balanceOf("acc_zelle")).toBe("1200.00");
    expect(await balanceOf("acc_binance")).toBe("99.00");
    expect(await balanceOf("acc_banco_ves")).toBe("3500.00");
  });

  it("values the USDT balance in USD at 1 USDT = 1.01 USD", async () => {
    // 99 USDT ÷ 0.9901 USDT per USD = 99.99 USD.
    expect((await getAccount(ctx, "acc_binance")).balanceUsd).toBe("99.99");
  });

  it("debits the transfer fee on top of the amount sent", async () => {
    await createTransfer(ctx, transferInput({ amountFrom: "100", amountTo: "98", feeAmount: "2" }));
    expect(await balanceOf("acc_zelle")).toBe("1098.00");
  });

  it("applies the sign of a withdrawal and of a signed adjustment", async () => {
    await createMovement(
      ctx,
      createMovementInputSchema.parse({
        accountId: "acc_zelle",
        type: "RETIRO_SOCIO",
        date: "2026-10-02",
        amount: "50",
        usdRate: "1",
        partnerId: "usr_andres_molina",
        description: "Retiro de prueba",
      }),
    );
    await createMovement(
      ctx,
      createMovementInputSchema.parse({
        accountId: "acc_zelle",
        type: "AJUSTE",
        date: "2026-10-02",
        amount: "-10",
        usdRate: "1",
        description: "Ajuste de prueba",
      }),
    );
    expect(await balanceOf("acc_zelle")).toBe("1140.00");
  });
});

describe("account ledger (HU-15 CA2)", () => {
  it("lists every entry in date order with the running balance after it", async () => {
    const ledger = await getAccountLedger(
      ctx,
      accountLedgerQuerySchema.parse({ accountId: "acc_zelle", pageSize: 100 }),
    );
    expect(ledger.items.map((row) => [row.kind, row.amount, row.balance])).toEqual([
      ["OPENING_BALANCE", "1000.00", "1000.00"],
      ["APORTE_CAPITAL", "500.00", "1500.00"],
      ["RETIRO_SOCIO", "-200.00", "1300.00"],
      ["TRANSFER_OUT", "-100.00", "1200.00"],
    ]);
  });

  it("ends on the account balance and filters narrow the rows without changing their balance", async () => {
    const all = await getAccountLedger(
      ctx,
      accountLedgerQuerySchema.parse({ accountId: "acc_zelle", pageSize: 100 }),
    );
    expect(all.items.at(-1)?.balance).toBe(await balanceOf("acc_zelle"));

    const transfers = await getAccountLedger(
      ctx,
      accountLedgerQuerySchema.parse({
        accountId: "acc_zelle",
        pageSize: 100,
        kind: "TRANSFER_OUT",
      }),
    );
    expect(transfers.items).toHaveLength(1);
    expect(transfers.items[0]?.balance).toBe("1200.00");
  });
});

describe("reconciliation (HU-15 CA3)", () => {
  it("a difference suggests an AJUSTE for that amount", async () => {
    const preview = await reconcileAccount(
      ctx,
      reconcileAccountInputSchema.parse({
        accountId: "acc_zelle",
        date: "2026-10-09",
        statementBalance: "1300.00",
      }),
    );
    expect(preview).toMatchObject({
      systemBalance: "1200.00",
      difference: "100.00",
      suggestedAdjustment: "100.00",
    });
  });

  it("a matching statement suggests no adjustment", async () => {
    const preview = await reconcileAccount(
      ctx,
      reconcileAccountInputSchema.parse({
        accountId: "acc_zelle",
        date: "2026-10-09",
        statementBalance: "1200.00",
      }),
    );
    expect(preview).toMatchObject({ difference: "0.00", suggestedAdjustment: null });
  });

  it("recording the suggested AJUSTE closes the difference", async () => {
    const preview = await reconcileAccount(
      ctx,
      reconcileAccountInputSchema.parse({
        accountId: "acc_zelle",
        date: "2026-10-09",
        statementBalance: "1300.00",
      }),
    );
    await createMovement(
      ctx,
      createMovementInputSchema.parse({
        accountId: "acc_zelle",
        type: "AJUSTE",
        date: "2026-10-09",
        amount: preview.suggestedAdjustment ?? "0",
        usdRate: "1",
        description: "Ajuste por conciliación",
      }),
    );
    expect(await balanceOf("acc_zelle")).toBe("1300.00");
  });
});

describe("transfers between accounts (HU-16)", () => {
  it("moves 100 from Zelle to Binance receiving 99 USDT: the origin loses 100 and the destination gains 99", async () => {
    const zelleBefore = await balanceOf("acc_zelle");
    const binanceBefore = await balanceOf("acc_binance");

    const transfer = await createTransfer(ctx, transferInput());

    expect(transfer).toMatchObject({
      fromAccount: { id: "acc_zelle" },
      toAccount: { id: "acc_binance" },
      amountFrom: "100.00",
      amountTo: "99.00",
      amountUsd: "100.00",
    });
    expect(await balanceOf("acc_zelle")).toBe("1100.00");
    expect(await balanceOf("acc_binance")).toBe("198.00");
    expect(zelleBefore).toBe("1200.00");
    expect(binanceBefore).toBe("99.00");
  });

  it("refuses a transfer from an account to itself", async () => {
    const transfersBefore = db.transfers.length;
    const sameAccount = { ...transferInput(), toAccountId: "acc_zelle" } as CreateTransferInput;

    expect(createTransferInputSchema.safeParse(sameAccount).success).toBe(false);
    await expect(createTransfer(ctx, sameAccount)).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { toAccountId: [ACCOUNT_MESSAGES.sameAccount] },
    });
    expect(db.transfers).toHaveLength(transfersBefore);
    expect(await balanceOf("acc_zelle")).toBe("1200.00");
  });

  it("refuses a transfer into an inactive account", async () => {
    await updateAccount(
      ctx,
      updateAccountInputSchema.parse({
        id: "acc_binance",
        name: "Binance USDT",
        type: "WALLET_CRIPTO",
        institution: "Binance",
        currency: "USDT",
        identifierMasked: "",
        holderName: "",
        openingBalance: "0.00",
        openingDate: "2026-01-01",
        active: false,
        notes: "",
      }),
    );
    await expect(createTransfer(ctx, transferInput())).rejects.toBeInstanceOf(ServiceError);
    await expect(createTransfer(ctx, transferInput())).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});

describe("account records", () => {
  it("masks the identifier when the account is created, and a blank one keeps the stored value on update", async () => {
    const created = await createAccount(
      ctx,
      createAccountInputSchema.parse({
        name: "Banco de prueba",
        type: "BANCO_NACIONAL",
        currency: "VES",
        identifierMasked: "0102-0123-45-6789012345",
        openingDate: "2026-01-01",
      }),
    );
    expect(created.identifierMasked).toBe("•••• 2345");

    const updated = await updateAccount(
      ctx,
      updateAccountInputSchema.parse({
        id: "acc_zelle",
        name: "Zelle USD",
        type: "BILLETERA_DIGITAL",
        institution: "Zelle",
        currency: "USD",
        identifierMasked: "",
        holderName: "",
        openingBalance: "1000.00",
        openingDate: "2026-01-01",
        active: true,
        notes: "",
      }),
    );
    expect(updated.identifierMasked).toBe("cobr…mail");
  });

  it("locks the currency of an account that already has movements", async () => {
    await expect(
      updateAccount(
        ctx,
        updateAccountInputSchema.parse({
          id: "acc_zelle",
          name: "Zelle USD",
          type: "BILLETERA_DIGITAL",
          institution: "Zelle",
          currency: "EUR",
          identifierMasked: "",
          holderName: "",
          openingBalance: "1000.00",
          openingDate: "2026-01-01",
          active: true,
          notes: "",
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { currency: expect.any(Array) } });
  });

  it("refuses a contribution whose partner does not exist", async () => {
    await expect(
      createMovement(
        ctx,
        createMovementInputSchema.parse({
          accountId: "acc_zelle",
          type: "APORTE_CAPITAL",
          date: "2026-10-02",
          amount: "10",
          usdRate: "1",
          partnerId: "usr_no_existe",
          description: "Aporte",
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("lists active accounts only unless inactive ones are requested", async () => {
    await updateAccount(
      ctx,
      updateAccountInputSchema.parse({
        id: "acc_banco_ves",
        name: "Banco nacional VES",
        type: "BANCO_NACIONAL",
        institution: "Banco MOCK",
        currency: "VES",
        identifierMasked: "",
        holderName: "",
        openingBalance: "5000.00",
        openingDate: "2026-01-01",
        active: false,
        notes: "",
      }),
    );
    const active = await listAccounts(ctx, { pageSize: 100 });
    const everything = await listAccounts(ctx, { pageSize: 100, includeInactive: true });
    expect(active.items.map((account) => account.id)).not.toContain("acc_banco_ves");
    expect(everything.items.map((account) => account.id)).toContain("acc_banco_ves");
  });
});

describe("account list filters (S15, /accounts/list facets)", () => {
  const idsOf = async (input: Parameters<typeof listAccounts>[1]) =>
    (await listAccounts(ctx, { pageSize: 100, includeInactive: true, ...input })).items.map(
      (account) => account.id,
    );

  it("filters by account type", async () => {
    expect(await idsOf({ type: ["WALLET_CRIPTO"] })).toEqual(["acc_binance"]);
    expect((await idsOf({ type: ["BANCO_NACIONAL", "WALLET_CRIPTO"] })).sort()).toEqual([
      "acc_banco_ves",
      "acc_binance",
      "acc_caja_ves",
    ]);
  });

  it("filters by currency", async () => {
    expect((await idsOf({ currency: ["VES"] })).sort()).toEqual(["acc_banco_ves", "acc_caja_ves"]);
  });

  it("filters by active or inactive status, over includeInactive", async () => {
    db.accounts.find((account) => account.id === "acc_caja_ves")!.active = false;
    expect(await idsOf({ status: ["inactive"] })).toEqual(["acc_caja_ves"]);
    expect(await idsOf({ status: ["active"] })).not.toContain("acc_caja_ves");
    expect(await idsOf({ status: ["inactive"], includeInactive: false })).toEqual(["acc_caja_ves"]);
  });

  it("keeps the previous behavior without the new filters", async () => {
    db.accounts.find((account) => account.id === "acc_caja_ves")!.active = false;
    const page = await listAccounts(ctx, { pageSize: 100 });
    expect(page.items.map((account) => account.id)).not.toContain("acc_caja_ves");
    expect(page.total).toBe(db.accounts.length - 1);
  });

  it("sorts balances numerically", async () => {
    const page = await listAccounts(ctx, { pageSize: 100, sort: "balance:desc" });
    const balances = page.items.map((account) => Number(account.balance));
    expect(balances).toEqual([...balances].sort((a, b) => b - a));
  });

  it("parses facets as list-or-scalar and rejects unknown sort fields", () => {
    expect(accountFilterSchema.parse({ type: "EFECTIVO", currency: ["USD", "VES"] })).toMatchObject(
      { type: ["EFECTIVO"], currency: ["USD", "VES"], includeInactive: false },
    );
    expect(accountFilterSchema.safeParse({ sort: "holderName:asc" }).success).toBe(false);
    expect(accountFilterSchema.safeParse({ status: "archived" }).success).toBe(false);
  });
});
