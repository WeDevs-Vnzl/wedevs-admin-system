// ~60 technologies (PRD §10.4). [name, category, Simple Icons slug]; nameEn mirrors the brand name (Δ4).
export type SeedTechCategory =
  | 'LENGUAJE'
  | 'FRONTEND'
  | 'BACKEND'
  | 'BASE_DE_DATOS'
  | 'INFRAESTRUCTURA'
  | 'MOBILE'
  | 'IA'
  | 'TESTING'
  | 'HERRAMIENTA'
  | 'OTRO';

export interface TechnologySeed {
  name: string;
  nameEn: string;
  slug: string;
  category: SeedTechCategory;
  iconSlug: string;
}

/** `Next.js` -> `next-js`, `C#` -> `c-sharp`. */
export function slugifyTechnology(name: string): string {
  return name
    .toLowerCase()
    .replaceAll('#', '-sharp')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SOURCE: readonly (readonly [string, SeedTechCategory, string])[] = [
  ['TypeScript', 'LENGUAJE', 'typescript'],
  ['JavaScript', 'LENGUAJE', 'javascript'],
  ['Python', 'LENGUAJE', 'python'],
  ['PHP', 'LENGUAJE', 'php'],
  ['Go', 'LENGUAJE', 'go'],
  ['Rust', 'LENGUAJE', 'rust'],
  ['Java', 'LENGUAJE', 'openjdk'],
  ['Kotlin', 'LENGUAJE', 'kotlin'],
  ['Swift', 'LENGUAJE', 'swift'],
  ['C#', 'LENGUAJE', 'csharp'],
  ['React', 'FRONTEND', 'react'],
  ['Next.js', 'FRONTEND', 'nextdotjs'],
  ['Vue.js', 'FRONTEND', 'vuedotjs'],
  ['Nuxt', 'FRONTEND', 'nuxtdotjs'],
  ['Angular', 'FRONTEND', 'angular'],
  ['Svelte', 'FRONTEND', 'svelte'],
  ['Tailwind CSS', 'FRONTEND', 'tailwindcss'],
  ['Vite', 'FRONTEND', 'vite'],
  ['Node.js', 'BACKEND', 'nodedotjs'],
  ['NestJS', 'BACKEND', 'nestjs'],
  ['Express', 'BACKEND', 'express'],
  ['Laravel', 'BACKEND', 'laravel'],
  ['Django', 'BACKEND', 'django'],
  ['FastAPI', 'BACKEND', 'fastapi'],
  ['Spring Boot', 'BACKEND', 'springboot'],
  ['Hono', 'BACKEND', 'hono'],
  ['PostgreSQL', 'BASE_DE_DATOS', 'postgresql'],
  ['MySQL', 'BASE_DE_DATOS', 'mysql'],
  ['MongoDB', 'BASE_DE_DATOS', 'mongodb'],
  ['Redis', 'BASE_DE_DATOS', 'redis'],
  ['SQLite', 'BASE_DE_DATOS', 'sqlite'],
  ['Prisma', 'BASE_DE_DATOS', 'prisma'],
  ['Supabase', 'BASE_DE_DATOS', 'supabase'],
  ['Docker', 'INFRAESTRUCTURA', 'docker'],
  ['Kubernetes', 'INFRAESTRUCTURA', 'kubernetes'],
  ['AWS', 'INFRAESTRUCTURA', 'amazonaws'],
  ['Google Cloud', 'INFRAESTRUCTURA', 'googlecloud'],
  ['Netlify', 'INFRAESTRUCTURA', 'netlify'],
  ['Vercel', 'INFRAESTRUCTURA', 'vercel'],
  ['Cloudflare', 'INFRAESTRUCTURA', 'cloudflare'],
  ['Neon', 'INFRAESTRUCTURA', 'neon'],
  ['GitHub Actions', 'INFRAESTRUCTURA', 'githubactions'],
  ['React Native', 'MOBILE', 'react'],
  ['Flutter', 'MOBILE', 'flutter'],
  ['Expo', 'MOBILE', 'expo'],
  ['OpenAI API', 'IA', 'openai'],
  ['Claude', 'IA', 'anthropic'],
  ['LangChain', 'IA', 'langchain'],
  ['Vitest', 'TESTING', 'vitest'],
  ['Playwright', 'TESTING', 'playwright'],
  ['Jest', 'TESTING', 'jest'],
  ['Git', 'HERRAMIENTA', 'git'],
  ['GitHub', 'HERRAMIENTA', 'github'],
  ['Figma', 'HERRAMIENTA', 'figma'],
  ['Storybook', 'HERRAMIENTA', 'storybook'],
  ['Clerk', 'HERRAMIENTA', 'clerk'],
  ['Stripe', 'HERRAMIENTA', 'stripe'],
  ['Sentry', 'HERRAMIENTA', 'sentry'],
  ['GraphQL', 'OTRO', 'graphql'],
  ['WordPress', 'OTRO', 'wordpress'],
  ['Shopify', 'OTRO', 'shopify'],
];

export const TECHNOLOGIES: readonly TechnologySeed[] = SOURCE.map(([name, category, iconSlug]) => ({
  name,
  nameEn: name,
  slug: slugifyTechnology(name),
  category,
  iconSlug,
}));
