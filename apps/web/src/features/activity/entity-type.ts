import { entityTypeSchema, type EntityType } from "@/lib/validators/enums";

/**
 * The entity type of a log entry when the FE knows it (labels, detail routes, field enums). The BE may log
 * types the FE enum does not list yet (`PAYMENT_LINK`, `API_TOKEN`): those get no route and their raw code.
 */
export function knownEntityType(value: string): EntityType | null {
  const parsed = entityTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
