import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en/expenses.json";
import es from "@/i18n/messages/es/expenses.json";
import { VALIDATION_MESSAGES } from "./common";
import { BILLING_MESSAGES } from "./billing";
import { CATALOG_MESSAGES } from "./catalogs";
import {
  DEFAULT_RECURRING_EXPENSE_LEAD_DAYS,
  EXPENSE_MESSAGES,
  createExpenseInputSchema,
  createExpenseInputSchemaFor,
  createRecurringExpenseInputSchema,
  expenseDetailDtoSchema,
  EXPENSE_SORT_FIELDS,
  RECURRING_EXPENSE_SORT_FIELDS,
  expenseFiltersSchema,
  expenseListRowSchema,
  expensesOverviewDtoSchema,
  markExpensePaidInputSchema,
  markExpensePaidInputSchemaFor,
  recurringExpenseDtoSchema,
  recurringExpenseFiltersSchema,
  setRecurringExpenseStatusInputSchema,
  updateExpenseInputSchema,
  updateRecurringExpenseInputSchema,
  voidExpenseInputSchema,
} from "./expenses";

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

const ref = (id: string, type: "ACCOUNT" | "PROJECT" | "EXPENSE" | "RECURRING_EXPENSE") => ({
  id,
  label: id,
  type,
});

describe("expense message keys", () => {
  it("exist in the expenses namespace for es and en", () => {
    for (const key of Object.values(EXPENSE_MESSAGES)) {
      const [, ...path] = key.split(".");
      expect(hasKey(es, path), `es ${key}`).toBe(true);
      expect(hasKey(en, path), `en ${key}`).toBe(true);
    }
  });
});

const expense = {
  date: "2026-10-09",
  description: "Hosting octubre",
  categoryId: "cat1",
  accountId: "acc1",
  currency: "USD",
  amount: "20.00",
  usdRate: "1",
};

describe("createExpense input", () => {
  it("accepts a paid expense and defaults the status to PAGADO", () => {
    expect(createExpenseInputSchema.parse(expense).status).toBe("PAGADO");
  });

  it("a paid expense needs a payment account; a pending one does not", () => {
    const { accountId, ...withoutAccount } = expense;
    void accountId;
    expect(messages(createExpenseInputSchema.safeParse(withoutAccount))).toContain(
      EXPENSE_MESSAGES.accountRequiredForPaid,
    );
    expect(
      createExpenseInputSchema.safeParse({
        ...withoutAccount,
        status: "PENDIENTE",
        dueDate: "2026-10-20",
      }).success,
    ).toBe(true);
  });

  it("only creates pending or paid expenses", () => {
    expect(createExpenseInputSchema.safeParse({ ...expense, status: "ANULADO" }).success).toBe(
      false,
    );
  });

  it("money fields reject numbers and more than 2 decimals; rates are > 0", () => {
    expect(createExpenseInputSchema.safeParse({ ...expense, amount: 20 }).success).toBe(false);
    expect(
      messages(createExpenseInputSchema.safeParse({ ...expense, amount: "20.123" })),
    ).toContain(VALIDATION_MESSAGES.moneyTooManyDecimals);
    expect(createExpenseInputSchema.safeParse({ ...expense, amount: "0" }).success).toBe(false);
    expect(createExpenseInputSchema.safeParse({ ...expense, usdRate: "0" }).success).toBe(false);
    expect(createExpenseInputSchema.safeParse({ ...expense, accountAmount: "1.999" }).success).toBe(
      false,
    );
  });

  it("USD expenses use rate 1", () => {
    expect(messages(createExpenseInputSchema.safeParse({ ...expense, usdRate: "36" }))).toContain(
      CATALOG_MESSAGES.usdRateMustBeOne,
    );
  });

  it("due date cannot precede the expense date", () => {
    expect(
      messages(createExpenseInputSchema.safeParse({ ...expense, dueDate: "2026-10-01" })),
    ).toContain(EXPENSE_MESSAGES.dueBeforeDate);
  });

  it("accountAmount is required when the account currency differs (§9.7)", () => {
    const schema = createExpenseInputSchemaFor({ accountCurrency: "VES" });
    expect(messages(schema.safeParse(expense))).toContain(EXPENSE_MESSAGES.accountAmountRequired);
    expect(schema.safeParse({ ...expense, accountAmount: "730.80" }).success).toBe(true);
    // same currency: not required
    expect(createExpenseInputSchemaFor({ accountCurrency: "USD" }).safeParse(expense).success).toBe(
      true,
    );
    // a pending expense has no account debit yet
    expect(
      schema.safeParse({ ...expense, status: "PENDIENTE", accountId: undefined }).success,
    ).toBe(true);
  });

  it("update takes the id", () => {
    expect(updateExpenseInputSchema.safeParse({ ...expense, id: "exp1" }).success).toBe(true);
    expect(updateExpenseInputSchema.safeParse(expense).success).toBe(false);
  });
});

describe("markExpensePaid input", () => {
  const paid = {
    id: "exp1",
    accountId: "acc1",
    paidAt: "2026-10-10",
    currency: "USD",
    amount: "21.50",
    usdRate: "1",
  };

  it("adjusts the real amount, rate and receipt", () => {
    expect(markExpensePaidInputSchema.safeParse({ ...paid, receiptFileId: "f1" }).success).toBe(
      true,
    );
  });

  it("requires the account and a paid date", () => {
    const { accountId, ...withoutAccount } = paid;
    void accountId;
    expect(markExpensePaidInputSchema.safeParse(withoutAccount).success).toBe(false);
    expect(markExpensePaidInputSchema.safeParse({ ...paid, paidAt: "2026-13-01" }).success).toBe(
      false,
    );
  });

  it("accountAmount follows the account currency", () => {
    const schema = markExpensePaidInputSchemaFor({ accountCurrency: "VES" });
    expect(messages(schema.safeParse(paid))).toContain(EXPENSE_MESSAGES.accountAmountRequired);
    expect(schema.safeParse({ ...paid, accountAmount: "785.61" }).success).toBe(true);
    expect(markExpensePaidInputSchema.safeParse({ ...paid, amount: 21.5 }).success).toBe(false);
  });

  it("void takes an optional reason", () => {
    expect(voidExpenseInputSchema.safeParse({ id: "exp1" }).success).toBe(true);
    expect(voidExpenseInputSchema.safeParse({ id: "exp1", reason: "Duplicado" }).success).toBe(
      true,
    );
  });
});

describe("recurring expenses", () => {
  const recurring = {
    name: "Neon",
    categoryId: "cat1",
    currency: "USD",
    amount: "19.00",
    frequency: "MENSUAL",
    dayOfPeriod: 5,
    startDate: "2026-11-01",
  };

  it("accepts a recurring expense and defaults the lead days to 5", () => {
    const parsed = createRecurringExpenseInputSchema.parse(recurring);
    expect(parsed.leadDays).toBe(DEFAULT_RECURRING_EXPENSE_LEAD_DAYS);
    expect(parsed.leadDays).toBe(5);
  });

  it("day of period must be 1–28", () => {
    for (const dayOfPeriod of [1, 28]) {
      expect(
        createRecurringExpenseInputSchema.safeParse({ ...recurring, dayOfPeriod }).success,
        String(dayOfPeriod),
      ).toBe(true);
    }
    for (const dayOfPeriod of [0, 29, 31, 2.5]) {
      expect(
        createRecurringExpenseInputSchema.safeParse({ ...recurring, dayOfPeriod }).success,
        String(dayOfPeriod),
      ).toBe(false);
    }
  });

  it("rejects an end before the start, bad amounts and unknown frequency", () => {
    expect(
      messages(
        createRecurringExpenseInputSchema.safeParse({ ...recurring, endDate: "2026-10-01" }),
      ),
    ).toContain(BILLING_MESSAGES.endBeforeStart);
    expect(createRecurringExpenseInputSchema.safeParse({ ...recurring, amount: 19 }).success).toBe(
      false,
    );
    expect(
      createRecurringExpenseInputSchema.safeParse({ ...recurring, amount: "19.001" }).success,
    ).toBe(false);
    expect(
      createRecurringExpenseInputSchema.safeParse({ ...recurring, frequency: "SEMANAL" }).success,
    ).toBe(false);
  });

  it("update, status and filters", () => {
    expect(updateRecurringExpenseInputSchema.safeParse({ ...recurring, id: "re1" }).success).toBe(
      true,
    );
    expect(
      setRecurringExpenseStatusInputSchema.safeParse({ id: "re1", status: "PAUSADO" }).success,
    ).toBe(true);
    const filters = recurringExpenseFiltersSchema.parse({
      status: "ACTIVO",
      frequency: ["MENSUAL"],
    });
    expect(filters.status).toEqual(["ACTIVO"]);
  });
});

describe("expense DTOs", () => {
  const category = {
    id: "cat2",
    name: "Hosting",
    nameEn: null,
    parent: { id: "cat1", name: "Infraestructura", nameEn: null },
  };
  const row = {
    id: "exp1",
    code: "GAS-0001",
    date: "2026-10-09",
    dueDate: null,
    description: "Hosting octubre",
    vendor: "Netlify",
    category,
    account: ref("acc1", "ACCOUNT"),
    project: null,
    currency: "USD",
    amount: "20.00",
    amountUsd: "20.00",
    status: "PAGADO",
    overdue: false,
    recurring: false,
  };

  it("list row", () => {
    expect(expenseListRowSchema.safeParse(row).success).toBe(true);
    expect(expenseListRowSchema.safeParse({ ...row, status: "ATRASADO" }).success).toBe(false);
  });

  it("detail adds accountAmount, rate and recurring origin", () => {
    const detail = {
      ...row,
      paidAt: "2026-10-09",
      accountAmount: null,
      usdRate: "1",
      receiptFileId: null,
      receipt: null,
      recurringExpense: ref("re1", "RECURRING_EXPENSE"),
      periodStart: "2026-10-01",
      createdAt: "2026-10-09T10:00:00Z",
      updatedAt: "2026-10-09T10:00:00Z",
      createdById: null,
    };
    expect(expenseDetailDtoSchema.safeParse(detail).success).toBe(true);
  });

  it("recurring DTO", () => {
    const dto = {
      id: "re1",
      name: "Neon",
      vendor: null,
      category,
      account: null,
      project: null,
      currency: "USD",
      amount: "19.00",
      frequency: "MENSUAL",
      dayOfPeriod: 5,
      leadDays: 5,
      startDate: "2026-01-01",
      endDate: null,
      status: "ACTIVO",
      lastGeneratedPeriodStart: "2026-10-05",
      nextDueDate: "2026-11-05",
      createdAt: "2026-01-01T00:00:00Z",
    };
    expect(recurringExpenseDtoSchema.safeParse(dto).success).toBe(true);
  });

  it("filters and overview", () => {
    const filters = expenseFiltersSchema.parse({ status: "PENDIENTE", recurringOnly: "true" });
    expect(filters.status).toEqual(["PENDIENTE"]);
    expect(filters.recurringOnly).toBe(true);
    const overview = {
      byMonthAndCategory: {
        periods: ["2026-09", "2026-10"],
        series: [{ id: "cat1", label: "Infraestructura", values: ["10.00", "20.00"] }],
      },
      byCategory: [{ key: "cat1", label: "Infraestructura", value: "30.00" }],
      committedMonthly: "120.00",
      upcoming: [row],
    };
    expect(expensesOverviewDtoSchema.safeParse(overview).success).toBe(true);
  });
});

describe("sort whitelist (m2)", () => {
  it("accepts the listed fields and rejects any other, for both lists", () => {
    expect(expenseFiltersSchema.safeParse({}).success).toBe(true);
    expect(
      expenseFiltersSchema.parse({
        categoryId: ["k1", "k2"],
        accountId: ["a1", "a2"],
        projectId: "p1",
        tagId: ["t1", "t2"],
      }),
    ).toMatchObject({
      categoryId: ["k1", "k2"],
      accountId: ["a1", "a2"],
      projectId: ["p1"],
      tagId: ["t1", "t2"],
    });
    expect(recurringExpenseFiltersSchema.parse({ categoryId: ["k1", "k2"] }).categoryId).toEqual([
      "k1",
      "k2",
    ]);
    expect(recurringExpenseFiltersSchema.safeParse({}).success).toBe(true);
    for (const field of EXPENSE_SORT_FIELDS) {
      expect(expenseFiltersSchema.safeParse({ sort: `${field}:desc` }).success, field).toBe(true);
    }
    for (const field of RECURRING_EXPENSE_SORT_FIELDS) {
      expect(
        recurringExpenseFiltersSchema.safeParse({ sort: `${field}:desc` }).success,
        field,
      ).toBe(true);
    }
    for (const schema of [expenseFiltersSchema, recurringExpenseFiltersSchema]) {
      const result = schema.safeParse({ sort: "receiptFileId:asc" });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]).toMatchObject({
        message: VALIDATION_MESSAGES.invalidSort,
        path: ["sort"],
      });
    }
  });
});
