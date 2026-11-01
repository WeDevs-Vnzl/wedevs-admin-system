// The finance formulas the `intelligence` context may use (C17, X12). Re-exports only: no logic lives here.
export * from '../domain/kpis';
export { computeProjectSummary } from '../domain/project-summary';
export type {
  ProjectSummary,
  ProjectSummaryInput,
  ProjectSummaryLine,
} from '../domain/project-summary';
export type { FinanceFactKind } from '../domain/finance-fact';
