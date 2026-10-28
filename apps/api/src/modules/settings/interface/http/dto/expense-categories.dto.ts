import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Body of `POST /api/v1/expense-categories`: a root (no `parentId`) or a child of a root. */
export const createExpenseCategorySchema = z.object({
  name: z.string(),
  nameEn: z.string().nullish(),
  color: z.string().nullish(),
  parentId: z.string().nullish(),
  active: z.boolean().optional(),
});

export class CreateExpenseCategoryDto extends createZodDto(createExpenseCategorySchema) {}

/** Body of `PATCH /api/v1/expense-categories/{id}`: every editable field. */
export const updateExpenseCategorySchema = createExpenseCategorySchema;

export class UpdateExpenseCategoryDto extends createZodDto(updateExpenseCategorySchema) {}

export const expenseCategoryResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  nameEn: z.string().nullable(),
  color: z.string().nullable(),
  parentId: z.string().nullable(),
  active: z.boolean(),
});

export class ExpenseCategoryResponseDto extends createZodDto(expenseCategoryResponseSchema) {}

/** A root with its children (two levels). */
export const expenseCategoryNodeSchema = expenseCategoryResponseSchema.extend({
  children: z.array(expenseCategoryResponseSchema),
});

export class ExpenseCategoryNodeDto extends createZodDto(expenseCategoryNodeSchema) {}
