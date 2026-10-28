// MOCK — derives every computed finance value of the store through `src/lib/finance` (C17, data-rules.md
// §2: "Derived values are computed, not typed in"). Fixtures and mock mutations store only the inputs
// (lines, rates, adjustments, allocations, movements); this pass fills totals, tax lines, balances and
// statuses. Built into the store: it runs on every build and after every mock mutation.
import { daysBetween, type DateOnly } from "@/lib/dates";
import {
  accountBalance,
  canChangeInstallmentAmount,
  computeInstallmentStatus,
  computeInvoiceBalance,
  computeInvoiceStatus,
  computeInvoiceTotals,
  computeLineAmounts,
  computePaymentAmounts,
  installmentSumMismatch,
  normalizeToMonth,
} from "@/lib/finance";
import { compareMoney, isZeroMoney, sumMoney, toUsd } from "@/lib/money";
import { selectRate } from "@/lib/rates";
import type { InvoiceDetailDTO } from "@/lib/validators/invoices";
import type { MockStore } from "./store";

function deriveInvoices(store: MockStore, today: DateOnly): void {
  const paymentsById = new Map(store.payments.map((payment) => [payment.id, payment]));
  const taxLineRows: MockStore["invoiceTaxLines"] = [];

  for (const invoice of store.invoices) {
    const totals = computeInvoiceTotals({
      lines: invoice.lines,
      taxAdjustments: invoice.taxLines
        .filter((taxLine) => !isZeroMoney(taxLine.adjustment))
        .map(({ ivaRate, adjustment }) => ({ ivaRate, adjustment })),
      ivaWithheld: invoice.totals.ivaWithheld,
      islrWithheld: invoice.totals.islrWithheld,
      otherWithheld: invoice.totals.otherWithheld,
      usdRate: invoice.usdRate,
    });

    invoice.lines = invoice.lines.map((line) => ({ ...line, ...computeLineAmounts(line) }));
    invoice.taxLines = totals.taxLines;

    const allocations = store.paymentAllocations.filter(
      (allocation) => allocation.invoice.id === invoice.id,
    );
    const { paidAmount, balance } = computeInvoiceBalance(
      totals.receivable,
      allocations.map((allocation) => ({
        amountInvoiceCurrency: allocation.amountInvoiceCurrency,
        paymentStatus: paymentsById.get(allocation.paymentId)?.status ?? "ANULADO",
        voided: false,
      })),
    );

    invoice.totals = {
      ...invoice.totals,
      subtotal: totals.subtotal,
      discount: totals.discount,
      exemptAmount: totals.exemptAmount,
      taxBase: totals.taxBase,
      ivaAmount: totals.ivaAmount,
      total: totals.total,
      receivable: totals.receivable,
      totalUsd: totals.totalUsd,
      receivableUsd: totals.receivableUsd,
      paidAmount,
      balance,
      balanceUsd: toUsd(balance, invoice.usdRate),
    };
    invoice.status = computeInvoiceStatus(
      {
        voided: invoice.voidedAt !== null,
        draft: invoice.isDraft,
        dueDate: invoice.dueDate,
        receivable: totals.receivable,
        paidAmount,
      },
      today,
    );
    invoice.daysOverdue = invoice.status === "VENCIDA" ? daysBetween(invoice.dueDate, today) : 0;
    invoice.hasPartialPayment = invoice.status !== "PAGADA" && compareMoney(paidAmount, "0") > 0;
    invoice.allocations = allocations.flatMap((allocation) => {
      const payment = paymentsById.get(allocation.paymentId);
      if (!payment || payment.status === "ANULADO") return [];
      return [
        {
          id: allocation.id,
          payment: { id: payment.id, code: payment.code, label: payment.code, type: "PAYMENT" },
          paymentDate: payment.date,
          paymentCurrency: payment.currency,
          amountPaymentCurrency: allocation.amountPaymentCurrency,
          amountInvoiceCurrency: allocation.amountInvoiceCurrency,
          amountUsd: allocation.amountUsd,
        },
      ];
    });

    for (const taxLine of totals.taxLines) {
      taxLineRows.push({
        ...taxLine,
        id: `${invoice.id}_${taxLine.ivaRate}`,
        invoiceId: invoice.id,
      });
    }
  }

  store.invoiceTaxLines = taxLineRows;
}

function derivePayments(store: MockStore): void {
  for (const payment of store.payments) {
    const allocations = store.paymentAllocations.filter(
      (allocation) => allocation.paymentId === payment.id,
    );
    const allocated = allocations.map((allocation) => allocation.amountPaymentCurrency);
    const amounts = computePaymentAmounts({
      amount: payment.amount,
      igtfAmount: payment.igtfAmount,
      feeAmount: payment.feeAmount,
      allocated,
    });
    Object.assign(payment, amounts, { allocated: sumMoney(allocated), allocations });
  }
}

function isLiveInvoice(invoice: InvoiceDetailDTO): boolean {
  return invoice.voidedAt === null && invoice.status !== "ANULADA";
}

function deriveBilling(store: MockStore): void {
  for (const installment of store.installments) {
    const referencing = store.invoices.filter((invoice) =>
      invoice.lines.some((line) => line.installment?.id === installment.id),
    );
    const liveLines = referencing
      .filter(isLiveInvoice)
      .flatMap((invoice) =>
        invoice.lines.filter((line) => line.installment?.id === installment.id),
      );

    installment.invoicedAmount = sumMoney(liveLines.map((line) => line.netAmount));
    installment.locked = !canChangeInstallmentAmount(
      referencing.map((invoice) => ({ invoiceVoided: !isLiveInvoice(invoice) })),
    );
    installment.status = computeInstallmentStatus({
      cancelled: installment.cancelledAt !== null,
      invoices: referencing.map((invoice) => ({
        status: invoice.status,
        paidAmount: invoice.totals.paidAmount,
      })),
    });
  }

  for (const plan of store.billingPlans) {
    const installments = store.installments
      .filter((installment) => installment.billingPlanId === plan.id)
      .sort((a, b) => a.order - b.order);
    const counted = installments.map((installment) => ({
      amount: installment.amount,
      kind: installment.kind,
      cancelled: installment.cancelledAt !== null,
    }));
    const difference = plan.contractAmount
      ? installmentSumMismatch(plan.contractAmount, counted)
      : null;

    plan.installments = installments;
    plan.installmentsTotal = sumMoney(
      counted
        .filter((item) => item.kind !== "AJUSTE" && !item.cancelled)
        .map((item) => item.amount),
    );
    plan.scheduleDifference = difference;
    plan.scheduleConsistent = difference === null;
  }

  for (const charge of store.recurringCharges) {
    charge.monthlyAmount = normalizeToMonth(charge.amount, charge.frequency);
  }
}

function deriveAccounts(store: MockStore, today: DateOnly): void {
  for (const account of store.accounts) {
    const balance = accountBalance(
      {
        openingBalance: account.openingBalance,
        payments: store.payments
          .filter((payment) => payment.account.id === account.id)
          .map((payment) => ({
            date: payment.date,
            netCredited: payment.netCredited,
            status: payment.status,
          })),
        expenses: store.expenses
          .filter((expense) => expense.account?.id === account.id)
          .map((expense) => ({
            date: expense.paidAt ?? expense.date,
            amount: expense.amount,
            accountAmount: expense.accountAmount,
            status: expense.status,
          })),
        transfersIn: store.transfers
          .filter((transfer) => transfer.toAccount.id === account.id)
          .map((transfer) => ({ date: transfer.date, amountTo: transfer.amountTo })),
        transfersOut: store.transfers
          .filter((transfer) => transfer.fromAccount.id === account.id)
          .map((transfer) => ({
            date: transfer.date,
            amountFrom: transfer.amountFrom,
            feeAmount: transfer.feeAmount,
          })),
        movements: store.movements
          .filter((movement) => movement.account.id === account.id)
          .map((movement) => ({
            date: movement.date,
            type: movement.type,
            amount: movement.amount,
          })),
      },
      today,
    );
    const rate = selectRate(store.exchangeRates, today, account.currency);
    account.balance = balance;
    account.balanceUsd = rate ? toUsd(balance, rate.usdRate) : account.balanceUsd;
  }
}

/** Recomputes every derived finance value of the store, in dependency order. */
export function deriveFinance(store: MockStore, today: DateOnly): void {
  derivePayments(store);
  deriveInvoices(store, today);
  deriveBilling(store);
  deriveAccounts(store, today);
}
