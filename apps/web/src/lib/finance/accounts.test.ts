import { describe, expect, it } from "vitest";

import {
  accountBalance,
  accountLedger,
  reconciliationAdjustment,
  transferProblem,
  type AccountActivity,
} from "./accounts";

const empty: AccountActivity = {
  openingBalance: "0",
  payments: [],
  expenses: [],
  transfersIn: [],
  transfersOut: [],
  movements: [],
};

describe("accountBalance (HU-15 CA1, §9.7)", () => {
  const activity: AccountActivity = {
    openingBalance: "1000",
    payments: [
      { date: "2026-10-01", netCredited: "500", status: "CONFIRMADO" },
      { date: "2026-10-02", netCredited: "999", status: "PENDIENTE_VERIFICACION" },
      { date: "2026-10-20", netCredited: "300", status: "CONFIRMADO" },
    ],
    expenses: [
      { date: "2026-10-03", amount: "50", accountAmount: null, status: "PAGADO" },
      { date: "2026-10-04", amount: "10", accountAmount: "400", status: "PAGADO" },
      { date: "2026-10-05", amount: "70", accountAmount: null, status: "PENDIENTE" },
    ],
    transfersIn: [{ date: "2026-10-06", amountTo: "99" }],
    transfersOut: [{ date: "2026-10-07", amountFrom: "100", feeAmount: "1" }],
    movements: [
      { date: "2026-10-08", type: "APORTE_CAPITAL", amount: "200" },
      { date: "2026-10-09", type: "RETIRO_SOCIO", amount: "150" },
      { date: "2026-10-10", type: "AJUSTE", amount: "-5" },
    ],
  };

  it("adds confirmed payments, subtracts paid expenses in account currency, transfers and movements", () => {
    // 1000 + 500 − 50 − 400 + 99 − 101 + 200 − 150 − 5
    expect(accountBalance(activity, "2026-10-13")).toBe("1093.00");
  });

  it("only counts what happened on or before the cut-off date", () => {
    expect(accountBalance(activity, "2026-10-01")).toBe("1500.00");
    expect(accountBalance(activity, "2026-10-31")).toBe("1393.00");
  });

  it("HU-16 CA1: 100 USD out of Zelle and 99 USDT into Binance", () => {
    expect(
      accountBalance(
        {
          ...empty,
          openingBalance: "100",
          transfersOut: [{ date: "2026-10-01", amountFrom: "100", feeAmount: "0" }],
        },
        "2026-10-01",
      ),
    ).toBe("0.00");
    expect(
      accountBalance(
        { ...empty, transfersIn: [{ date: "2026-10-01", amountTo: "99" }] },
        "2026-10-01",
      ),
    ).toBe("99.00");
  });
});

describe("accountLedger (HU-15 CA2)", () => {
  it("lists each movement in date order with its running balance", () => {
    const ledger = accountLedger(
      {
        ...empty,
        openingBalance: "100",
        payments: [{ date: "2026-10-02", netCredited: "50", status: "CONFIRMADO" }],
        expenses: [{ date: "2026-10-01", amount: "30", accountAmount: null, status: "PAGADO" }],
        movements: [{ date: "2026-10-03", type: "RETIRO_SOCIO", amount: "20" }],
      },
      "2026-10-31",
    );
    expect(ledger.map(({ kind, delta, balance }) => ({ kind, delta, balance }))).toEqual([
      { kind: "EXPENSE", delta: "-30.00", balance: "70.00" },
      { kind: "PAYMENT", delta: "50.00", balance: "120.00" },
      { kind: "MOVEMENT", delta: "-20.00", balance: "100.00" },
    ]);
  });
});

describe("reconciliationAdjustment (HU-15 CA3)", () => {
  it("suggests an AJUSTE for the difference between the counted and the computed balance", () => {
    expect(reconciliationAdjustment("1093.00", "1100.50")).toBe("7.50");
    expect(reconciliationAdjustment("1093.00", "1090")).toBe("-3.00");
    expect(reconciliationAdjustment("1093.00", "1093")).toBeNull();
  });
});

describe("transferProblem (HU-16 CA2)", () => {
  it("refuses a transfer from an account to itself", () => {
    expect(transferProblem("acc_zelle", "acc_zelle")).toBe("sameAccount");
    expect(transferProblem("acc_zelle", "acc_binance")).toBeNull();
  });
});
