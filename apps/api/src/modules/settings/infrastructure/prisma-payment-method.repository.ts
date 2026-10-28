import { Inject, Injectable } from '@nestjs/common';
import type { PaymentMethodRepository } from '../application/ports/payment-method.repository.port';
import { PAYMENT_METHOD_MESSAGES, type PaymentMethod } from '../domain/payment-method';
import { ConflictError } from '../../../shared/domain/domain-error';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { isUniqueViolation } from '../../../shared/infrastructure/prisma/unique-violation';

/** `PaymentMethod` rows through the current transaction (or the base client outside a unit of work). */
@Injectable()
export class PrismaPaymentMethodRepository implements PaymentMethodRepository {
  constructor(@Inject(TransactionHost) private readonly host: TransactionHost) {}

  async list(): Promise<PaymentMethod[]> {
    const rows = await this.host.db.paymentMethod.findMany();
    return rows.map(toPaymentMethod);
  }

  async findById(id: string): Promise<PaymentMethod | null> {
    const row = await this.host.db.paymentMethod.findUnique({ where: { id } });
    return row ? toPaymentMethod(row) : null;
  }

  async insert(method: PaymentMethod): Promise<void> {
    try {
      await this.host.db.paymentMethod.create({
        data: {
          id: method.id,
          code: method.code,
          name: method.name,
          nameEn: method.nameEn,
          requiresReference: method.requiresReference,
          suggestsIgtf: method.suggestsIgtf,
          active: method.active,
        },
      });
    } catch (error) {
      // The only unique index besides the id is `code` (`@unique`).
      if (isUniqueViolation(error)) {
        throw new ConflictError({ fieldErrors: { code: [PAYMENT_METHOD_MESSAGES.codeTaken] } });
      }
      throw error;
    }
  }

  async update(method: PaymentMethod): Promise<void> {
    await this.host.db.paymentMethod.update({
      where: { id: method.id },
      data: {
        name: method.name,
        nameEn: method.nameEn,
        requiresReference: method.requiresReference,
        suggestsIgtf: method.suggestsIgtf,
        active: method.active,
      },
    });
  }
}

function toPaymentMethod(row: {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  requiresReference: boolean;
  suggestsIgtf: boolean;
  active: boolean;
}): PaymentMethod {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nameEn: row.nameEn,
    requiresReference: row.requiresReference,
    suggestsIgtf: row.suggestsIgtf,
    active: row.active,
  };
}
