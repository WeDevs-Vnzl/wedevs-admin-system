# WeDevs Admin System

Sistema interno de WeDevs para clientes, proyectos, facturas, pagos, cuentas, gastos, documentos y notas, con portal público de documentos, vista de grafo, reportes y KPI. Es un monolito Next.js (App Router).

**Estado:** Hito 1 — UI completa sobre datos mock (sin base de datos ni autenticación real). El Hito 2 incorpora Prisma sobre Neon, Clerk y el deploy en Netlify.

## Requisitos

- Node 24 (`.nvmrc`)
- bun (versión fijada en `packageManager` de `package.json`)

## Comandos

| Comando | Qué hace |
|---|---|
| `bun install --frozen-lockfile` | Instala las dependencias |
| `bun run dev` | Servidor de desarrollo |
| `bun run build` / `bun run start` | Build de producción y servidor |
| `bun run lint` / `bun run typecheck` | ESLint y TypeScript |
| `bun run test` / `bun run test:coverage` | Pruebas unitarias (Vitest) |
| `bun run test:e2e` | Pruebas E2E (Playwright) contra la app en marcha |
| `bun run i18n:check` | Paridad de claves entre `es` y `en` |

## Estructura

| Ruta | Qué es |
|---|---|
| `src/app/` | Rutas (App Router) |
| `src/features/` | Módulos de negocio: componentes, acciones y consultas |
| `src/components/` | Kit de UI (shadcn) y patrones compartidos |
| `src/lib/` | Validadores, dinero, fechas, finanzas y utilidades |
| `src/mocks/` | Capa de datos mock del Hito 1 |
| `src/config/`, `src/hooks/` | Navegación y hooks compartidos |
| `src/server/` | Código solo de servidor (sesión, permisos, portal) |
| `src/i18n/` | Configuración y mensajes (`es`, `en`) |
| `tests/` | Pruebas E2E y configuración de pruebas |
| `scripts/` | Scripts de mantenimiento (`check-i18n`) |

## Variables de entorno

Ver `.env.example`. En producción el portal público no arranca sin `SHARE_UNLOCK_SECRET` y `SHARE_IP_SALT`.

## Deploy

Cada push a `main` despliega a producción en Netlify con `.github/workflows/deploy.yml` (también se puede lanzar a mano con *Run workflow*). El workflow corre lint y typecheck, y luego `netlify deploy --build --prod` con la CLI; el build usa las variables de entorno configuradas en el sitio de Netlify.

Configuración única:

1. En el sitio de Netlify, desactivar los builds propios desde Git (*Site configuration → Build & deploy → Stop builds*) para no desplegar dos veces.
2. En el repositorio de GitHub, crear los secrets `NETLIFY_AUTH_TOKEN` (token personal de Netlify) y `NETLIFY_SITE_ID` (*Project ID* del sitio).
