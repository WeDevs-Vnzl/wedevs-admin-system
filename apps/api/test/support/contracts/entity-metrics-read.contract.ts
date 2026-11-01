import { beforeEach, describe, expect, it } from 'vitest';
import type { EntityMetricsReadPort } from '../../../src/modules/intelligence/application/ports/entity-metrics-read.port';
import type { ClientSeed, ProjectSeed } from '../fakes/in-memory-entity-metrics-read';

export interface EntityMetricsHarness {
  readonly port: EntityMetricsReadPort;
  addClient(seed: ClientSeed): Promise<void>;
  addProject(seed: ProjectSeed): Promise<void>;
}

/** Contract of `EntityMetricsReadPort` (DT-111, DT-170): the fake and the Prisma adapter both pass it. */
export function entityMetricsReadContract(
  name: string,
  factory: () => Promise<EntityMetricsHarness> | EntityMetricsHarness,
): void {
  describe(`EntityMetricsReadPort contract: ${name}`, () => {
    let h: EntityMetricsHarness;
    beforeEach(async () => {
      h = await factory();
    });

    describe('clients', () => {
      it('lists live clients by trade name with their metrics, zeros when the row is missing', async () => {
        const at = new Date('2026-06-02T10:00:00.000Z');
        await h.addClient({ id: 'c2', tradeName: 'Beta' });
        await h.addClient({
          id: 'c1',
          tradeName: 'Alfa',
          metrics: {
            invoicedUsd: '10.10',
            receivableUsd: '3.30',
            projectCount: 2,
            lastActivityAt: at,
          },
        });
        const rows = await h.port.clientRows();
        expect(rows.map((row) => row.clientId)).toEqual(['c1', 'c2']);
        expect(rows[0]).toMatchObject({
          code: 'CLI-c1',
          tradeName: 'Alfa',
          status: 'ACTIVO',
          invoicedUsd: '10.10',
          collectedUsd: '0.00',
          receivableUsd: '3.30',
          overdueUsd: '0.00',
          creditUsd: '0.00',
          projectCount: 2,
          lastActivityAt: at,
        });
        expect(rows[1]).toMatchObject({
          invoicedUsd: '0.00',
          projectCount: 0,
          lastActivityAt: null,
        });
      });

      it('never lists, ranks or counts an archived client', async () => {
        await h.addClient({ id: 'c1', tradeName: 'Alfa', metrics: { collectedUsd: '50.00' } });
        await h.addClient({
          id: 'c2',
          tradeName: 'Beta',
          archived: true,
          status: 'INACTIVO',
          metrics: { collectedUsd: '900.00' },
        });
        expect((await h.port.clientRows()).map((row) => row.clientId)).toEqual(['c1']);
        expect((await h.port.topClients('collected', 5)).map((row) => row.clientId)).toEqual([
          'c1',
        ]);
        expect((await h.port.clientCountsByStatus()).INACTIVO).toBe(0);
      });

      it('ranks by the chosen metric, leaves out zeros, breaks ties by name then id and honors the limit', async () => {
        await h.addClient({
          id: 'c1',
          tradeName: 'Alfa',
          metrics: { overdueUsd: '5.00', collectedUsd: '1.00' },
        });
        await h.addClient({ id: 'c3', tradeName: 'Gamma', metrics: { overdueUsd: '20.00' } });
        await h.addClient({ id: 'c2', tradeName: 'Beta', metrics: { overdueUsd: '20.00' } });
        await h.addClient({ id: 'c4', tradeName: 'Delta' });
        expect((await h.port.topClients('overdue', 10)).map((row) => row.clientId)).toEqual([
          'c2',
          'c3',
          'c1',
        ]);
        expect((await h.port.topClients('overdue', 2)).map((row) => row.clientId)).toEqual([
          'c2',
          'c3',
        ]);
        expect((await h.port.topClients('collected', 10)).map((row) => row.clientId)).toEqual([
          'c1',
        ]);
        expect(await h.port.topClients('invoiced', 10)).toEqual([]);
        expect(await h.port.topClients('receivable', 0)).toEqual([]);
      });

      it('compares ranking values as numbers, not as text', async () => {
        await h.addClient({ id: 'c1', tradeName: 'Alfa', metrics: { invoicedUsd: '9.00' } });
        await h.addClient({ id: 'c2', tradeName: 'Beta', metrics: { invoicedUsd: '100.00' } });
        expect((await h.port.topClients('invoiced', 5)).map((row) => row.clientId)).toEqual([
          'c2',
          'c1',
        ]);
      });

      it('counts live clients by status with every status present', async () => {
        await h.addClient({ id: 'c1', tradeName: 'A', status: 'ACTIVO' });
        await h.addClient({ id: 'c2', tradeName: 'B', status: 'ACTIVO' });
        await h.addClient({ id: 'c3', tradeName: 'C', status: 'PROSPECTO' });
        expect(await h.port.clientCountsByStatus()).toEqual({
          PROSPECTO: 1,
          ACTIVO: 2,
          INACTIVO: 0,
        });
      });
    });

    describe('projects', () => {
      it('lists live projects by name, zeros when the row is missing, marginPercent on read', async () => {
        await h.addProject({
          id: 'p1',
          name: 'Zeta',
          metrics: { collectedUsd: '300.00', marginUsd: '100.00', contractedUsd: '500.00' },
        });
        await h.addProject({ id: 'p2', name: 'Alfa' });
        const rows = await h.port.projectRows();
        expect(rows.map((row) => row.projectId)).toEqual(['p2', 'p1']);
        expect(rows[0]).toMatchObject({
          code: 'PRJ-p2',
          status: 'EN_CURSO',
          collectedUsd: '0.00',
          marginUsd: '0.00',
          marginPercent: null,
        });
        expect(rows[1]).toMatchObject({ contractedUsd: '500.00', marginPercent: '33.33' });
      });

      it('computes marginPercent from the stored columns, negative margins included, and rounds half up', async () => {
        await h.addProject({
          id: 'p1',
          name: 'A',
          metrics: { collectedUsd: '200.00', marginUsd: '-50.00' },
        });
        await h.addProject({
          id: 'p2',
          name: 'B',
          metrics: { collectedUsd: '3.00', marginUsd: '1.00' },
        });
        await h.addProject({
          id: 'p3',
          name: 'C',
          metrics: { collectedUsd: '8.00', marginUsd: '1.00' },
        });
        const byId = Object.fromEntries(
          (await h.port.projectRows()).map((row) => [row.projectId, row.marginPercent]),
        );
        expect(byId).toEqual({ p1: '-25.00', p2: '33.33', p3: '12.50' });
      });

      it('never lists, ranks or counts an archived project', async () => {
        await h.addProject({ id: 'p1', name: 'A', metrics: { toInvoiceUsd: '10.00' } });
        await h.addProject({
          id: 'p2',
          name: 'B',
          archived: true,
          status: 'CANCELADO',
          metrics: { toInvoiceUsd: '99.00' },
        });
        expect((await h.port.projectRows()).map((row) => row.projectId)).toEqual(['p1']);
        expect((await h.port.topProjects('toInvoice', 5)).map((row) => row.projectId)).toEqual([
          'p1',
        ]);
        expect((await h.port.projectCountsByStatus()).CANCELADO).toBe(0);
      });

      it('ranks by metric, only above zero for margin, ties by name then id', async () => {
        await h.addProject({
          id: 'p1',
          name: 'A',
          metrics: { marginUsd: '-5.00', receivableUsd: '1.00' },
        });
        await h.addProject({
          id: 'p2',
          name: 'B',
          metrics: { marginUsd: '30.00', receivableUsd: '1.00' },
        });
        await h.addProject({ id: 'p3', name: 'C', metrics: { marginUsd: '4.00' } });
        expect((await h.port.topProjects('margin', 10)).map((row) => row.projectId)).toEqual([
          'p2',
          'p3',
        ]);
        expect((await h.port.topProjects('receivable', 10)).map((row) => row.projectId)).toEqual([
          'p1',
          'p2',
        ]);
        expect((await h.port.topProjects('margin', 1)).map((row) => row.projectId)).toEqual(['p2']);
        expect(await h.port.topProjects('invoiced', 10)).toEqual([]);
      });

      it('counts live projects by status with every status present', async () => {
        await h.addProject({ id: 'p1', name: 'A', status: 'EN_CURSO' });
        await h.addProject({ id: 'p2', name: 'B', status: 'MANTENIMIENTO' });
        await h.addProject({ id: 'p3', name: 'C', status: 'MANTENIMIENTO' });
        expect(await h.port.projectCountsByStatus()).toEqual({
          PROPUESTA: 0,
          EN_CURSO: 1,
          PAUSADO: 0,
          ENTREGADO: 0,
          MANTENIMIENTO: 2,
          CANCELADO: 0,
        });
      });
    });
  });
}
