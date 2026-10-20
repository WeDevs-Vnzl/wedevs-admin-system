import type { DateOnly } from "@/lib/dates";
import { addMoney, isZeroMoney, roundMoney, subMoney, type MoneyString } from "@/lib/money";
import type { AccountMovementType, ExpenseStatus, PaymentStatus } from "@/lib/validators/enums";

export type AccountActivity = {
  openingBalance: MoneyString;
  payments: readonly { date: DateOnly; netCredited: MoneyString; status: PaymentStatus }[];
  /** `accountAmount` is the debit in the account currency when the expense currency differs. */
  expenses: readonly {
    date: DateOnly;
    amount: MoneyString;
    accountAmount: MoneyString | null;
    status: ExpenseStatus;
  }[];
  transfersIn: readonly { date: DateOnly; amountTo: MoneyString }[];
  transfersOut: readonly { date: DateOnly; amountFrom: MoneyString; feeAmount: MoneyString }[];
  /** `AJUSTE` amounts carry their sign; contributions and withdrawals are positive. */
  movements: readonly { date: DateOnly; type: AccountMovementType; amount: MoneyString }[];
};

export type LedgerKind = "PAYMENT" | "EXPENSE" | "TRANSFER_IN" | "TRANSFER_OUT" | "MOVEMENT";

export type LedgerEntry = {
  date: DateOnly;
  kind: LedgerKind;
  delta: MoneyString;
  balance: MoneyString;
};

function negate(value: MoneyString): MoneyString {
  return subMoney("0", value);
}

/** Every entry that changes the balance, with its signed delta, in input order (§9.7). */
function deltas(activity: AccountActivity): Omit<LedgerEntry, "balance">[] {
  return [
    ...activity.payments
      .filter((payment) => payment.status === "CONFIRMADO")
      .map((payment) => ({
        date: payment.date,
        kind: "PAYMENT" as const,
        delta: roundMoney(payment.netCredited),
      })),
    ...activity.expenses
      .filter((expense) => expense.status === "PAGADO")
      .map((expense) => ({
        date: expense.date,
        kind: "EXPENSE" as const,
        delta: negate(expense.accountAmount ?? expense.amount),
      })),
    ...activity.transfersIn.map((transfer) => ({
      date: transfer.date,
      kind: "TRANSFER_IN" as const,
      delta: roundMoney(transfer.amountTo),
    })),
    ...activity.transfersOut.map((transfer) => ({
      date: transfer.date,
      kind: "TRANSFER_OUT" as const,
      delta: negate(addMoney(transfer.amountFrom, transfer.feeAmount)),
    })),
    ...activity.movements.map((movement) => ({
      date: movement.date,
      kind: "MOVEMENT" as const,
      delta:
        movement.type === "RETIRO_SOCIO" ? negate(movement.amount) : roundMoney(movement.amount),
    })),
  ];
}

/** Account ledger up to `until`, in date order, each entry with its running balance (HU-15 CA2). */
export function accountLedger(activity: AccountActivity, until: DateOnly): LedgerEntry[] {
  let balance = roundMoney(activity.openingBalance);
  return deltas(activity)
    .filter((entry) => entry.date <= until)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((entry) => {
      balance = addMoney(balance, entry.delta);
      return { ...entry, balance };
    });
}

/** Account balance at the end of `until` (§9.7, HU-15 CA1). */
export function accountBalance(activity: AccountActivity, until: DateOnly): MoneyString {
  return accountLedger(activity, until).at(-1)?.balance ?? roundMoney(activity.openingBalance);
}

/** The `AJUSTE` a reconciliation suggests (counted − computed), or `null` when they match (HU-15 CA3). */
export function reconciliationAdjustment(
  computedBalance: MoneyString,
  countedBalance: MoneyString,
): MoneyString | null {
  const difference = subMoney(countedBalance, computedBalance);
  return isZeroMoney(difference) ? null : difference;
}

/** HU-16 CA2: an account cannot transfer to itself. */
export function transferProblem(fromAccountId: string, toAccountId: string): "sameAccount" | null {
  return fromAccountId === toAccountId ? "sameAccount" : null;
}
