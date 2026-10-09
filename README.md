# WeDevs Core — sistema de gestión interna

Este archivo resume el proyecto y enlaza a las fuentes de verdad. No las sustituye:

- [`PRD-WeDevs-Core.md`](PRD-WeDevs-Core.md): producto, arquitectura, reglas de negocio y alcance. Es la fuente de verdad (el orden de entrega lo sustituye DU-01: dos hitos, ver `.rules/decisions.md`).
- [`orca-workflow.md`](orca-workflow.md): cómo trabajan los agentes de Orca.
- `TASK.md`: lotes, olas, tareas y avance. *(lo crea el planner en el lote 0)*

## Qué es

El sistema interno de WeDevs para clientes, proyectos, facturas, pagos, cuentas, gastos, documentos y notas, con portal público de documentos, vista de grafo, reportes y KPI. Es un monolito Next.js (App Router) con Prisma sobre Neon, Clerk y Netlify (PRD §6).

## Mapa del repo

| Ruta | Qué es |
|---|---|
| `PRD-WeDevs-Core.md` | PRD (español) |
| `resources/wireframes/`, `resources/example/` | Referencia visual: wireframes y maquetas HTML |
| `orca-workflow.md` | Topología, roles y modelos, tipos de lote, ciclo, herramientas locales |
| `.rules/ADE/` | Reglas de proceso: fases y aprobaciones, salvaguardas, modelos |
| `.rules/*.md` | Reglas operativas derivadas del PRD *(las escribe el planner en el lote 0)* |
| `.claude/agents/wedevs-*.md` | La flota: project-manager, planner, developer, code-reviewer, tester |
| `src/`, `prisma/`, `netlify/` | La aplicación *(a partir del lote H1-B1)* |

## Estado

Lote 0 (reglas) en revisión. Entrega en dos hitos: **Hito 1**, UI completa con datos mock y ciclo de correcciones; **Hito 2**, bloques de funcionalidad verificados con deploy preview. Siguiente lote: **H1-B1** (andamiaje, kit shadcn, layout, i18n/tema, capa mock).
