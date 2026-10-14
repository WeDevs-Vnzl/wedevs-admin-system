import { describe, expect, it, beforeEach } from "vitest";
import {
  createExpenseInputSchema,
  createRecurringExpenseInputSchema,
  markExpensePaidInputSchema,
  updateRecurringExpenseInputSchema,
  type CreateExpenseInput,
  type MarkExpensePaidInput,
} from "@/lib/validators/expenses";
import { mockId } from "../ids";
import { ServiceError } from "../ctx";
import { makeTestContext } from "../test-helpers";
import { getAccount } from "./accounts";
import {
  createExpense,
  createRecurringExpense,
  getExpense,
  getExpensesOverview,
  getProjectExpenseTotalUsd,
  getRecurringExpense,
  listExpenses,
  markExpensePaid,
  projectExpenseTotalUsd,
  runRecurringExpenseGeneration,
  setRecurringExpenseStatus,
  updateRecurringExpense,
  voidExpense,
} from "./expenses";

// Seed of the expense fixtures (today is 2026-10-09): two paid expenses debit the VES cash account (1800 and 450),
// so it goes from its opening 3500 to 1250; the landing expense is charged to the Kairos project (0.60 USD).
// Pending: GAS-0003 (due 10-20), GAS-0004 (due 10-05, overdue), GAS-0005 (due 10-25). One active monthly schedule
// starts on 2026-11-01, so nothing of the seed is due on 10-09.

let ctx: ReturnType<typeof makeTestContext>["ctx"];
let db: ReturnType<typeof makeTestContext>["db"];

const CATEGORY = mockId("ecat", "hosting");
const PROJECT = mockId("pry", "kairos_web");
const VES = "acc_caja_ves";
const ZELLE = "acc_zelle";
const FEE = mockId("exp", "fee_bancaria_septiembre");
const LANDING = mockId("exp", "landing_kairos");
const OVERDUE = mockId("exp", "proveedor_diseno_vencido");

beforeEach(() => {
  ({ ctx, db } = makeTestContext("OWNER"));
});

const expenseInput = (overrides: Record<string, unknown> = {}): CreateExpenseInput =>
  createExpenseInputSchema.parse({
    date: "2026-10-05",
    description: "Gasto de prueba (MOCK)",
    categoryId: CATEGORY,
    currency: "USD",
    amount: "10.00",
    usdRate: "1",
    status: "PENDIENTE",
    ...overrides,
  });

const recurringInput = (overrides: Record<string, unknown> = {}) =>
  createRecurringExpenseInputSchema.parse({
    name: "Hosting de prueba (MOCK)",
    categoryId: CATEGORY,
    currency: "USD",
    amount: "120.00",
    frequency: "MENSUAL",
    dayOfPeriod: 5,
    leadDays: 5,
    startDate: "2026-10-01",
    ...overrides,
  });

const paidInput = (overrides: Record<string, unknown> = {}): MarkExpensePaidInput =>
  markExpensePaidInputSchema.parse({
    id: mockId("exp", "hosting_produccion"),
    accountId: ZELLE,
    paidAt: "2026-10-08",
    currency: "USD",
    amount: "49.00",
    usdRate: "1",
    ...overrides,
  });

const balanceOf = async (id: string) => (await getAccount(ctx, id)).balance;

const generatedBy = (recurringId: string) =>
  db.expenses.filter((item) => item.recurringExpense?.id === recurringId);

describe("recurring generation (HU-17 CA1)", () => {
  it("generates one PENDIENTE expense per due period, with its due date and generation day", async () => {
    const schedule = await createRecurringExpense(ctx, recurringInput());

    const result = await runRecurringExpenseGeneration(ctx);

    expect(result.periodStarts).toEqual(["2026-10-05"]);
    const [generated] = generatedBy(schedule.id);
    expect(generated).toMatchObject({
      status: "PENDIENTE",
      recurring: true,
      periodStart: "2026-10-05",
      dueDate: "2026-10-05",
      date: "2026-09-30",
      amount: "120.00",
    });
    expect((await getRecurringExpense(ctx, schedule.id)).nextDueDate).toBe("2026-11-05");
  });

  it("running the job twice the same day creates no duplicate (CA2)", async () => {
    const schedule = await createRecurringExpense(ctx, recurringInput());
    await runRecurringExpenseGeneration(ctx);
    const countAfterFirstRun = generatedBy(schedule.id).length;

    const second = await runRecurringExpenseGeneration(ctx);

    expect(second).toEqual({ created: 0, periodStarts: [] });
    expect(generatedBy(schedule.id)).toHaveLength(countAfterFirstRun);
  });

  it("catches up every due period, as the billing charges do", async () => {
    const schedule = await createRecurringExpense(ctx, recurringInput({ startDate: "2026-07-01" }));

    const result = await runRecurringExpenseGeneration(ctx);

    expect(result.periodStarts).toEqual(["2026-07-05", "2026-08-05", "2026-09-05", "2026-10-05"]);
    expect(generatedBy(schedule.id)).toHaveLength(4);
  });

  it("a paused schedule generates nothing", async () => {
    const schedule = await createRecurringExpense(ctx, recurringInput({ startDate: "2026-07-01" }));
    await setRecurringExpenseStatus(ctx, { id: schedule.id, status: "PAUSADO" });

    const result = await runRecurringExpenseGeneration(ctx);

    expect(result).toEqual({ created: 0, periodStarts: [] });
    expect(generatedBy(schedule.id)).toHaveLength(0);
  });

  it("changing the amount affects only the periods not generated yet", async () => {
    const schedule = await createRecurringExpense(ctx, recurringInput());
    await runRecurringExpenseGeneration(ctx);

    await updateRecurringExpense(
      ctx,
      updateRecurringExpenseInputSchema.parse({
        id: schedule.id,
        name: schedule.name,
        categoryId: CATEGORY,
        currency: "USD",
        amount: "200.00",
        frequency: "MENSUAL",
        dayOfPeriod: 5,
        leadDays: 5,
        startDate: "2026-10-01",
      }),
    );

    expect(generatedBy(schedule.id)[0]?.amount).toBe("120.00");
  });
});

describe("marking an expense as paid (HU-17 CA2)", () => {
  it("requires the payment account", () => {
    const withoutAccount = { ...paidInput(), accountId: undefined };
    expect(markExpensePaidInputSchema.safeParse(withoutAccount).success).toBe(false);
  });

  it("refuses an account that does not exist or is inactive", async () => {
    await expect(
      markExpensePaid(ctx, paidInput({ accountId: "acc_missing" })),
    ).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { accountId: expect.any(Array) } });
  });

  it("lets the user adjust the real amount and the rate; the USD snapshot follows them", async () => {
    const pending = await createExpense(
      ctx,
      expenseInput({ currency: "VES", amount: "1000.00", usdRate: "755.16" }),
    );
    expect(pending.amountUsd).toBe("1.32");

    const paid = await markExpensePaid(
      ctx,
      paidInput({
        id: pending.id,
        accountId: VES,
        currency: "VES",
        amount: "1100.00",
        usdRate: "800.00",
      }),
    );

    expect(paid).toMatchObject({ status: "PAGADO", amount: "1100.00", amountUsd: "1.38" });
    expect(paid.account?.id).toBe(VES);
    expect(await balanceOf(VES)).toBe("150.00");
  });

  it("a paid expense reduces its account balance (§9.7)", async () => {
    await markExpensePaid(ctx, paidInput());

    expect(await balanceOf(ZELLE)).toBe("1151.00");
  });

  it("refuses to mark again an expense that is already paid", async () => {
    await expect(markExpensePaid(ctx, paidInput({ id: FEE }))).rejects.toMatchObject({
      code: "CONFLICT",
      message: "expenses.errors.notPending",
    });
  });

  it("a foreign-currency debit needs the amount debited in the account currency (§9.7)", async () => {
    const withoutDebit = createExpenseInputSchema.parse({
      date: "2026-10-05",
      description: "Pago en bolívares desde Zelle (MOCK)",
      categoryId: CATEGORY,
      accountId: ZELLE,
      currency: "VES",
      amount: "7551.60",
      usdRate: "755.16",
      status: "PAGADO",
    });
    await expect(createExpense(ctx, withoutDebit)).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { accountAmount: expect.any(Array) },
    });

    const created = await createExpense(ctx, { ...withoutDebit, accountAmount: "10.00" });

    expect(created).toMatchObject({ status: "PAGADO", amountUsd: "10.00", accountAmount: "10.00" });
    expect(await balanceOf(ZELLE)).toBe("1190.00");
  });
});

describe("charging an expense to a project (HU-17 CA3)", () => {
  it("a paid expense charged to a project reduces the project margin, in USD", async () => {
    expect(await getProjectExpenseTotalUsd(ctx, PROJECT)).toBe("0.60");

    await createExpense(
      ctx,
      createExpenseInputSchema.parse({
        date: "2026-10-05",
        description: "Hosting del proyecto (MOCK)",
        categoryId: CATEGORY,
        accountId: ZELLE,
        projectId: PROJECT,
        currency: "USD",
        amount: "10.00",
        usdRate: "1",
        status: "PAGADO",
      }),
    );

    expect(await getProjectExpenseTotalUsd(ctx, PROJECT)).toBe("10.60");
  });

  it("pending and voided expenses do not reduce the margin", async () => {
    await createExpense(ctx, expenseInput({ projectId: PROJECT }));
    await voidExpense(ctx, { id: LANDING, reason: undefined });

    expect(await getProjectExpenseTotalUsd(ctx, PROJECT)).toBe("0.00");
  });

  it("an unknown project is refused", () => {
    expect(() => projectExpenseTotalUsd(db, "pry_missing")).toThrow(ServiceError);
  });
});

describe("voiding and reading expenses", () => {
  it("voiding a paid expense gives its amount back to the account", async () => {
    await voidExpense(ctx, { id: FEE, reason: "Duplicado (MOCK)" });

    expect(await balanceOf(VES)).toBe("3050.00");
    expect((await getExpense(ctx, FEE)).status).toBe("ANULADO");
  });

  it("a voided expense cannot be marked as paid", async () => {
    const pending = await createExpense(ctx, expenseInput());
    await voidExpense(ctx, { id: pending.id, reason: undefined });

    await expect(markExpensePaid(ctx, paidInput({ id: pending.id }))).rejects.toMatchObject({
      code: "CONFLICT",
      message: "expenses.errors.voided",
    });
  });

  it("an overdue pending expense is flagged when read", async () => {
    expect((await getExpense(ctx, OVERDUE)).overdue).toBe(true);
  });

  it("filters the table by status and searches by vendor", async () => {
    const paid = await listExpenses(ctx, { status: "PAGADO" });
    const vendor = await listExpenses(ctx, { q: "Vercel" });

    expect(paid.items.map((row) => row.code).sort()).toEqual(["GAS-0001", "GAS-0002"]);
    expect(vendor.items.map((row) => row.code)).toEqual(["GAS-0003"]);
  });

  it("filters the table by several statuses at once", async () => {
    const page = await listExpenses(ctx, { status: ["PAGADO", "ANULADO"] });

    expect(page.items.map((row) => row.code).sort()).toEqual(["GAS-0001", "GAS-0002", "GAS-0006"]);
    expect(page.total).toBe(3);
  });

  it("filters by category, matching a leaf or its root category", async () => {
    const leaf = await listExpenses(ctx, { categoryId: [CATEGORY] });
    const landing = await getExpense(ctx, LANDING);
    const rootId = landing.category.parent?.id ?? landing.category.id;
    const root = await listExpenses(ctx, { categoryId: [rootId] });

    expect(leaf.items.map((row) => row.code)).toEqual(["GAS-0003"]);
    expect(root.items.map((row) => row.code)).toContain("GAS-0002");
    expect(
      root.items.every((row) => row.category.id === rootId || row.category.parent?.id === rootId),
    ).toBe(true);
  });

  it("filters by account, project and date range", async () => {
    const byAccount = await listExpenses(ctx, { accountId: [VES] });
    const byProject = await listExpenses(ctx, { projectId: [PROJECT] });
    const byDate = await listExpenses(ctx, { dateFrom: "2026-10-01", dateTo: "2026-10-02" });

    expect(byAccount.items.map((row) => row.code).sort()).toEqual(["GAS-0001", "GAS-0002"]);
    expect(byProject.items.map((row) => row.code)).toEqual(["GAS-0002"]);
    expect(byDate.items.map((row) => row.code).sort()).toEqual([
      "GAS-0002",
      "GAS-0003",
      "GAS-0005",
    ]);
  });

  it("searches by code and description", async () => {
    const byCode = await listExpenses(ctx, { q: "GAS-0004" });
    const byDescription = await listExpenses(ctx, { q: "dominio" });

    expect(byCode.items.map((row) => row.code)).toEqual(["GAS-0004"]);
    expect(byDescription.items.map((row) => row.code)).toEqual(["GAS-0005"]);
  });

  it("sorts by the USD amount and by the amount", async () => {
    const byUsd = await listExpenses(ctx, { sort: "amountUsd:desc" });
    const byAmount = await listExpenses(ctx, { sort: "amount:asc" });

    expect(byUsd.items[0]?.code).toBe("GAS-0004");
    expect(byAmount.items[0]?.code).toBe("GAS-0006");
  });
});

describe("overview (DT-25, §8.8)", () => {
  it("the committed monthly spend normalizes the active schedules to USD and skips paused ones", async () => {
    expect((await getExpensesOverview(ctx)).committedMonthly).toBe("20.00");

    await createRecurringExpense(ctx, recurringInput({ frequency: "ANUAL", amount: "120.00" }));

    expect((await getExpensesOverview(ctx)).committedMonthly).toBe("30.00");
  });

  it("stacks the paid spend by root category over the last six months", async () => {
    const overview = await getExpensesOverview(ctx);

    expect(overview.byMonthAndCategory.periods).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(overview.byCategory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: mockId("ecat", "comisiones_impuestos"), value: "2.38" }),
        expect.objectContaining({ key: mockId("ecat", "freelancers"), value: "0.60" }),
      ]),
    );
  });

  it("lists the upcoming pending expenses by due date, overdue first", async () => {
    const overview = await getExpensesOverview(ctx);

    expect(overview.upcoming.map((row) => row.code)).toEqual(["GAS-0004", "GAS-0003", "GAS-0005"]);
    expect(overview.upcoming[0]?.overdue).toBe(true);
  });
});
