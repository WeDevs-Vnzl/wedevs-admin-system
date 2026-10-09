# WeDevs Core — sistema de gestión interna

Este archivo resume el proyecto y enlaza a las fuentes de verdad. No las sustituye:

- [`PRD-WeDevs-Core.md`](PRD-WeDevs-Core.md): producto, arquitectura, reglas de negocio y plan de entrega (F0–F5). Es la fuente de verdad.
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
| `src/`, `prisma/`, `netlify/` | La aplicación *(a partir de la fase F0)* |

## Estado

Setup de Orca listo. Siguiente paso: abrir el **lote 0** (reglas) con `wedevs-project-manager`. El planner redacta `.rules/` y el esqueleto de `TASK.md` a partir del PRD, y el usuario los aprueba antes de abrir la fase F0.
