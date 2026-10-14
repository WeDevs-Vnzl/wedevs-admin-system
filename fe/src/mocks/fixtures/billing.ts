// MOCK — billing fixtures of Hito 1 (data-rules.md §2). The billing module package (H1-B3 T5) builds the billing
// screen over them and owns this file from then on. Dates are relative to the business day of the build, and the
// installment periods come from `lib/finance` (C17). Derived fields (status, lock, totals, monthly amount, schedule
// check) are left to the derive pass.
import { addDays, todayInCaracas, type DateOnly } from "@/lib/dates";
import { dueRecurringPeriods, splitByTemplate, type RecurringSchedule } from "@/lib/finance";
import type { BillingPlanDTO, InstallmentDTO, RecurringChargeDTO } from "@/lib/validators/billing";
import { mockId } from "../ids";

/** A plan as stored, with the D1 snapshot of the contract in USD (C16). */
type BillingPlanFixture = BillingPlanDTO;

const today = todayInCaracas(new Date());
const stamp = (day: DateOnly) => `${day}T15:00:00.000Z`;

const WEB_PROJECT = mockId("pry", "kairos_web");
const MAINTENANCE_PROJECT = mockId("pry", "kairos_mantenimiento");
const WEB_PLAN = mockId("bpl", "kairos_web");
const MAINTENANCE_PLAN = mockId("bpl", "kairos_mantenimiento");
const MAINTENANCE_CHARGE = mockId("rch", "kairos_mantenimiento");

// Fixed price 10 000 USD split 40/30/30 (HU-09 CA1): 4 000, 3 000 and 3 000.
const WEB_CONTRACT = "10000.00";
const WEB_TEMPLATE_LABELS = ["Anticipo 40 %", "Hito de diseño 30 %", "Entrega final 30 %"] as const;
const WEB_TEMPLATE_KINDS = ["ANTICIPO", "HITO", "FINAL"] as const;

const webInstallments: InstallmentDTO[] = splitByTemplate("SPLIT_40_30_30", WEB_CONTRACT).map(
  (part, index): InstallmentDTO => ({
    id: mockId("ins", `kairos_web_${index + 1}`),
    projectId: WEB_PROJECT,
    billingPlanId: WEB_PLAN,
    recurringChargeId: null,
    kind: WEB_TEMPLATE_KINDS[index] ?? "CUOTA",
    label: WEB_TEMPLATE_LABELS[index] ?? `Cuota ${index + 1}`,
    amount: part.amount,
    currency: "USD",
    percentage: part.percentage,
    dueDate: null,
    trigger: null,
    periodStart: null,
    periodEnd: null,
    order: index,
    status: "PENDIENTE",
    cancelledAt: null,
    invoicedAmount: "0.00",
    locked: false,
  }),
);

// Monthly maintenance, billed on the 5th with 7 days of lead (HU-10 CA1). It started 60 days ago, so the periods
// whose generation day has come are already in the schedule (no back-fill beyond them, §8.4.3).
const MAINTENANCE_START = addDays(today, -60);
const maintenanceCharge: RecurringChargeDTO = {
  id: MAINTENANCE_CHARGE,
  projectId: MAINTENANCE_PROJECT,
  label: "Mantenimiento mensual",
  amount: "150.00",
  currency: "USD",
  frequency: "MENSUAL",
  startDate: MAINTENANCE_START,
  endDate: null,
  billingDay: 5,
  leadDays: 7,
  status: "ACTIVO",
  lastGeneratedPeriodStart: null,
  monthlyAmount: "150.00",
  createdAt: stamp(MAINTENANCE_START),
  updatedAt: stamp(MAINTENANCE_START),
};

const schedule: RecurringSchedule = {
  frequency: maintenanceCharge.frequency,
  startDate: maintenanceCharge.startDate,
  endDate: maintenanceCharge.endDate,
  billingDay: maintenanceCharge.billingDay,
  leadDays: maintenanceCharge.leadDays,
  status: maintenanceCharge.status,
};

const maintenancePeriods: { periodStart: DateOnly; periodEnd: DateOnly }[] = [];
for (let guard = 0; guard < 24; guard += 1) {
  const existing = maintenancePeriods.map((period) => period.periodStart);
  const [due] = dueRecurringPeriods(schedule, existing, today);
  if (!due) break;
  maintenancePeriods.push({ periodStart: due.periodStart, periodEnd: due.periodEnd });
}

const maintenanceInstallments: InstallmentDTO[] = maintenancePeriods.map((period, index) => ({
  id: mockId("ins", `maintenance_${index + 1}`),
  projectId: MAINTENANCE_PROJECT,
  billingPlanId: MAINTENANCE_PLAN,
  recurringChargeId: MAINTENANCE_CHARGE,
  kind: "RECURRENTE",
  label: `Mantenimiento mensual · ${period.periodStart}`,
  amount: "150.00",
  currency: "USD",
  percentage: null,
  dueDate: period.periodStart,
  trigger: null,
  periodStart: period.periodStart,
  periodEnd: period.periodEnd,
  order: index,
  status: "PENDIENTE",
  cancelledAt: null,
  invoicedAmount: "0.00",
  locked: false,
}));

if (maintenancePeriods.length > 0) {
  maintenanceCharge.lastGeneratedPeriodStart =
    maintenancePeriods[maintenancePeriods.length - 1]?.periodStart ?? null;
}

export const billingPlanFixtures: BillingPlanFixture[] = [
  {
    id: WEB_PLAN,
    projectId: WEB_PROJECT,
    model: "PRECIO_FIJO",
    currency: "USD",
    contractAmount: WEB_CONTRACT,
    notes: "MOCK: contrato de precio fijo, cuotas 40/30/30.",
    installments: [],
    installmentsTotal: "0.00",
    scheduleDifference: null,
    scheduleConsistent: true,
    contractedUsd: WEB_CONTRACT,
    usdRate: "1",
    createdAt: stamp(addDays(today, -75)),
    updatedAt: stamp(addDays(today, -75)),
  },
  {
    id: MAINTENANCE_PLAN,
    projectId: MAINTENANCE_PROJECT,
    model: "RECURRENTE",
    currency: "USD",
    contractAmount: null,
    notes: "MOCK: soporte mensual sin monto contratado.",
    installments: [],
    installmentsTotal: "0.00",
    scheduleDifference: null,
    scheduleConsistent: true,
    contractedUsd: null,
    usdRate: "1",
    createdAt: stamp(addDays(today, -300)),
    updatedAt: stamp(addDays(today, -300)),
  },
];

export const installmentFixtures: InstallmentDTO[] = [
  ...webInstallments,
  ...maintenanceInstallments,
];

export const recurringChargeFixtures: RecurringChargeDTO[] = [maintenanceCharge];
