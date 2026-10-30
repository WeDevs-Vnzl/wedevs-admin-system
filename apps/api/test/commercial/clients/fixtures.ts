import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { UserRole } from '../../../src/shared/domain/enums';
import type { ClientRecord } from '../../../src/modules/commercial/domain/client';
import type { ContactRecord } from '../../../src/modules/commercial/domain/contact';

export const STAMP = new Date('2026-01-15T12:00:00.000Z');

export function userOf(role: UserRole): CurrentUser {
  return {
    userId: `usr_${role.toLowerCase()}`,
    clerkId: `clerk_${role.toLowerCase()}`,
    role,
    email: `${role.toLowerCase()}@example.test`,
    name: role,
  };
}

let counter = 0;

export function clientRecord(over: Partial<ClientRecord> = {}): ClientRecord {
  counter += 1;
  return {
    id: `cli_${counter}`,
    code: `CLI-${String(counter).padStart(4, '0')}`,
    kind: 'EMPRESA',
    tradeName: `Cliente ${counter}`,
    legalName: `Cliente ${counter} C.A.`,
    taxId: `J-4000${String(counter).padStart(4, '0')}-1`,
    country: 'VE',
    address: 'Av. Principal, Caracas',
    phone: '+584121234567',
    email: null,
    website: null,
    status: 'PROSPECTO',
    activatedAt: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    deletedAt: null,
    ...over,
  };
}

export function contactRecord(clientId: string, over: Partial<ContactRecord> = {}): ContactRecord {
  counter += 1;
  return {
    id: `con_${counter}`,
    clientId,
    fullName: `Contacto ${counter}`,
    position: null,
    email: `contacto${counter}@example.test`,
    phone: null,
    isPrimary: false,
    createdAt: STAMP,
    updatedAt: STAMP,
    deletedAt: null,
    ...over,
  };
}
