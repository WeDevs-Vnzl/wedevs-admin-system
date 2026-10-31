import { describe, expect, it } from 'vitest';
import {
  invoiceInputErrors,
  normalizeInvoiceInput,
  type InvoiceInput,
} from '../../../src/modules/finance/application/use-cases/invoices/invoice-input';
import { ListInvoices } from '../../../src/modules/finance/application/use-cases/invoices/list-invoices.use-case';
import { SYSTEM_ACTOR } from '../../../src/modules/finance/application/recompute-all';
import { FixedClock } from '../../support/fakes/fixed-clock';
import {
  KAIROS,
  LABS_1,
  NOW,
  SEED_LINE,
  WEB,
  WEB_1,
  ZAFIRO,
  createWorld,
  invoiceInput,
  invoiceRecord,
  query,
  rejection,
  type World,
} from './world';

const RATES = ['16', '8', '0'];
const errorsOf = (over: Record<string, unknown>) => invoiceInputErrors(invoiceInput(over), RATES);

describe('invoiceInputErrors: shape rules without a DTO (lesson B2)', () => {
  it('accepts the base input and the notations the form sends', () => {
    expect(errorsOf({})).toEqual({});
    expect(
      errorsOf({
        lines: [
          { description: 'x', quantity: '1.5', unitPrice: '10', discount: '0', ivaRate: '16.00' },
        ],
      }),
    ).toEqual({});
  });

  it('checks the header texts, the currency and the rates', () => {
    expect(
      errorsOf({
        clientId: '',
        invoiceNumber: 'x'.repeat(41),
        controlNumber: 'y'.repeat(41),
        currency: 'usd',
        usdRate: '0',
        bcvRate: '-1',
      }),
    ).toEqual({
      clientId: ['validation.required'],
      invoiceNumber: ['validation.tooLong'],
      controlNumber: ['validation.tooLong'],
      currency: ['validation.invalidOption'],
      usdRate: ['validation.rate.mustBePositive'],
      bcvRate: ['validation.rate.invalid'],
    });
    expect(errorsOf({ usdRate: '1.123456789' }).usdRate).toEqual([
      'validation.rate.tooManyDecimals',
    ]);
    expect(errorsOf({ usdRate: '1234567890123' }).usdRate).toEqual(['validation.rate.outOfRange']);
    expect(errorsOf({ usdRate: 'abc' }).usdRate).toEqual(['validation.rate.invalid']);
    expect(errorsOf({ currency: 'VES', usdRate: '40.5', bcvRate: '36.1' })).toEqual({});
    expect(errorsOf({ issueDate: 20261009 as never }).issueDate).toEqual([
      'validation.date.invalid',
    ]);
  });

  it('checks each line amount: range, decimals, sign and the discount', () => {
    const line = (over: Record<string, unknown>) => ({
      description: 'x',
      unitPrice: '10.00',
      ivaRate: '16',
      ...over,
    });
    expect(
      errorsOf({ lines: [line({ unitPrice: '12345678901234567.00' })] })['lines.0.unitPrice'],
    ).toEqual(['validation.money.outOfRange']);
    expect(errorsOf({ lines: [line({ unitPrice: '10.005' })] })['lines.0.unitPrice']).toEqual([
      'validation.money.tooManyDecimals',
    ]);
    expect(errorsOf({ lines: [line({ quantity: '12345678901' })] })['lines.0.quantity']).toEqual([
      'validation.money.outOfRange',
    ]);
    expect(errorsOf({ lines: [line({ discount: '-1' })] })['lines.0.discount']).toEqual([
      'validation.money.invalid',
    ]);
    expect(
      errorsOf({ lines: [line({ description: 'z'.repeat(301) })] })['lines.0.description'],
    ).toEqual(['validation.tooLong']);
    expect(errorsOf({ lines: [line({ ivaRate: 'abc' })] })['lines.0.ivaRate']).toEqual([
      'invoices.validation.ivaRateNotAllowed',
    ]);
    expect(errorsOf({ lines: [line({ ivaRate: 16 as never })] })['lines.0.ivaRate']).toEqual([
      'invoices.validation.ivaRateNotAllowed',
    ]);
  });

  it('checks the withholdings, their note and the adjustment list', () => {
    expect(errorsOf({ ivaWithheld: '-1', islrWithheld: 'x' })).toEqual({
      ivaWithheld: ['validation.money.invalid'],
      islrWithheld: ['validation.money.invalid'],
    });
    expect(errorsOf({ otherWithheld: '1.00', otherWithheldNote: ' ' }).otherWithheldNote).toEqual([
      'invoices.validation.otherWithheldNoteRequired',
    ]);
    expect(errorsOf({ otherWithheldNote: 'n'.repeat(201) }).otherWithheldNote).toEqual([
      'validation.tooLong',
    ]);
    const eleven = Array.from({ length: 11 }, () => ({ ivaRate: '16', adjustment: '0.01' }));
    expect(errorsOf({ taxAdjustments: eleven }).taxAdjustments).toEqual(['validation.tooLong']);
    expect(
      errorsOf({ taxAdjustments: [{ ivaRate: 'x', adjustment: '0.01' }] })[
        'taxAdjustments.0.ivaRate'
      ],
    ).toEqual(['validation.invalidOption']);
    expect(
      errorsOf({ taxAdjustments: [{ ivaRate: '16', adjustment: 'x' }] })[
        'taxAdjustments.0.adjustment'
      ],
    ).toEqual(['validation.money.invalid']);
    expect(errorsOf({ taxAdjustments: [{ ivaRate: '16', adjustment: '-0.01' }] })).toEqual({});
  });

  it('a non-array lines value is a required error, never a crash', () => {
    expect(errorsOf({ lines: 'nope' as never }).lines).toEqual(['validation.required']);
  });
});

describe('normalizeInvoiceInput', () => {
  it('trims texts, blanks optional ones to null, defaults the optional fields and rounds money', () => {
    const input: InvoiceInput = {
      ...invoiceInput({
        invoiceNumber: '  A-1 ',
        controlNumber: '   ',
        otherWithheldNote: '  nota ',
        lines: [
          {
            description: ' x ',
            unitPrice: '10',
            projectId: '',
            installmentId: null,
            ivaRate: null,
          },
        ],
      }),
    };
    expect(normalizeInvoiceInput(input)).toMatchObject({
      invoiceNumber: 'A-1',
      controlNumber: null,
      bcvRate: null,
      otherWithheldNote: 'nota',
      ivaWithheld: '0.00',
      isDraft: false,
      taxAdjustments: [],
      fileId: undefined,
      lines: [
        {
          description: 'x',
          projectId: null,
          installmentId: null,
          quantity: '1',
          unitPrice: '10.00',
          discount: '0.00',
          ivaRate: null,
        },
      ],
    });
  });
});

/** The invoice is read as usual the first `calls` times, then it is gone (a delete between read and lock). */
function vanishAfter(w: World, calls: number): void {
  const original = w.invoices.findById.bind(w.invoices);
  let count = 0;
  w.invoices.findById = async (id) => (++count <= calls ? original(id) : null);
}

describe('a row that disappears between the plan and the lock is NOT_FOUND', () => {
  const seeded = () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a', clientId: KAIROS }));
    return w;
  };

  it('on update, void, archive, issue, restore, attach and the overdue step', async () => {
    const update = seeded();
    vanishAfter(update, 2);
    expect(
      await rejection(
        update.update.execute(update.owner, { ...invoiceInput({ clientId: KAIROS }), id: 'inv_a' }),
      ),
    ).toMatchObject({ code: 'NOT_FOUND' });

    const voided = seeded();
    vanishAfter(voided, 2);
    expect(
      await rejection(voided.voidInvoice.execute(voided.owner, { id: 'inv_a', reason: 'x' })),
    ).toMatchObject({ code: 'NOT_FOUND' });

    const archived = seeded();
    vanishAfter(archived, 2);
    expect(
      await rejection(archived.archive.execute(archived.owner, { id: 'inv_a' })),
    ).toMatchObject({ code: 'NOT_FOUND' });

    const issued = seeded();
    vanishAfter(issued, 2);
    expect(await rejection(issued.issueDraft.execute(issued.owner, { id: 'inv_a' }))).toMatchObject(
      { code: 'NOT_FOUND' },
    );

    const attached = seeded();
    vanishAfter(attached, 1);
    expect(
      await rejection(attached.attachFile.execute(attached.owner, { id: 'inv_a', fileId: null })),
    ).toMatchObject({ code: 'NOT_FOUND' });

    const restored = createWorld();
    restored.invoices.seed(invoiceRecord({ id: 'inv_a', archivedAt: NOW }));
    vanishAfter(restored, 2);
    expect(await rejection(restored.restore.execute(restored.owner, 'inv_a'))).toMatchObject({
      code: 'NOT_FOUND',
    });

    const overdue = createWorld();
    overdue.invoices.seed(invoiceRecord({ id: 'inv_a', dueDate: '2026-10-01' }));
    vanishAfter(overdue, 1);
    expect(await overdue.markOverdue.execute(SYSTEM_ACTOR)).toEqual({ updated: 0, invoiceIds: [] });
  });
});

describe('the lock plan is verified after the locks', () => {
  it('a payment allocated between the read and the lock is a CONFLICT the caller retries', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a', clientId: KAIROS }));
    const original = w.invoices.liveAllocations.bind(w.invoices);
    let calls = 0;
    w.invoices.liveAllocations = async (id) =>
      ++calls === 1
        ? original(id)
        : [{ paymentId: 'pay_new', amountInvoiceCurrency: '1.00', paymentStatus: 'CONFIRMADO' }];
    expect(await rejection(w.issueDraft.execute(w.owner, { id: 'inv_a' }))).toMatchObject({
      code: 'CONFLICT',
    });
    expect(w.projector.calls).toEqual([]);
  });
});

describe('details of update, void and the files', () => {
  it('an edit keeps, replaces or detaches the file by what the input says', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a', clientId: KAIROS, fileId: 'file_pdf' }));
    const base = { ...invoiceInput({ clientId: KAIROS, invoiceNumber: 'KAI-0001' }), id: 'inv_a' };
    expect((await w.update.execute(w.owner, base)).fileId).toBe('file_pdf');
    expect(w.reservedFiles).toEqual([]);
    expect((await w.update.execute(w.owner, { ...base, fileId: null })).fileId).toBeNull();
    expect((await w.update.execute(w.owner, { ...base, fileId: 'file_pdf' })).fileId).toBe(
      'file_pdf',
    );
    expect(w.reservedFiles).toEqual(['file_pdf']);
  });

  it('an unexpected storage failure is not hidden as a validation error', async () => {
    const w = createWorld();
    await expect(w.create.execute(w.owner, invoiceInput({ fileId: 'file_boom' }))).rejects.toThrow(
      'storage down',
    );
    expect(w.invoices.all).toHaveLength(0);
  });

  it('the void reason is required, a string and at most 500 characters', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a' }));
    expect(
      (await rejection(w.voidInvoice.execute(w.owner, { id: 'inv_a', reason: undefined as never })))
        .fieldErrors,
    ).toEqual({
      reason: ['validation.required'],
    });
    expect(
      (await rejection(w.voidInvoice.execute(w.owner, { id: 'inv_a', reason: 'r'.repeat(501) })))
        .fieldErrors,
    ).toEqual({
      reason: ['validation.tooLong'],
    });
  });

  it('the detail is NOT_FOUND when the view is gone after the write (nothing is hidden)', async () => {
    const w = createWorld();
    w.invoices.view = async () => null;
    expect(await rejection(w.create.execute(w.owner, invoiceInput()))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('RecomputeInvoice and installments', () => {
  it('refreshes the installments of the lines it rewrites', async () => {
    const w = createWorld();
    w.invoices.seed(
      invoiceRecord({
        id: 'inv_a',
        clientId: KAIROS,
        lines: [
          { ...SEED_LINE, id: 'l1', installmentId: WEB_1, projectId: WEB },
          { ...SEED_LINE, id: 'l2', order: 1 },
        ],
        total: '232.00',
        subtotal: '200.00',
        taxBase: '200.00',
        ivaAmount: '32.00',
        receivable: '232.00',
        taxLines: [{ ivaRate: '16', taxBase: '200.00', ivaAmount: '32.00' }],
        balance: '232.00',
      }),
    );
    w.invoices.seedAllocation('inv_a', {
      paymentId: 'pay_a',
      amountInvoiceCurrency: '10.00',
      paymentStatus: 'CONFIRMADO',
    });
    await w.uow.run(() => w.recompute.execute('inv_a'));
    expect(w.recomputed).toEqual([[WEB_1]]);
  });

  it('writes nothing when nothing changed', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a' }));
    const before = await w.invoices.findById('inv_a');
    const out = await w.uow.run(() => w.recompute.execute('inv_a'));
    expect(out).toEqual(before);
    expect(w.recomputed).toEqual([]);
  });
});

describe('restore details', () => {
  const archived = (over: Parameters<typeof invoiceRecord>[0] = {}) =>
    invoiceRecord({ id: 'inv_arch', archivedAt: NOW, ...over });

  it('an archived voided invoice comes back voided and binds no installment', async () => {
    const w = createWorld();
    w.invoices.seed(
      archived({
        status: 'ANULADA',
        voidedAt: NOW,
        lines: [{ ...SEED_LINE, installmentId: WEB_1, projectId: WEB }],
      }),
    );
    w.invoices.seed(
      invoiceRecord({
        id: 'inv_other',
        invoiceNumber: 'O',
        lines: [{ ...SEED_LINE, id: 'o', installmentId: WEB_1, netAmount: '4000.00' }],
      }),
    );
    await w.restore.execute(w.owner, 'inv_arch');
    expect((await w.invoices.findById('inv_arch'))?.status).toBe('ANULADA');
  });

  it('an invoice without installment lines restores directly, and a vanished installment is skipped', async () => {
    const w = createWorld();
    w.invoices.seed(archived());
    await w.restore.execute(w.owner, 'inv_arch');
    const gone = createWorld();
    gone.invoices.seed(archived({ lines: [{ ...SEED_LINE, installmentId: 'ins_deleted' }] }));
    await gone.restore.execute(gone.owner, 'inv_arch');
    expect((await gone.invoices.findById('inv_arch'))?.archivedAt).toBeNull();
  });

  it('an archived client without a view still refuses with the message', async () => {
    const w = createWorld();
    w.invoices.seed(archived({ clientId: 'cli_gone' }));
    w.invoices.view = async () => null;
    const error = await rejection(w.restore.execute(w.owner, 'inv_arch'));
    expect(error).toMatchObject({ code: 'CONFLICT', message: 'trash.errors.clientArchived' });
    expect(error.entity).toBeUndefined();
  });

  it('refuses while the project of a line is archived, pointing at it', async () => {
    const w = createWorld();
    w.invoices.seed(archived({ lines: [{ ...SEED_LINE, projectId: 'prj_gone' }] }));
    const error = await rejection(w.restore.execute(w.owner, 'inv_arch'));
    expect(error).toMatchObject({
      code: 'CONFLICT',
      message: 'trash.errors.projectArchived',
      entity: { type: 'PROJECT', id: 'prj_gone' },
    });
    expect((await w.invoices.findById('inv_arch'))?.archivedAt).not.toBeNull();
  });

  it('a restored invoice past its due date is overdue again', async () => {
    const w = createWorld();
    w.invoices.seed(archived({ dueDate: '2026-09-01' }));
    await w.restore.execute(w.owner, 'inv_arch');
    expect((await w.invoices.findById('inv_arch'))?.status).toBe('VENCIDA');
  });
});

describe('the overdue step search entry', () => {
  it('keeps the search entry status in step with the invoice it marks', async () => {
    const w = createWorld();
    w.invoices.seed(invoiceRecord({ id: 'inv_a', dueDate: '2026-10-01' }));

    await w.markOverdue.execute(SYSTEM_ACTOR);

    expect(w.search.get('INVOICE', 'inv_a')).toMatchObject({ status: 'VENCIDA' });
  });
});

describe('the overdue step skips what is not a candidate at its lock', () => {
  it('leaves archived, draft, already overdue and not-yet-due invoices untouched', async () => {
    const w = createWorld();
    w.invoices.seed(
      invoiceRecord({ id: 'inv_arch', invoiceNumber: 'A', archivedAt: NOW, dueDate: '2026-01-01' }),
    );
    w.invoices.seed(
      invoiceRecord({
        id: 'inv_draft',
        invoiceNumber: 'B',
        isDraft: true,
        status: 'BORRADOR',
        dueDate: '2026-01-01',
      }),
    );
    w.invoices.seed(
      invoiceRecord({
        id: 'inv_late',
        invoiceNumber: 'C',
        status: 'VENCIDA',
        dueDate: '2026-01-01',
      }),
    );
    w.invoices.seed(invoiceRecord({ id: 'inv_future', invoiceNumber: 'D', dueDate: '2026-12-01' }));
    w.invoices.overdueIds = async () => ['inv_arch', 'inv_draft', 'inv_late', 'inv_future'];
    expect(await w.markOverdue.execute(SYSTEM_ACTOR)).toEqual({ updated: 0, invoiceIds: [] });
    expect(w.activity.entries).toHaveLength(0);
  });
});

describe('reads', () => {
  it('a billable installment that is already fully covered shows nothing left to bill', async () => {
    const w = createWorld();
    w.invoices.seedBillable({
      installment: { type: 'INSTALLMENT', id: WEB_1, label: 'Anticipo' },
      project: { type: 'PROJECT', id: WEB, label: 'Kairos Web' },
      kind: 'ANTICIPO',
      label: 'Anticipo',
      currency: 'USD',
      amount: '100.00',
      invoicedAmount: '100.00',
      dueDate: null,
    });
    const rows = await w.listBillable.execute(w.owner, KAIROS);
    expect(rows[0]?.remainingAmount).toBe('0.00');
    expect(LABS_1).toBeDefined();
  });

  it('the list maps every facet, and only the trash roles see archived rows', async () => {
    const w = createWorld();
    w.invoices.seed(
      invoiceRecord({
        id: 'inv_a',
        clientId: ZAFIRO,
        currency: 'VES',
        issueDate: '2026-10-05',
        lines: [{ ...SEED_LINE, projectId: WEB }],
      }),
    );
    w.invoices.seed(invoiceRecord({ id: 'inv_b', invoiceNumber: 'B', archivedAt: NOW }));
    const filters = {
      clientId: ZAFIRO,
      projectId: [WEB],
      currency: 'VES',
      tagId: ['tag_1'],
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
      status: ['EMITIDA'],
    };
    expect((await w.list.execute(w.owner, query({ filters }))).items.map((r) => r.id)).toEqual([
      'inv_a',
    ]);

    const denied = new ListInvoices(
      {
        can: (_user: unknown, action: string, resource: string) =>
          !(action === 'restore' && resource === 'trash'),
      } as never,
      w.invoices,
      new FixedClock(NOW),
    );
    expect(
      (await denied.execute(w.owner, query({ archived: 'only' }))).items.map((r) => r.id),
    ).toEqual(['inv_a']);
  });
});
