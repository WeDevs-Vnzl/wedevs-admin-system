// MOCK — accounts fixtures (data-rules.md §2). Seeded by the accounts module of H1-B3: three company accounts
// (Zelle USD, Binance USDT, a VES bank account), two partner movements, one adjustment and one transfer.
// Identifiers are stored already masked (C5). Balances and `balanceUsd` are derived by `derive-finance.ts`;
// movement and transfer USD snapshots are typed in here at the rate of their day (never recomputed, §9).
import type { AccountDTO, MovementDTO, TransferDTO } from "@/lib/validators/accounts";

const CREATED = "2026-01-02T12:00:00.000Z";
const PARTNER_ANDRES = { id: "usr_andres_molina", label: "Andrés Molina", type: "USER" } as const;
const PARTNER_VALERIA = { id: "usr_valeria_rojas", label: "Valeria Rojas", type: "USER" } as const;

export const accountFixtures: AccountDTO[] = [
  {
    id: "acc_zelle",
    name: "Zelle USD",
    type: "BILLETERA_DIGITAL",
    institution: "Zelle",
    currency: "USD",
    identifierMasked: "cobr…mail",
    holderName: "Empresa MOCK",
    openingBalance: "1000.00",
    openingDate: "2026-01-01",
    active: true,
    notes: null,
    balance: "0.00",
    balanceUsd: "0.00",
    createdAt: CREATED,
    updatedAt: CREATED,
  },
  {
    id: "acc_binance",
    name: "Binance USDT",
    type: "WALLET_CRIPTO",
    institution: "Binance",
    currency: "USDT",
    identifierMasked: "0x1a…9f3c",
    holderName: null,
    openingBalance: "0.00",
    openingDate: "2026-01-01",
    active: true,
    notes: "Billetera de MOCK para cobros en cripto.",
    balance: "0.00",
    balanceUsd: "0.00",
    createdAt: CREATED,
    updatedAt: CREATED,
  },
  {
    id: "acc_banco_ves",
    name: "Banco nacional VES",
    type: "BANCO_NACIONAL",
    institution: "Banco MOCK",
    currency: "VES",
    identifierMasked: "•••• 1234",
    holderName: "Empresa MOCK",
    openingBalance: "5000.00",
    openingDate: "2026-01-01",
    active: true,
    notes: null,
    balance: "0.00",
    balanceUsd: null,
    createdAt: CREATED,
    updatedAt: CREATED,
  },
  // The seeded payments (T7) and paid expenses (T8) land on these two, so the three accounts above keep the
  // balances their tests pin.
  {
    id: "acc_cobros_usd",
    name: "Zelle cobros USD",
    type: "BILLETERA_DIGITAL",
    institution: "Zelle",
    currency: "USD",
    identifierMasked: "fact…mail",
    holderName: "Empresa MOCK",
    openingBalance: "0.00",
    openingDate: "2026-01-01",
    active: true,
    notes: "Cuenta de MOCK que recibe los cobros de clientes.",
    balance: "0.00",
    balanceUsd: "0.00",
    createdAt: CREATED,
    updatedAt: CREATED,
  },
  {
    id: "acc_caja_ves",
    name: "Caja VES",
    type: "BANCO_NACIONAL",
    institution: "Banco MOCK",
    currency: "VES",
    identifierMasked: "•••• 5678",
    holderName: "Empresa MOCK",
    openingBalance: "3500.00",
    openingDate: "2026-01-01",
    active: true,
    notes: "Cuenta de MOCK que paga los gastos en bolívares.",
    balance: "0.00",
    balanceUsd: null,
    createdAt: CREATED,
    updatedAt: CREATED,
  },
];

export const movementFixtures: MovementDTO[] = [
  {
    id: "mov_aporte_andres",
    account: { id: "acc_zelle", label: "Zelle USD", type: "ACCOUNT" },
    type: "APORTE_CAPITAL",
    date: "2026-02-01",
    amount: "500.00",
    amountUsd: "500.00",
    partner: PARTNER_ANDRES,
    description: "Aporte inicial de capital (MOCK)",
    createdAt: CREATED,
  },
  {
    id: "mov_retiro_valeria",
    account: { id: "acc_zelle", label: "Zelle USD", type: "ACCOUNT" },
    type: "RETIRO_SOCIO",
    date: "2026-06-15",
    // Withdrawals are stored as a positive amount; the balance applies the sign (lib/finance, §9.7).
    amount: "200.00",
    amountUsd: "200.00",
    partner: PARTNER_VALERIA,
    description: "Retiro de socio (MOCK)",
    createdAt: CREATED,
  },
  {
    id: "mov_ajuste_ves",
    account: { id: "acc_banco_ves", label: "Banco nacional VES", type: "ACCOUNT" },
    type: "AJUSTE",
    date: "2026-07-01",
    // Adjustments are signed: a negative amount lowers the balance. USD snapshot at 36.50 VES per USD.
    amount: "-1500.00",
    amountUsd: "-41.10",
    partner: null,
    description: "Ajuste por comisión bancaria no registrada (MOCK)",
    createdAt: CREATED,
  },
];

export const transferFixtures: TransferDTO[] = [
  {
    id: "trf_zelle_binance",
    date: "2026-09-20",
    fromAccount: { id: "acc_zelle", label: "Zelle USD", type: "ACCOUNT" },
    toAccount: { id: "acc_binance", label: "Binance USDT", type: "ACCOUNT" },
    amountFrom: "100.00",
    amountTo: "99.00",
    feeAmount: "0.00",
    rate: "0.99000000",
    amountUsd: "100.00",
    reference: "TRX-MOCK-0001",
    notes: null,
    createdAt: CREATED,
  },
];
