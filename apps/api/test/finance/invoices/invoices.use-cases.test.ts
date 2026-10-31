import { describe, expect, it } from 'vitest';
import {
  CANCELLED,
  GONE,
  KAIROS,
  LABS,
  LABS_1,
  NOW as NOW_ISO,
  SEED_LINE,
  WEB,
  WEB_1,
  WEB_2,
  ZAFIRO,
  createWorld,
  invoiceInput,
  invoiceRecord,
  query,
  rejection,
} from './world';

/**
 * Behavior of the mock `invoices.test.ts` (HU-11, HU-12, DT-44, HU-29 CA1) ported to the BE use cases, plus the
 * rules the mock left to the store's derive pass and the ones the DTO must never be the only guard of.
 */

const allocate = (w: ReturnType<typeof createWorld>, invoiceId: string, amount: string) =>
  w.invoices.seedAllocation(invoiceId, {
    paymentId: `pay_${invoiceId}`,
    amountInvoiceCurrency: amount,
    paymentStatus: 'CONFIRMADO',
  });

describe('derived status (HU-12)', () => {
  it('CA1: an invoice without payments that is not overdue is EMITIDA with its whole receivable as balance', async () => {
    const w = createWorld();
    const created = await w.create.execute(w.owner, invoiceInput());
    expect(created.status).toBe('EMITIDA');
    expect(created.paidAmount).toBe('0.00');
    expect(created.balance).toBe('116.00');
    expect(created.daysOverdue).toBe(0);
  });

  it('CA4: an invoice past its due date with a balance is VENCIDA with its days overdue', async () => {
    const w = createWorld();
    const created = await w.create.execute(
      w.owner,
      invoiceInput({ issueDate: '2026-08-01', dueDate: '2026-09-29' }),
    );
    expect(created.status).toBe('VENCIDA');
    expect(created.daysOverdue).toBe(10);
  });

  it('CA2/CA3: recomputing after a confirmed payment gives PARCIAL, then PAGADA at a balance of 0.01', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a' }));
    allocate(w, 'inv_a', '50.00');
    await w.uow.run(() => w.recompute.execute('inv_a'));
    const partial = await w.get.execute(w.owner, 'inv_a');
    expect(partial.status).toBe('PARCIAL');
    expect(partial.paidAmount).toBe('50.00');
    expect(partial.balance).toBe('66.00');
    expect(partial.hasPartialPayment).toBe(true);

    w.invoices.seed(invoiceRecord({ id: 'inv_b', invoiceNumber: 'KAI-0002' }));
    allocate(w, 'inv_b', '115.99');
    await w.uow.run(() => w.recompute.execute('inv_b'));
    const paid = await w.get.execute(w.owner, 'inv_b');
    expect(paid.status).toBe('PAGADA');
    expect(paid.hasPartialPayment).toBe(false);
  });

  it('a payment that is not confirmed does not count as paid', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a' }));
    w.invoices.seedAllocation('inv_a', {
      paymentId: 'pay_a',
      amountInvoiceCurrency: '50.00',
      paymentStatus: 'PENDIENTE_VERIFICACION',
    });
    await w.uow.run(() => w.recompute.execute('inv_a'));
    const invoice = await w.get.execute(w.owner, 'inv_a');
    expect(invoice.status).toBe('EMITIDA');
    expect(invoice.paidAmount).toBe('0.00');
  });

  it('CA5: voiding requires a reason, is refused while allocations are active, and a second void is a CONFLICT', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_paid' }));
    expect(
      (await rejection(w.voidInvoice.execute(w.owner, { id: 'inv_paid', reason: '  ' })))
        .fieldErrors,
    ).toEqual({
      reason: ['validation.required'],
    });

    allocate(w, 'inv_paid', '100.00');
    expect(
      await rejection(
        w.voidInvoice.execute(w.owner, { id: 'inv_paid', reason: 'Error de cliente' }),
      ),
    ).toMatchObject({ code: 'INTEGRITY_LOCK', message: 'invoices.errors.hasAllocations' });

    w.invoices.seed(invoiceRecord({ id: 'inv_free', invoiceNumber: 'KAI-0002' }));
    const voided = await w.voidInvoice.execute(w.owner, {
      id: 'inv_free',
      reason: 'Error de cliente',
    });
    expect(voided.status).toBe('ANULADA');
    expect(voided.voidReason).toBe('Error de cliente');
    expect(voided.voidedAt).toBe('2026-10-09T15:00:00.000Z');
    expect(
      await rejection(w.voidInvoice.execute(w.owner, { id: 'inv_free', reason: 'Otra vez' })),
    ).toMatchObject({ code: 'CONFLICT', message: 'invoices.errors.alreadyVoided' });
  });
});

describe('line grid and per-rate totals (DT-44)', () => {
  it('lines at 16 %, 8 %, 0 % and exempt with line discounts', async () => {
    const w = createWorld();
    const created = await w.create.execute(
      w.owner,
      invoiceInput({
        lines: [
          {
            description: 'A',
            quantity: '2',
            unitPrice: '100.00',
            discount: '20.00',
            ivaRate: '16',
          },
          { description: 'B', unitPrice: '50.00', ivaRate: '8' },
          { description: 'C', unitPrice: '30.00', ivaRate: '0' },
          { description: 'D', unitPrice: '10.00', ivaRate: null },
        ],
      }),
    );
    expect(created).toMatchObject({
      subtotal: '290.00',
      discount: '20.00',
      exemptAmount: '10.00',
      taxBase: '260.00',
      ivaAmount: '32.80',
      total: '302.80',
      totalUsd: '302.80',
    });
    expect(created.lines[0]).toMatchObject({ amount: '200.00', netAmount: '180.00' });
    expect(created.taxLines.map((line) => [line.ivaRate, line.taxBase, line.ivaAmount])).toEqual([
      ['16', '180.00', '28.80'],
      ['8', '50.00', '4.00'],
      ['0', '30.00', '0.00'],
    ]);
  });

  it('a +0.01 adjustment on a rate is added to that rate IVA and reported as the adjustment', async () => {
    const w = createWorld();
    const created = await w.create.execute(
      w.owner,
      invoiceInput({ taxAdjustments: [{ ivaRate: '16', adjustment: '0.01' }] }),
    );
    expect(created.taxLines[0]).toMatchObject({
      taxBase: '100.00',
      ivaAmount: '16.01',
      adjustment: '0.01',
    });
    expect(created.total).toBe('116.01');
  });

  it('an adjustment of 0.02 is refused by the use case itself, not only by the DTO', async () => {
    const w = createWorld();
    const error = await rejection(
      w.create.execute(
        w.owner,
        invoiceInput({ taxAdjustments: [{ ivaRate: '16', adjustment: '0.02' }] }),
      ),
    );
    expect(error).toMatchObject({ code: 'VALIDATION' });
    expect(error.fieldErrors).toEqual({
      'taxAdjustments.0.adjustment': ['invoices.validation.adjustmentOutOfRange'],
    });
  });

  it('refuses an adjustment on a rate no line uses, on 0 %, or twice on one rate', async () => {
    const w = createWorld();
    const unused = await rejection(
      w.create.execute(
        w.owner,
        invoiceInput({ taxAdjustments: [{ ivaRate: '8', adjustment: '0.01' }] }),
      ),
    );
    expect(unused.fieldErrors).toEqual({
      'taxAdjustments.0.ivaRate': ['invoices.validation.adjustmentRateNotInLines'],
    });
    const zero = await rejection(
      w.create.execute(
        w.owner,
        invoiceInput({
          lines: [{ description: 'Export', unitPrice: '10.00', ivaRate: '0' }],
          taxAdjustments: [{ ivaRate: '0', adjustment: '0.01' }],
        }),
      ),
    );
    expect(zero.fieldErrors).toEqual({
      'taxAdjustments.0.ivaRate': ['invoices.validation.adjustmentRateNotInLines'],
    });
    const twice = await rejection(
      w.create.execute(
        w.owner,
        invoiceInput({
          taxAdjustments: [
            { ivaRate: '16', adjustment: '0.01' },
            { ivaRate: '16.00', adjustment: '-0.01' },
          ],
        }),
      ),
    );
    expect(twice.fieldErrors).toEqual({
      'taxAdjustments.1.ivaRate': ['invoices.validation.duplicateAdjustmentRate'],
    });
  });

  it('a line discount above its amount is refused', async () => {
    const w = createWorld();
    const error = await rejection(
      w.create.execute(
        w.owner,
        invoiceInput({
          lines: [{ description: 'A', unitPrice: '10.00', discount: '11.00', ivaRate: '16' }],
        }),
      ),
    );
    expect(error.fieldErrors).toEqual({
      'lines.0.discount': ['invoices.validation.discountExceedsAmount'],
    });
  });

  it('withholdings above the total are refused as invalid totals', async () => {
    const w = createWorld();
    const error = await rejection(
      w.create.execute(w.owner, invoiceInput({ ivaWithheld: '500.00' })),
    );
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { lines: ['invoices.validation.invalidTotals'] },
    });
  });

  it('a VAT rate outside the fiscal setting is refused', async () => {
    const w = createWorld();
    const error = await rejection(
      w.create.execute(
        w.owner,
        invoiceInput({ lines: [{ description: 'A', unitPrice: '10.00', ivaRate: '12' }] }),
      ),
    );
    expect(error.fieldErrors).toEqual({
      'lines.0.ivaRate': ['invoices.validation.ivaRateNotAllowed'],
    });
  });

  it('keeps the withholdings and requires a note for the other ones', async () => {
    const w = createWorld();
    const created = await w.create.execute(
      w.owner,
      invoiceInput({
        ivaWithheld: '12.00',
        islrWithheld: '2.00',
        otherWithheld: '1.00',
        otherWithheldNote: 'Municipal',
      }),
    );
    expect(created).toMatchObject({
      receivable: '101.00',
      receivableUsd: '101.00',
      otherWithheldNote: 'Municipal',
    });
    const error = await rejection(
      w.create.execute(w.owner, invoiceInput({ otherWithheld: '1.00' })),
    );
    expect(error.fieldErrors).toEqual({
      otherWithheldNote: ['invoices.validation.otherWithheldNoteRequired'],
    });
  });

  it('converts a foreign-currency invoice to USD with its own rate (C16)', async () => {
    const w = createWorld();
    const created = await w.create.execute(
      w.owner,
      invoiceInput({
        currency: 'VES',
        usdRate: '40',
        lines: [{ description: 'A', unitPrice: '4000.00', ivaRate: '16' }],
      }),
    );
    expect(created).toMatchObject({ total: '4640.00', totalUsd: '116.00', balance: '4640.00' });
  });
});

describe('shape rules enforced in the use case (lesson B2)', () => {
  it('collects the field errors of a malformed input', async () => {
    const w = createWorld();
    const error = await rejection(
      w.create.execute(
        w.owner,
        invoiceInput({
          invoiceNumber: '  ',
          issueDate: '2026-02-31',
          dueDate: '2026-10-01',
          currency: 'USD',
          usdRate: '2',
          lines: [{ description: '', quantity: '0', unitPrice: '-1', ivaRate: '16' }],
        }),
      ),
    );
    expect(error.code).toBe('VALIDATION');
    expect(error.fieldErrors).toMatchObject({
      invoiceNumber: ['validation.required'],
      issueDate: ['validation.date.invalid'],
      usdRate: ['catalogs.validation.usdRateMustBeOne'],
      'lines.0.description': ['validation.required'],
      'lines.0.quantity': ['validation.money.mustBePositive'],
      'lines.0.unitPrice': ['validation.money.invalid'],
    });
  });

  it('refuses a due date before the issue date, no lines, and more than 200 lines', async () => {
    const w = createWorld();
    expect(
      (
        await rejection(
          w.create.execute(
            w.owner,
            invoiceInput({ issueDate: '2026-10-09', dueDate: '2026-10-08' }),
          ),
        )
      ).fieldErrors,
    ).toEqual({ dueDate: ['invoices.validation.dueBeforeIssue'] });
    expect(
      (await rejection(w.create.execute(w.owner, invoiceInput({ lines: [] })))).fieldErrors,
    ).toEqual({
      lines: ['validation.required'],
    });
    const many = Array.from({ length: 201 }, () => ({
      description: 'x',
      unitPrice: '1.00',
      ivaRate: '16',
    }));
    expect(
      (await rejection(w.create.execute(w.owner, invoiceInput({ lines: many })))).fieldErrors,
    ).toEqual({
      lines: ['validation.tooLong'],
    });
  });

  it('refuses an unknown currency', async () => {
    const w = createWorld();
    const error = await rejection(
      w.create.execute(w.owner, invoiceInput({ currency: 'XXX', usdRate: '1' })),
    );
    expect(error.fieldErrors).toEqual({ currency: ['catalogs.rates.errors.unknownCurrency'] });
  });

  it('an unknown or archived client is NOT_FOUND (never trust a client id)', async () => {
    const w = createWorld();
    expect(
      await rejection(w.create.execute(w.owner, invoiceInput({ clientId: GONE }))),
    ).toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('invoice number (HU-11 CA3)', () => {
  it('is unique among the non-archived invoices, trimmed and case ignored: CONFLICT with the holder', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_holder', invoiceNumber: 'KAI-0001' }));
    const error = await rejection(
      w.create.execute(w.owner, invoiceInput({ invoiceNumber: ' kai-0001 ' })),
    );
    expect(error).toMatchObject({
      code: 'CONFLICT',
      fieldErrors: { invoiceNumber: ['invoices.errors.numberTaken'] },
      entity: { type: 'INVOICE', id: 'inv_holder', code: 'FAC-0100', label: 'KAI-0001' },
    });
    expect(w.invoices.all).toHaveLength(1);
  });

  it('is free again once the holder is archived', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_holder', invoiceNumber: 'KAI-0003' }));
    await w.archive.execute(w.owner, { id: 'inv_holder' });
    const created = await w.create.execute(w.owner, invoiceInput({ invoiceNumber: 'KAI-0003' }));
    expect(created.invoiceNumber).toBe('KAI-0003');
  });

  it('an edit may keep its own number but not take another invoice number', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a', invoiceNumber: 'A-1', clientId: ZAFIRO }));
    w.invoices.seed(invoiceRecord({ id: 'inv_b', invoiceNumber: 'B-1', clientId: ZAFIRO }));
    await w.update.execute(w.owner, { ...invoiceInput({ invoiceNumber: 'A-1' }), id: 'inv_a' });
    const error = await rejection(
      w.update.execute(w.owner, { ...invoiceInput({ invoiceNumber: 'b-1' }), id: 'inv_a' }),
    );
    expect(error).toMatchObject({ code: 'CONFLICT', entity: { id: 'inv_b' } });
  });
});

describe('billing installments (HU-11 CA1, CA5)', () => {
  const kairosLines = (...lines: Record<string, unknown>[]) =>
    invoiceInput({ clientId: KAIROS, invoiceNumber: 'KAI-0100', lines });

  it('lists the PENDIENTE installments of every live project of the client with what is left to bill', async () => {
    const w = createWorld();
    w.invoices.seedBillable({
      installment: { type: 'INSTALLMENT', id: WEB_1, label: 'Anticipo' },
      project: { type: 'PROJECT', id: WEB, label: 'Kairos Web' },
      kind: 'ANTICIPO',
      label: 'Anticipo',
      currency: 'USD',
      amount: '4000.00',
      invoicedAmount: '1000.00',
      dueDate: null,
    });
    w.invoices.seedBillable({
      installment: { type: 'INSTALLMENT', id: LABS_1, label: 'Zafiro 1' },
      project: { type: 'PROJECT', id: LABS, label: 'Zafiro App' },
      kind: 'HITO',
      label: 'Zafiro 1',
      currency: 'VES',
      amount: '1000.00',
      invoicedAmount: '0.00',
      dueDate: '2026-12-01',
    });
    const rows = await w.listBillable.execute(w.owner, KAIROS);
    expect(rows.map((row) => [row.installment.id, row.remainingAmount])).toEqual([
      [WEB_1, '3000.00'],
    ]);
    expect(await rejection(w.listBillable.execute(w.owner, GONE))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('billing installments creates their lines (project taken from the installment) and recomputes their status', async () => {
    const w = createWorld();
    const created = await w.create.execute(
      w.owner,
      kairosLines(
        {
          description: 'Anticipo',
          projectId: WEB,
          installmentId: WEB_1,
          unitPrice: '4000.00',
          ivaRate: '16',
        },
        {
          description: 'Hito de diseño',
          installmentId: WEB_2,
          unitPrice: '3000.00',
          ivaRate: '16',
        },
      ),
    );
    expect(created.lines[0]?.installmentId).toBe(WEB_1);
    expect(created.lines[1]?.projectId).toBe(WEB);
    expect(created.total).toBe('8120.00');
    expect(w.recomputed).toEqual([[WEB_1, WEB_2]]);
    expect(w.projector.calls).toEqual([
      `invoice:${created.id}`,
      `clients:${KAIROS}`,
      `projects:${WEB}`,
    ]);
    expect(w.locks.acquired.map((row) => `${row.rowClass}:${row.id}`)).toEqual([
      `Project:${WEB}`,
      `Client:${KAIROS}`,
      `BillingInstallment:${WEB_1}`,
      `BillingInstallment:${WEB_2}`,
    ]);
  });

  it('refuses to bill more than the installment still has (VALIDATION on the line)', async () => {
    const w = createWorld();
    await w.create.execute(
      w.owner,
      kairosLines({
        description: 'Anticipo',
        installmentId: WEB_1,
        unitPrice: '4000.00',
        ivaRate: '16',
      }),
    );
    const error = await rejection(
      w.create.execute(
        w.owner,
        invoiceInput({
          clientId: KAIROS,
          invoiceNumber: 'KAI-0102',
          lines: [
            { description: 'Otra vez', installmentId: WEB_1, unitPrice: '1.00', ivaRate: '16' },
          ],
        }),
      ),
    );
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { 'lines.0.unitPrice': ['invoices.errors.installmentExceeded'] },
    });
  });

  it('refuses two lines of the same installment in one invoice', async () => {
    const w = createWorld();
    const error = await rejection(
      w.create.execute(
        w.owner,
        kairosLines(
          { description: 'Anticipo', installmentId: WEB_1, unitPrice: '1000.00', ivaRate: '16' },
          {
            description: 'Anticipo bis',
            installmentId: WEB_1,
            unitPrice: '1000.00',
            ivaRate: '16',
          },
        ),
      ),
    );
    expect(error.fieldErrors).toEqual({
      'lines.1.installmentId': ['invoices.validation.duplicateInstallment'],
    });
  });

  it('voiding the invoice releases its installments', async () => {
    const w = createWorld();
    const created = await w.create.execute(
      w.owner,
      kairosLines({
        description: 'Anticipo',
        installmentId: WEB_1,
        unitPrice: '4000.00',
        ivaRate: '16',
      }),
    );
    w.recomputed.length = 0;
    await w.voidInvoice.execute(w.owner, { id: created.id, reason: 'Duplicada' });
    expect(w.recomputed).toEqual([[WEB_1]]);
    expect(await w.invoices.billedAmounts([WEB_1], null)).toEqual(new Map());
  });

  it('refuses an installment of another client, a cancelled one, one of another currency, and an unknown one', async () => {
    const w = createWorld();
    const other = await rejection(
      w.create.execute(
        w.owner,
        invoiceInput({
          invoiceNumber: 'NEW-0200',
          lines: [
            { description: 'Ajena', installmentId: WEB_1, unitPrice: '100.00', ivaRate: '16' },
          ],
        }),
      ),
    );
    expect(other.fieldErrors).toEqual({
      'lines.0.installmentId': ['invoices.errors.projectOtherClient'],
    });
    const cancelled = await rejection(
      w.create.execute(
        w.owner,
        kairosLines({
          description: 'x',
          installmentId: CANCELLED,
          unitPrice: '10.00',
          ivaRate: '16',
        }),
      ),
    );
    expect(cancelled.fieldErrors).toEqual({
      'lines.0.installmentId': ['invoices.errors.installmentCancelled'],
    });
    const currency = await rejection(
      w.create.execute(
        w.owner,
        invoiceInput({
          clientId: ZAFIRO,
          lines: [{ description: 'x', installmentId: LABS_1, unitPrice: '10.00', ivaRate: '16' }],
        }),
      ),
    );
    expect(currency.fieldErrors).toEqual({
      'lines.0.installmentId': ['invoices.errors.installmentCurrency'],
    });
    const unknown = await rejection(
      w.create.execute(
        w.owner,
        kairosLines({
          description: 'x',
          installmentId: 'ins_nope',
          unitPrice: '10.00',
          ivaRate: '16',
        }),
      ),
    );
    expect(unknown.code).toBe('NOT_FOUND');
  });

  it('a line project must belong to the client (VALIDATION) and exist (NOT_FOUND)', async () => {
    const w = createWorld();
    const other = await rejection(
      w.create.execute(
        w.owner,
        invoiceInput({
          lines: [{ description: 'x', projectId: WEB, unitPrice: '10.00', ivaRate: '16' }],
        }),
      ),
    );
    expect(other.fieldErrors).toEqual({
      'lines.0.projectId': ['invoices.errors.projectOtherClient'],
    });
    const unknown = await rejection(
      w.create.execute(
        w.owner,
        invoiceInput({
          lines: [{ description: 'x', projectId: 'pry_nope', unitPrice: '10.00', ivaRate: '16' }],
        }),
      ),
    );
    expect(unknown.code).toBe('NOT_FOUND');
  });
});

describe('PDF attachment (HU-11 CA4, C23)', () => {
  it('attaches a ready PDF on create and shows it in the detail', async () => {
    const w = createWorld();
    const created = await w.create.execute(w.owner, invoiceInput({ fileId: 'file_pdf' }));
    expect(created.fileId).toBe('file_pdf');
    expect(created.file?.mimeType).toBe('application/pdf');
    expect(w.reservedFiles).toEqual(['file_pdf']);
  });

  it('PUT file attaches, replaces and detaches with null', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a' }));
    expect((await w.attachFile.execute(w.owner, { id: 'inv_a', fileId: 'file_pdf' })).fileId).toBe(
      'file_pdf',
    );
    expect((await w.attachFile.execute(w.owner, { id: 'inv_a', fileId: null })).fileId).toBeNull();
  });

  it('refuses a type outside PDF, PNG, JPG and WEBP, a file above 10 MB, and a file that is not ready', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a' }));
    expect(
      (await rejection(w.attachFile.execute(w.owner, { id: 'inv_a', fileId: 'file_txt' })))
        .fieldErrors,
    ).toEqual({
      fileId: ['invoices.validation.fileType'],
    });
    expect(
      (await rejection(w.attachFile.execute(w.owner, { id: 'inv_a', fileId: 'file_big' })))
        .fieldErrors,
    ).toEqual({
      fileId: ['invoices.validation.fileTooLarge'],
    });
    expect(
      (await rejection(w.attachFile.execute(w.owner, { id: 'inv_a', fileId: 'file_gone' })))
        .fieldErrors,
    ).toEqual({
      fileId: ['invoices.validation.fileNotReady'],
    });
  });

  it('an archived invoice is read-only for its file', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a', archivedAt: NOW_ISO }));
    expect(
      await rejection(w.attachFile.execute(w.owner, { id: 'inv_a', fileId: 'file_pdf' })),
    ).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { id: ['invoices.errors.archived'] },
    });
  });
});

describe('edit, drafts and archive', () => {
  const updateOf = (id: string, over: Record<string, unknown> = {}) => ({
    ...invoiceInput({ clientId: KAIROS, invoiceNumber: 'KAI-0001', ...over }),
    id,
  });

  it('refuses an edit that drops the receivable below what is already allocated', async () => {
    const w = createWorld();
    w.invoices.seed(
      invoiceRecord({ id: 'inv_a', total: '1392.00', receivable: '1392.00', balance: '1392.00' }),
    );
    allocate(w, 'inv_a', '1000.00');
    const error = await rejection(
      w.update.execute(
        w.owner,
        updateOf('inv_a', {
          lines: [{ description: 'Menos', unitPrice: '500.00', ivaRate: '16' }],
        }),
      ),
    );
    expect(error).toMatchObject({
      code: 'INTEGRITY_LOCK',
      message: 'invoices.errors.receivableBelowPaid',
    });
  });

  it('an invoice with allocations keeps its client and currency', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a' }));
    allocate(w, 'inv_a', '10.00');
    expect(
      await rejection(w.update.execute(w.owner, updateOf('inv_a', { clientId: ZAFIRO }))),
    ).toMatchObject({ code: 'INTEGRITY_LOCK', message: 'invoices.errors.clientLocked' });
    expect(
      await rejection(
        w.update.execute(w.owner, updateOf('inv_a', { currency: 'VES', usdRate: '40' })),
      ),
    ).toMatchObject({ code: 'INTEGRITY_LOCK', message: 'invoices.errors.clientLocked' });
  });

  it('applies an edit that keeps the receivable above the allocated amount and re-projects the allocated payments', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a' }));
    allocate(w, 'inv_a', '50.00');
    const updated = await w.update.execute(
      w.owner,
      updateOf('inv_a', { lines: [{ description: 'Más', unitPrice: '2000.00', ivaRate: '16' }] }),
    );
    expect(updated.total).toBe('2320.00');
    expect(updated.paidAmount).toBe('50.00');
    expect(updated.balance).toBe('2270.00');
    expect(updated.status).toBe('PARCIAL');
    expect(w.projector.calls).toEqual(['invoice:inv_a', 'payment:pay_inv_a', `clients:${KAIROS}`]);
    expect(w.locks.acquired.map((row) => `${row.rowClass}:${row.id}`)).toEqual([
      `Client:${KAIROS}`,
      'Invoice:inv_a',
      'Payment:pay_inv_a',
    ]);
  });

  it('HU-29 CA1: editing the total logs the diff total: [before, after]', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a' }));
    await w.update.execute(
      w.owner,
      updateOf('inv_a', { lines: [{ description: 'Más', unitPrice: '2000.00', ivaRate: '16' }] }),
    );
    const entry = w.activity.entries.at(-1);
    expect(entry).toMatchObject({
      action: 'UPDATE',
      entityType: 'INVOICE',
      entityId: 'inv_a',
      entityLabel: 'KAI-0001',
      clientId: KAIROS,
      changes: { total: ['116.00', '2320.00'] },
    });
  });

  it('an edit that keeps the total logs no total diff', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a' }));
    await w.update.execute(
      w.owner,
      updateOf('inv_a', {
        controlNumber: 'CTRL-9',
        lines: [{ id: 'inl_seed', description: 'Servicio', unitPrice: '100.00', ivaRate: '16' }],
      }),
    );
    const entry = w.activity.entries.at(-1);
    expect(entry?.action).toBe('UPDATE');
    expect(entry?.changes).toMatchObject({ controlNumber: [null, 'CTRL-9'] });
    expect(entry?.changes).not.toHaveProperty('total');
  });

  it('a line keeps its id only when it belongs to the invoice; any other id is replaced (C14)', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a' }));
    const updated = await w.update.execute(
      w.owner,
      updateOf('inv_a', {
        lines: [
          { id: 'inl_seed', description: 'Servicio', unitPrice: '100.00', ivaRate: '16' },
          { id: 'inl_stolen', description: 'Otra', unitPrice: '1.00', ivaRate: '16' },
        ],
      }),
    );
    expect(updated.lines[0]?.id).toBe('inl_seed');
    expect(updated.lines[1]?.id).not.toBe('inl_stolen');
  });

  it('a voided or archived invoice is read-only', async () => {
    const w = createWorld();
    w.invoices.seed(
      invoiceRecord({ id: 'inv_void', status: 'ANULADA', voidedAt: NOW_ISO, voidReason: 'x' }),
    );
    w.invoices.seed(
      invoiceRecord({ id: 'inv_arch', invoiceNumber: 'KAI-0009', archivedAt: NOW_ISO }),
    );
    expect(await rejection(w.update.execute(w.owner, updateOf('inv_void')))).toMatchObject({
      code: 'CONFLICT',
      message: 'invoices.errors.voided',
    });
    expect(await rejection(w.update.execute(w.owner, updateOf('inv_arch')))).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { id: ['invoices.errors.archived'] },
    });
  });

  it('a draft becomes an issued invoice with issueDraft, and only once', async () => {
    const w = createWorld();
    const draft = await w.create.execute(
      w.owner,
      invoiceInput({ invoiceNumber: 'BOR-1', isDraft: true }),
    );
    expect(draft.status).toBe('BORRADOR');
    const issued = await w.issueDraft.execute(w.owner, { id: draft.id });
    expect(issued.isDraft).toBe(false);
    expect(issued.status).toBe('EMITIDA');
    expect(await rejection(w.issueDraft.execute(w.owner, { id: draft.id }))).toMatchObject({
      code: 'CONFLICT',
      message: 'invoices.errors.notDraft',
    });
  });

  it('an archived draft cannot be issued, an archived invoice cannot be voided: VALIDATION like updateInvoice', async () => {
    const w = createWorld();
    w.invoices.seed(
      invoiceRecord({ id: 'inv_a', isDraft: true, status: 'BORRADOR', archivedAt: NOW_ISO }),
    );
    w.invoices.seed(invoiceRecord({ id: 'inv_b', invoiceNumber: 'KAI-0002', archivedAt: NOW_ISO }));
    const refused = { code: 'VALIDATION', fieldErrors: { id: ['invoices.errors.archived'] } };

    expect(await rejection(w.issueDraft.execute(w.owner, { id: 'inv_a' }))).toMatchObject(refused);
    expect(
      await rejection(w.voidInvoice.execute(w.owner, { id: 'inv_b', reason: 'Duplicada' })),
    ).toMatchObject(refused);

    expect((await w.invoices.findById('inv_a'))?.isDraft).toBe(true);
    expect((await w.invoices.findById('inv_b'))?.voidedAt).toBeNull();
    expect(w.projector.calls).toEqual([]);
  });

  it('issueDraft rechecks the live client and the live projects of the lines', async () => {
    const draft = (lineProject: string | null) =>
      invoiceRecord({
        id: 'inv_a',
        isDraft: true,
        status: 'BORRADOR',
        lines: [{ ...SEED_LINE, projectId: lineProject }],
      });

    const clientGone = createWorld();
    clientGone.invoices.seed(draft(null));
    clientGone.clients.delete(KAIROS);
    expect(
      await rejection(clientGone.issueDraft.execute(clientGone.owner, { id: 'inv_a' })),
    ).toMatchObject({ code: 'NOT_FOUND' });

    const projectGone = createWorld();
    projectGone.invoices.seed(draft(WEB));
    projectGone.projects.delete(WEB);
    expect(
      await rejection(projectGone.issueDraft.execute(projectGone.owner, { id: 'inv_a' })),
    ).toMatchObject({ code: 'NOT_FOUND' });

    const otherClient = createWorld();
    otherClient.invoices.seed(draft(LABS));
    expect(
      await rejection(otherClient.issueDraft.execute(otherClient.owner, { id: 'inv_a' })),
    ).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { 'lines.0.projectId': ['invoices.errors.projectOtherClient'] },
    });
    expect((await otherClient.invoices.findById('inv_a'))?.isDraft).toBe(true);

    const fine = createWorld();
    fine.invoices.seed(draft(WEB));
    expect((await fine.issueDraft.execute(fine.owner, { id: 'inv_a' })).isDraft).toBe(false);
  });

  it('a voided draft cannot be issued', async () => {
    const w = createWorld();
    w.invoices.seed(
      invoiceRecord({ id: 'inv_a', isDraft: true, status: 'ANULADA', voidedAt: NOW_ISO }),
    );
    expect(await rejection(w.issueDraft.execute(w.owner, { id: 'inv_a' }))).toMatchObject({
      code: 'CONFLICT',
      message: 'invoices.errors.voided',
    });
  });

  it('refuses to archive an invoice with active allocations, and archives otherwise', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a' }));
    allocate(w, 'inv_a', '100.00');
    expect(await rejection(w.archive.execute(w.owner, { id: 'inv_a' }))).toMatchObject({
      code: 'INTEGRITY_LOCK',
      message: 'invoices.errors.hasAllocations',
    });

    w.invoices.seed(
      invoiceRecord({
        id: 'inv_b',
        invoiceNumber: 'KAI-0002',
        lines: [{ ...SEED_LINE, projectId: WEB, installmentId: WEB_1 }],
      }),
    );
    const archived = await w.archive.execute(w.owner, { id: 'inv_b' });
    expect(archived.archivedAt).toBe(NOW_ISO);
    expect(w.search.get('INVOICE', 'inv_b')?.archived).toBe(true);
    expect(w.recomputed.at(-1)).toEqual([WEB_1]);
    expect(w.activity.entries.at(-1)).toMatchObject({ action: 'DELETE', entityId: 'inv_b' });
    expect(await rejection(w.archive.execute(w.owner, { id: 'inv_b' }))).toMatchObject({
      code: 'CONFLICT',
      message: 'invoices.errors.alreadyArchived',
    });
  });

  it('an unknown invoice id is a NOT_FOUND on every mutation and read', async () => {
    const w = createWorld();
    for (const run of [
      () => w.get.execute(w.owner, 'inv_missing'),
      () => w.archive.execute(w.owner, { id: 'inv_missing' }),
      () => w.voidInvoice.execute(w.owner, { id: 'inv_missing', reason: 'x' }),
      () => w.issueDraft.execute(w.owner, { id: 'inv_missing' }),
      () => w.attachFile.execute(w.owner, { id: 'inv_missing', fileId: null }),
      () => w.update.execute(w.owner, updateOf('inv_missing')),
    ]) {
      expect(await rejection(run())).toMatchObject({ code: 'NOT_FOUND' });
    }
  });
});

describe('lists (DT-25)', () => {
  it('hides archived invoices unless the trash roles ask for them, and filters by status, client and search', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a', invoiceNumber: 'KAI-0001', code: 'FAC-0001' }));
    w.invoices.seed(
      invoiceRecord({
        id: 'inv_b',
        invoiceNumber: 'ZAF-0001',
        code: 'FAC-0002',
        clientId: ZAFIRO,
        status: 'PAGADA',
      }),
    );
    w.invoices.seed(
      invoiceRecord({
        id: 'inv_c',
        invoiceNumber: 'KAI-0003',
        code: 'FAC-0003',
        archivedAt: NOW_ISO,
      }),
    );

    expect((await w.list.execute(w.owner, query())).items.map((row) => row.id).sort()).toEqual([
      'inv_a',
      'inv_b',
    ]);
    expect((await w.list.execute(w.owner, query({ archived: 'include' }))).items).toHaveLength(3);
    expect(
      (await w.list.execute(w.owner, query({ archived: 'only' }))).items.map((row) => row.id),
    ).toEqual(['inv_c']);
    expect(
      (await w.list.execute(w.owner, query({ filters: { status: ['PAGADA'] } }))).items.map(
        (row) => row.id,
      ),
    ).toEqual(['inv_b']);
    expect(
      (await w.list.execute(w.owner, query({ q: 'zaf-0001' }))).items.map((row) => row.id),
    ).toEqual(['inv_b']);
  });

  it('daysOverdue is derived from the due date for an overdue invoice and 0 otherwise', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a', status: 'VENCIDA', dueDate: '2026-10-04' }));
    w.invoices.seed(invoiceRecord({ id: 'inv_b', invoiceNumber: 'B', status: 'EMITIDA' }));
    const rows = (await w.list.execute(w.owner, query())).items;
    expect(rows.find((row) => row.id === 'inv_a')).toMatchObject({
      daysOverdue: 5,
      hasPartialPayment: false,
    });
    expect(rows.find((row) => row.id === 'inv_b')?.daysOverdue).toBe(0);
  });

  it('refuses a malformed filter and an unknown sort field', async () => {
    const w = createWorld();
    expect(
      (
        await rejection(
          w.list.execute(w.owner, query({ filters: { status: ['NOPE'], dateFrom: '2026-13-01' } })),
        )
      ).fieldErrors,
    ).toEqual({ status: ['validation.invalidOption'], dateFrom: ['validation.date.invalid'] });
    expect(
      (
        await rejection(
          w.list.execute(w.owner, query({ sort: { field: 'color', direction: 'asc' } })),
        )
      ).fieldErrors,
    ).toEqual({ sort: ['validation.sort.invalid'] });
  });

  it('lists the open invoices of a live client', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a' }));
    w.invoices.seed(invoiceRecord({ id: 'inv_b', invoiceNumber: 'B', status: 'PAGADA' }));
    expect((await w.listOpen.execute(w.owner, KAIROS)).map((row) => row.id)).toEqual(['inv_a']);
    expect(await rejection(w.listOpen.execute(w.owner, GONE))).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('permissions (PRD §4.3, C13)', () => {
  it('Member and Viewer get FORBIDDEN on every use case, and nothing is written', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a' }));
    for (const user of [w.member, w.viewer]) {
      for (const run of [
        () => w.list.execute(user, query()),
        () => w.get.execute(user, 'inv_a'),
        () => w.create.execute(user, invoiceInput()),
        () => w.update.execute(user, { ...invoiceInput(), id: 'inv_a' }),
        () => w.issueDraft.execute(user, { id: 'inv_a' }),
        () => w.voidInvoice.execute(user, { id: 'inv_a', reason: 'x' }),
        () => w.archive.execute(user, { id: 'inv_a' }),
        () => w.restore.execute(user, 'inv_a'),
        () => w.attachFile.execute(user, { id: 'inv_a', fileId: null }),
        () => w.listBillable.execute(user, KAIROS),
        () => w.listOpen.execute(user, KAIROS),
      ]) {
        expect(await rejection(run())).toMatchObject({ code: 'FORBIDDEN' });
      }
    }
    expect(w.invoices.all).toHaveLength(1);
    expect(w.activity.entries).toHaveLength(0);
  });

  it('the Admin works the whole slice', async () => {
    const w = createWorld();
    const created = await w.create.execute(w.admin, invoiceInput());
    expect(created.createdById).toBe(w.admin.userId);
  });
});

describe('create details', () => {
  it('persists the next FAC code, a USD snapshot, the creator, the search entry and the activity entry', async () => {
    const w = createWorld();
    const created = await w.create.execute(w.owner, invoiceInput({ controlNumber: ' 00-123 ' }));
    expect(created.code).toBe('FAC-0001');
    expect(created.controlNumber).toBe('00-123');
    expect(created.createdAt).toBe(NOW_ISO);
    expect(w.search.get('INVOICE', created.id)).toMatchObject({
      code: 'FAC-0001',
      title: 'NEW-0001',
      status: 'EMITIDA',
      archived: false,
    });
    expect(w.activity.entries.at(-1)).toMatchObject({
      action: 'CREATE',
      entityType: 'INVOICE',
      entityLabel: 'NEW-0001',
      clientId: ZAFIRO,
      touchClientIds: [ZAFIRO],
      metadata: { code: 'FAC-0001' },
    });
    expect(w.uow.lastOptions).toEqual({ isolation: 'Serializable' });
  });

  it('writes nothing when a rule fails halfway (one unit of work)', async () => {
    const w = createWorld();
    await rejection(
      w.create.execute(
        w.owner,
        invoiceInput({
          lines: [
            { description: 'ok', projectId: LABS, unitPrice: '10.00', ivaRate: '16' },
            { description: 'bad', projectId: WEB, unitPrice: '10.00', ivaRate: '16' },
          ],
        }),
      ),
    );
    expect(w.invoices.all).toHaveLength(0);
    expect(w.projector.calls).toEqual([]);
    expect(w.activity.entries).toHaveLength(0);
  });
});
