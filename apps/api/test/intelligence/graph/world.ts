import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { UserRole } from '../../../src/shared/domain/enums';
import { ExpandNode } from '../../../src/modules/intelligence/application/use-cases/graph/expand-node.use-case';
import { GetEntityGraph } from '../../../src/modules/intelligence/application/use-cases/graph/get-entity-graph.use-case';
import { GetGlobalGraph } from '../../../src/modules/intelligence/application/use-cases/graph/get-global-graph.use-case';
import { InMemoryGraphRead } from './in-memory-graph-read';

export const userOf = (role: UserRole): CurrentUser => ({
  userId: `usr_${role.toLowerCase()}`,
  clerkId: `clerk_${role.toLowerCase()}`,
  role,
  email: `${role.toLowerCase()}@example.test`,
  name: role,
});

/** A small studio: two clients sharing a project, with every kind of neighbour. */
export function buildWorld() {
  const read = new InMemoryGraphRead();
  const kairos = read.add('CLIENT', 'cli_kairos', {
    label: 'Kairos',
    code: 'CLI-1',
    status: 'ACTIVO',
    meta: { kind: 'EMPRESA', country: 'VE', receivableUsd: '120.00' },
    date: '2026-01-10',
    tagIds: ['tag_prio'],
  });
  const mochima = read.add('CLIENT', 'cli_mochima', {
    label: 'Hotel Mochima',
    code: 'CLI-2',
    status: 'INACTIVO',
    date: '2026-02-10',
    tagIds: [],
  });
  const archivedClient = read.add('CLIENT', 'cli_old', {
    label: 'Viejo',
    status: 'ACTIVO',
    date: '2025-01-01',
    tagIds: [],
  });
  read.archive(archivedClient);
  const archivedContact = read.add('CONTACT', 'con_old', {
    label: 'Zoe',
    date: '2025-01-02',
    tagIds: [],
  });
  read.archive(archivedContact);
  const contact = read.add('CONTACT', 'con_ana', { label: 'Ana', date: '2026-01-11', tagIds: [] });
  const app = read.add('PROJECT', 'pry_app', {
    label: 'App',
    code: 'PRY-1',
    status: 'EN_CURSO',
    date: '2026-07-05',
    tagIds: ['tag_prio'],
    technologyIds: ['tec_next'],
  });
  const erp = read.add('PROJECT', 'pry_erp', {
    label: 'ERP',
    status: 'ENTREGADO',
    date: '2026-03-01',
    tagIds: [],
    technologyIds: [],
  });
  const invoice = read.add('INVOICE', 'inv_1', {
    label: 'F-001',
    code: 'FAC-1',
    status: 'EMITIDA',
    meta: { currency: 'USD', total: '100.00', balance: '100.00', dueDate: '2026-08-01' },
    date: '2026-07-01',
    tagIds: [],
  });
  const payment = read.add('PAYMENT', 'pay_1', {
    label: 'PAG-1',
    status: 'CONFIRMADO',
    date: '2026-07-10',
    tagIds: [],
  });
  const account = read.add('ACCOUNT', 'acc_1', {
    label: 'Banesco',
    date: '2026-01-01',
    tagIds: null,
  });
  const expense = read.add('EXPENSE', 'exp_1', {
    label: 'Hosting',
    status: 'PAGADO',
    date: '2026-07-02',
    tagIds: [],
  });
  const doc = read.add('DOCUMENT', 'doc_1', {
    label: 'Contrato',
    status: 'VIGENTE',
    date: '2026-01-12',
    tagIds: [],
  });
  const note = read.add('NOTE', 'not_1', { label: 'Llamada', date: '2026-01-13', tagIds: [] });
  const tag = read.add('TAG', 'tag_prio', { label: 'Prioritario', tagIds: null });
  const tech = read.add('TECHNOLOGY', 'tec_next', { label: 'Next.js', tagIds: null });

  read.link(kairos, contact, 'contacto');
  read.link(kairos, app, 'participa', 'Dueño');
  read.link(mochima, app, 'participa');
  read.link(kairos, erp, 'participa');
  read.link(kairos, invoice, 'facturado_a');
  read.link(app, invoice, 'incluido_en');
  read.link(kairos, payment, 'pago');
  read.link(payment, invoice, 'paga', '100.00');
  read.link(payment, account, 'acreditado_en');
  read.link(expense, account, 'pagado_desde');
  read.link(expense, app, 'imputado_a');
  read.link(doc, kairos, 'adjunto_a');
  read.link(doc, app, 'adjunto_a');
  read.link(note, kairos, 'anotado_en');
  read.link(kairos, tag, 'etiquetado');
  read.link(app, tag, 'etiquetado');
  read.link(app, tech, 'usa');
  read.link(kairos, archivedContact, 'contacto');

  const authorization = new MatrixAuthorization();
  return {
    read,
    refs: {
      kairos,
      mochima,
      archivedClient,
      archivedContact,
      contact,
      app,
      erp,
      invoice,
      payment,
      account,
      expense,
      doc,
      note,
      tag,
      tech,
    },
    getEntityGraph: new GetEntityGraph(authorization, read),
    expandNode: new ExpandNode(authorization, read),
    getGlobalGraph: new GetGlobalGraph(authorization, read),
  };
}
