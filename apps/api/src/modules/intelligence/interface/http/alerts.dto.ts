import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  ALERT_DEFAULT_LIMIT,
  ALERT_MAX_LIMIT,
  ALERT_MAX_MARK_READ,
  ALERT_MAX_SNOOZE_DAYS,
  ALERT_TYPE_VALUES,
  type AlertOutput,
} from '../../application/use-cases/alerts/alert-support';
import type { AlertsInboxOutput } from '../../application/use-cases/alerts/list-alerts.use-case';
import {
  dateOnlySchema,
  decimalStringSchema,
  timestampSchema,
} from '../../../../shared/interface/common.schemas';
import { entityRefResponseSchema } from '../../../../shared/interface/error-envelope';

const alertType = z.enum(ALERT_TYPE_VALUES, { message: 'alerts.validation.types' });

/**
 * `GET /alerts` query. `types` is a repeated key (`?types=A&types=B`) that narrows to some alert types;
 * `limit` is 1 to 200 and defaults to 50. The use case checks both again, so an internal caller cannot
 * bypass them (`/shell`).
 */
export const listAlertsQuerySchema = z.object({
  types: z.union([alertType, z.array(alertType)]).optional(),
  limit: z.coerce
    .number({ message: 'alerts.validation.limit' })
    .int({ message: 'alerts.validation.limit' })
    .min(1, { message: 'alerts.validation.limit' })
    .max(ALERT_MAX_LIMIT, { message: 'alerts.validation.limit' })
    .default(ALERT_DEFAULT_LIMIT),
});
export class ListAlertsQueryDto extends createZodDto(listAlertsQuerySchema) {}

/** `POST /alerts/read`: one to 200 keys. The use case validates each key's format and visibility. */
export const markAlertsReadBodySchema = z.object({
  alertKeys: z
    .array(z.string(), { message: 'alerts.validation.alertKeys' })
    .min(1, { message: 'alerts.validation.alertKeys' })
    .max(ALERT_MAX_MARK_READ, { message: 'alerts.validation.alertKeys' }),
});
export class MarkAlertsReadBodyDto extends createZodDto(markAlertsReadBodySchema) {}

/** `POST /alerts/{key}/dismiss`: `days` snoozes (1 to 90); absent dismisses for good. */
export const dismissAlertBodySchema = z
  .object({
    days: z
      .number({ message: 'alerts.validation.snoozeDays' })
      .int({ message: 'alerts.validation.snoozeDays' })
      .min(1, { message: 'alerts.validation.snoozeDays' })
      .max(ALERT_MAX_SNOOZE_DAYS, { message: 'alerts.validation.snoozeDays' })
      .optional(),
  })
  // The body is optional: a bare POST dismisses for good.
  .default({});
export class DismissAlertBodyDto extends createZodDto(dismissAlertBodySchema) {}

const alertSchema = z.object({
  alertKey: z.string(),
  type: z.enum(ALERT_TYPE_VALUES),
  /** The record the alert is about (an installment points at its project); `null` for `MISSING_RATE`. */
  entity: entityRefResponseSchema.nullable(),
  /** Due date, expiry date, or the day without a rate. */
  date: dateOnlySchema.nullable(),
  /** Days until (positive) or since (negative) `date`, in America/Caracas. */
  days: z.number().int().nullable(),
  /** Amount at stake, as decimal strings (C15). */
  amount: z.object({ amount: decimalStringSchema, currency: z.string() }).nullable(),
  context: z.string().nullable(),
});

export const alertsInboxResponseSchema = z.object({
  /** Active alerts after dismissals and snoozes; not capped by `limit`. */
  total: z.number().int().nonnegative(),
  byType: z.partialRecord(z.enum(ALERT_TYPE_VALUES), z.number().int().positive()),
  items: z.array(alertSchema),
  /** The bell counter: active alerts not marked read. */
  unread: z.number().int().nonnegative(),
  readKeys: z.array(z.string()),
});
export class AlertsInboxResponseDto extends createZodDto(alertsInboxResponseSchema) {}

export class AlertsReadResponseDto extends createZodDto(
  z.object({ alertKeys: z.array(z.string()) }),
) {}

export class AlertDismissalResponseDto extends createZodDto(
  z.object({
    alertKey: z.string(),
    /** `null` = dismissed for good, or not hidden; a timestamp = snoozed until then. */
    dismissedUntil: timestampSchema.nullable(),
    active: z.boolean(),
  }),
) {}

// Output mapping, shared with the MCP tool.
const toAlertResponse = (alert: AlertOutput): AlertsInboxResponseDto['items'][number] => ({
  ...alert,
  entity: alert.entity
    ? {
        type: alert.entity.type,
        id: alert.entity.id,
        code: alert.entity.code ?? null,
        label: alert.entity.label,
      }
    : null,
});

export const toInboxResponse = (inbox: AlertsInboxOutput): AlertsInboxResponseDto => ({
  ...inbox,
  items: inbox.items.map(toAlertResponse),
});
