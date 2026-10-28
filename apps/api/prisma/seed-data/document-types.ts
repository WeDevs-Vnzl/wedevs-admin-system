// PRD §8.9.1. Ids are stable natural keys (the tables have no unique business column).
export type SeedDocumentFormat = 'MARKDOWN' | 'ARCHIVO' | 'ENLACE';

export interface DocumentCategorySeed {
  id: string;
  name: string;
  nameEn: string;
  color: string;
  order: number;
}

export interface DocumentTypeSeed {
  id: string;
  categoryId: string;
  name: string;
  nameEn: string;
  defaultFormat: SeedDocumentFormat;
  requiresSignature: boolean;
  hasExpiration: boolean;
}

export const DOCUMENT_CATEGORIES: readonly DocumentCategorySeed[] = [
  { id: 'dcat_legal', name: 'Legal', nameEn: 'Legal', color: '#6d28d9', order: 0 },
  { id: 'dcat_comercial', name: 'Comercial', nameEn: 'Commercial', color: '#0369a1', order: 1 },
  { id: 'dcat_tecnico', name: 'Técnico', nameEn: 'Technical', color: '#047857', order: 2 },
  { id: 'dcat_operativo', name: 'Operativo', nameEn: 'Operations', color: '#b45309', order: 3 },
  { id: 'dcat_financiero', name: 'Financiero', nameEn: 'Finance', color: '#be123c', order: 4 },
];

const type = (
  category: string,
  key: string,
  name: string,
  nameEn: string,
  defaultFormat: SeedDocumentFormat,
  flags: { requiresSignature?: boolean; hasExpiration?: boolean } = {},
): DocumentTypeSeed => ({
  id: `dtyp_${key}`,
  categoryId: `dcat_${category}`,
  name,
  nameEn,
  defaultFormat,
  requiresSignature: flags.requiresSignature ?? false,
  hasExpiration: flags.hasExpiration ?? false,
});

export const DOCUMENT_TYPES: readonly DocumentTypeSeed[] = [
  type('legal', 'contrato_servicios', 'Contrato de servicios', 'Service agreement', 'ARCHIVO', {
    requiresSignature: true,
    hasExpiration: true,
  }),
  type(
    'legal',
    'nda',
    'Acuerdo de confidencialidad (NDA)',
    'Non-disclosure agreement (NDA)',
    'ARCHIVO',
    { requiresSignature: true, hasExpiration: true },
  ),
  type('legal', 'adenda', 'Adenda', 'Addendum', 'ARCHIVO', { requiresSignature: true }),
  type('legal', 'acta_entrega', 'Acta de entrega', 'Delivery certificate', 'ARCHIVO', {
    requiresSignature: true,
  }),
  type(
    'legal',
    'cesion_pi',
    'Cesión de propiedad intelectual',
    'Intellectual property assignment',
    'ARCHIVO',
    { requiresSignature: true },
  ),
  type('comercial', 'propuesta', 'Propuesta comercial', 'Commercial proposal', 'ARCHIVO', {
    hasExpiration: true,
  }),
  type('comercial', 'cotizacion', 'Cotización', 'Quote', 'ARCHIVO', { hasExpiration: true }),
  type('tecnico', 'prd', 'PRD', 'PRD', 'MARKDOWN'),
  type('tecnico', 'tsd', 'TSD', 'TSD', 'MARKDOWN'),
  type('tecnico', 'roadmap', 'Roadmap', 'Roadmap', 'MARKDOWN'),
  type('tecnico', 'arquitectura', 'Arquitectura', 'Architecture', 'MARKDOWN'),
  type('tecnico', 'manual_usuario', 'Manual de usuario', 'User manual', 'MARKDOWN'),
  type('operativo', 'minuta', 'Minuta de reunión', 'Meeting minutes', 'MARKDOWN'),
  type(
    'operativo',
    'credenciales',
    'Credenciales (enlace al gestor de contraseñas)',
    'Credentials (password manager link)',
    'ENLACE',
  ),
  type('operativo', 'onboarding', 'Onboarding', 'Onboarding', 'MARKDOWN'),
  type(
    'financiero',
    'comprobante_retencion',
    'Comprobante de retención',
    'Withholding certificate',
    'ARCHIVO',
  ),
  type('financiero', 'estado_cuenta', 'Estado de cuenta', 'Account statement', 'ARCHIVO'),
];
