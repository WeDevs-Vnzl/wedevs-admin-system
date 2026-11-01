import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import { todayInCaracas, type DateOnly } from '../../../../../shared/domain/business-date';
import { ValidationFailedError } from '../../../../../shared/domain/domain-error';
import { NotFoundError } from '../../../../../shared/domain/domain-error';
import type { EntityRef } from '../../../../../shared/domain/entity-ref';
import {
  monthsOf,
  REPORT_RANGE_PRESET_VALUES,
  resolveReportRange,
  type DateRange,
  type ReportRangePreset,
} from '../../../domain/report-range';
import type {
  LabelKind,
  ReportInputsReadPort,
  ReportScope,
} from '../../ports/report-inputs-read.port';

/** Longest custom range, in calendar months: bounds the series every report builds. */
export const REPORT_MAX_MONTHS = 120;
export const DEFAULT_REPORT_PRESET: ReportRangePreset = 'LAST_12_MONTHS';

export const REPORT_VALIDATION = {
  preset: 'reports.validation.preset',
  rangeTooLong: 'reports.validation.rangeTooLong',
} as const;

/** The query of `/reports/*` (PRD §8.13): a preset or a custom range, and an optional client, project, tag. */
export interface ReportFilterInput {
  readonly preset?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly clientId?: string | undefined;
  readonly projectId?: string | undefined;
  readonly tagId?: string | undefined;
}

export interface ResolvedReportFilter {
  readonly range: DateRange;
  readonly scope: ReportScope;
  /** The Caracas business day of the request. */
  readonly today: DateOnly;
}

const isPreset = (value: string): value is ReportRangePreset =>
  (REPORT_RANGE_PRESET_VALUES as readonly string[]).includes(value);

/** The domain names the custom bounds `dateFrom` and `dateTo`; the query calls them `from` and `to`. */
function underQueryNames(error: ValidationFailedError): ValidationFailedError {
  const rename = (field: string) =>
    field === 'dateFrom' ? 'from' : field === 'dateTo' ? 'to' : field;
  const fieldErrors = Object.fromEntries(
    Object.entries(error.fieldErrors ?? {}).map(([field, keys]) => [rename(field), keys]),
  );
  return new ValidationFailedError({ message: error.message, fieldErrors });
}

/**
 * Validates the filter and resolves it: the preset and range from the Caracas day (the use case checks them
 * again, a DTO is never the only guard) and every id against the database (C14), so an unknown or deleted
 * client, project or tag answers `NOT_FOUND` before any figure is read.
 */
export async function resolveReportFilter(
  inputs: ReportInputsReadPort,
  clock: ClockPort,
  input: ReportFilterInput,
): Promise<ResolvedReportFilter> {
  const preset = input.preset ?? DEFAULT_REPORT_PRESET;
  if (!isPreset(preset)) {
    throw new ValidationFailedError({
      message: REPORT_VALIDATION.preset,
      fieldErrors: { preset: [REPORT_VALIDATION.preset] },
    });
  }
  const today = todayInCaracas(clock.now());
  let range: DateRange;
  try {
    range = resolveReportRange({ preset, dateFrom: input.from, dateTo: input.to }, today);
  } catch (error) {
    throw error instanceof ValidationFailedError ? underQueryNames(error) : error;
  }
  if (monthsOf(range).length > REPORT_MAX_MONTHS) {
    throw new ValidationFailedError({
      message: REPORT_VALIDATION.rangeTooLong,
      fieldErrors: { to: [REPORT_VALIDATION.rangeTooLong] },
    });
  }
  const scope: { clientId?: string; projectId?: string; tagId?: string } = {};
  for (const [field, kind] of [
    ['clientId', 'CLIENT'],
    ['projectId', 'PROJECT'],
    ['tagId', 'TAG'],
  ] as const) {
    const id = input[field];
    if (id === undefined) continue;
    if (!(await inputs.exists(kind, id))) throw new NotFoundError();
    scope[field] = id;
  }
  return { range, scope, today };
}

const ENTITY_TYPE: Record<'CLIENT' | 'PROJECT' | 'ACCOUNT', EntityRef['type']> = {
  CLIENT: 'CLIENT',
  PROJECT: 'PROJECT',
  ACCOUNT: 'ACCOUNT',
};

/** Labels the ids as entity refs; an id that no longer resolves keeps its id as label. */
export async function entityRefs(
  inputs: ReportInputsReadPort,
  kind: 'CLIENT' | 'PROJECT' | 'ACCOUNT',
  ids: readonly string[],
): Promise<(id: string) => EntityRef> {
  const found = ids.length === 0 ? [] : await inputs.labels(kind as LabelKind, ids);
  const byId = new Map(found.map((row) => [row.id, row]));
  return (id) => {
    const row = byId.get(id);
    return {
      type: ENTITY_TYPE[kind],
      id,
      ...(row?.code ? { code: row.code } : {}),
      label: row?.label ?? id,
    };
  };
}

export const byteOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
