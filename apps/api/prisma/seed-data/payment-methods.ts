export interface PaymentMethodSeed {
  code: string;
  name: string;
  nameEn: string;
  requiresReference: boolean;
  suggestsIgtf: boolean;
}

export const PAYMENT_METHODS: readonly PaymentMethodSeed[] = [
  {
    code: 'TRANSFERENCIA_NACIONAL',
    name: 'Transferencia nacional',
    nameEn: 'Domestic transfer',
    requiresReference: true,
    suggestsIgtf: false,
  },
  {
    code: 'PAGO_MOVIL',
    name: 'Pago Móvil',
    nameEn: 'Pago Móvil (mobile payment)',
    requiresReference: true,
    suggestsIgtf: false,
  },
  {
    code: 'TRANSFERENCIA_INTERNACIONAL',
    name: 'Transferencia internacional',
    nameEn: 'International transfer',
    requiresReference: true,
    suggestsIgtf: false,
  },
  { code: 'ZELLE', name: 'Zelle', nameEn: 'Zelle', requiresReference: true, suggestsIgtf: true },
  { code: 'ZINLI', name: 'Zinli', nameEn: 'Zinli', requiresReference: true, suggestsIgtf: true },
  { code: 'PAYPAL', name: 'PayPal', nameEn: 'PayPal', requiresReference: true, suggestsIgtf: true },
  {
    code: 'USDT_CRIPTO',
    name: 'USDT / Cripto',
    nameEn: 'USDT / Crypto',
    requiresReference: true,
    suggestsIgtf: true,
  },
  {
    code: 'EFECTIVO_USD',
    name: 'Efectivo USD',
    nameEn: 'Cash USD',
    requiresReference: false,
    suggestsIgtf: true,
  },
  {
    code: 'EFECTIVO_VES',
    name: 'Efectivo VES',
    nameEn: 'Cash VES',
    requiresReference: false,
    suggestsIgtf: false,
  },
  { code: 'OTRO', name: 'Otro', nameEn: 'Other', requiresReference: false, suggestsIgtf: false },
];
