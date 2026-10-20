# WeDevs Core — sistema de gestión interna

Este archivo resume el proyecto y enlaza a las fuentes de verdad. No las sustituye:

- [`docs/PRD-WeDevs-Core.md`](docs/PRD-WeDevs-Core.md): producto, arquitectura, reglas de negocio y alcance. Es la fuente de verdad (el orden de entrega lo sustituye DU-01: dos hitos, ver `docs/rules/decisions.md`).
- [`docs/orca-workflow.md`](docs/orca-workflow.md): cómo trabajan los agentes de Orca.
- `docs/TASK.md`: lotes, olas, tareas y avance. *(lo crea el planner en el lote 0)*

## Qué es

El sistema interno de WeDevs para clientes, proyectos, facturas, pagos, cuentas, gastos, documentos y notas, con portal público de documentos, vista de grafo, reportes y KPI. Es un monolito Next.js (App Router) con Prisma sobre Neon, Clerk y Netlify (PRD §6).

## Mapa del repo

| Ruta | Qué es |
|---|---|
| `docs/PRD-WeDevs-Core.md` | PRD (español) |
| `resources/wireframes/` | Wireframes originales |
| `resources/example/` | Maquetas HTML de referencia |
| `docs/orca-workflow.md` | Topología, roles y modelos, tipos de lote, ciclo, herramientas locales |
| `docs/rules/ADE/` | Reglas de proceso: fases y aprobaciones, salvaguardas, modelos |
| `docs/rules/*.md` | Reglas operativas derivadas del PRD *(las escribe el planner en el lote 0)* |
| `.claude/agents/wedevs-*.md` | La flota: project-manager, planner, developer, code-reviewer, tester |
| `src/`, `tests/`, `scripts/` | La aplicación Next.js; los configs y los comandos `bun` viven en la raíz del repo |

## Estado

Lote 0 (reglas) en revisión. Entrega en dos hitos: **Hito 1**, UI completa con datos mock y ciclo de correcciones; **Hito 2**, bloques de funcionalidad verificados con deploy preview. Siguiente lote: **H1-B1** (andamiaje, kit shadcn, layout, i18n/tema, capa mock).
