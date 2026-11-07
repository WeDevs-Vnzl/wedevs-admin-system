import type { ExpenseResponseDto, RecurringExpenseResponseDto } from "@/lib/api/types/expenses";

// Wire-shaped fixtures for the expense tests (MOCK data, never real records). They follow the BE response DTOs, so
// the tests exercise the same parsing the screens do.

const CATEGORY = {
  id: "cat_hosting",
  name: "Hosting (MOCK)",
  nameEn: "Hosting (MOCK)",
  parent: { id: "cat_infra", name: "Infraestructura", nameEn: "Infrastructure" },
};

export function makeExpense(overrides: Partial<ExpenseResponseDto> = {}): ExpenseResponseDto {
  return {
    id: "exp_1",
    code: "GAS-0001",
    date: "2026-10-05",
    dueDate: "2026-10-20",
    description: "Hosting de producción (MOCK)",
    vendor: "Proveedor (MOCK)",
    category: CATEGORY,
    account: null,
    project: null,
    currency: "USD",
    amount: "120.00",
    amountUsd: "120.00",
    accountAmount: null,
    usdRate: "1",
    status: "PENDIENTE",
    overdue: false,
    recurring: false,
    recurringExpense: null,
    paidAt: null,
    periodStart: null,
    receiptFileId: null,
    createdAt: "2026-10-05T12:00:00.000Z",
    updatedAt: "2026-10-05T12:00:00.000Z",
    createdById: "usr_owner",
    ...overrides,
  };
}

export function makeRecurringExpense(
  overrides: Partial<RecurringExpenseResponseDto> = {},
): RecurringExpenseResponseDto {
  return {
    id: "rex_1",
    name: "Dominio anual (MOCK)",
    vendor: null,
    category: CATEGORY,
    account: null,
    project: null,
    currency: "USD",
    amount: "15.00",
    usdRate: "1",
    monthlyAmountUsd: "1.25",
    frequency: "ANUAL",
    dayOfPeriod: 10,
    leadDays: 5,
    startDate: "2026-01-10",
    endDate: null,
    status: "ACTIVO",
    lastGeneratedPeriodStart: null,
    resumedOn: null,
    nextDueDate: "2027-01-10",
    createdAt: "2026-01-01T12:00:00.000Z",
    ...overrides,
  };
}

export function page<T>(items: T[], total = items.length) {
  return { items, total, page: 1, pageSize: 25, pageCount: 1 };
}
