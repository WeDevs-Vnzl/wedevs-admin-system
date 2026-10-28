// PRD §8.8: two-level tree. Ids are stable natural keys.
export interface ExpenseCategorySeed {
  id: string;
  name: string;
  nameEn: string;
  color: string | null;
  parentId: string | null;
}

const root = (key: string, name: string, nameEn: string, color: string): ExpenseCategorySeed => ({
  id: `ecat_${key}`,
  name,
  nameEn,
  color,
  parentId: null,
});

const child = (parent: string, key: string, name: string, nameEn: string): ExpenseCategorySeed => ({
  id: `ecat_${key}`,
  name,
  nameEn,
  color: null,
  parentId: `ecat_${parent}`,
});

// Parents come before their children (the seed upserts in order).
export const EXPENSE_CATEGORIES: readonly ExpenseCategorySeed[] = [
  root('infraestructura', 'Infraestructura', 'Infrastructure', '#0369a1'),
  child('infraestructura', 'hosting', 'Hosting', 'Hosting'),
  child('infraestructura', 'bases_de_datos', 'Bases de datos', 'Databases'),
  child('infraestructura', 'almacenamiento', 'Almacenamiento y CDN', 'Storage and CDN'),
  root('software_saas', 'Software y SaaS', 'Software and SaaS', '#6d28d9'),
  child('software_saas', 'diseno', 'Herramientas de diseño', 'Design tools'),
  child('software_saas', 'gestion_proyectos', 'Gestión de proyectos', 'Project management'),
  child('software_saas', 'comunicacion', 'Comunicación', 'Communication'),
  root('ia', 'IA', 'AI', '#047857'),
  child('ia', 'apis_modelos', 'APIs de modelos', 'Model APIs'),
  child('ia', 'suscripciones_ia', 'Suscripciones de IA', 'AI subscriptions'),
  root('dominios', 'Dominios', 'Domains', '#b45309'),
  root('freelancers', 'Freelancers', 'Freelancers', '#be123c'),
  child('freelancers', 'freelancers_desarrollo', 'Desarrollo', 'Development'),
  child('freelancers', 'freelancers_diseno', 'Diseño', 'Design'),
  root('comisiones_impuestos', 'Comisiones e impuestos', 'Fees and taxes', '#475569'),
  child('comisiones_impuestos', 'comisiones_bancarias', 'Comisiones bancarias', 'Bank fees'),
  child('comisiones_impuestos', 'impuestos', 'Impuestos', 'Taxes'),
  root('oficina', 'Oficina', 'Office', '#0f766e'),
  root('marketing', 'Marketing', 'Marketing', '#c2410c'),
  root('legal_contable', 'Legal y contable', 'Legal and accounting', '#4338ca'),
  root('otros', 'Otros', 'Other', '#64748b'),
];
