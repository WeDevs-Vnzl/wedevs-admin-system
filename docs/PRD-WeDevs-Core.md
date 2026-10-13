# PRD — WeDevs Core · Sistema de Gestión Interna

> Nombre provisional del producto: **WeDevs Core**

| Campo | Valor |
|---|---|
| Versión del documento | 1.0 (borrador para revisión) |
| Fecha | 8 de octubre de 2026 |
| Autores | Socios fundadores de WeDevs |
| Estado | En revisión |
| Alcance | MVP |
| Stack | Next.js (App Router) · shadcn/ui · Prisma · Neon (Postgres + Object Storage) · Clerk · Netlify |

---

## Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Objetivos y métricas de éxito](#2-objetivos-y-métricas-de-éxito)
3. [Alcance](#3-alcance)
4. [Usuarios, roles y permisos](#4-usuarios-roles-y-permisos)
5. [Glosario](#5-glosario)
6. [Arquitectura y decisiones técnicas](#6-arquitectura-y-decisiones-técnicas)
7. [Patrones transversales de interfaz](#7-patrones-transversales-de-interfaz)
8. [Módulos funcionales](#8-módulos-funcionales)
9. [Reglas de negocio monetarias y fiscales](#9-reglas-de-negocio-monetarias-y-fiscales)
10. [Modelo de datos (Prisma)](#10-modelo-de-datos-prisma)
11. [Mapa de rutas](#11-mapa-de-rutas)
12. [Capa de servicios y Server Actions](#12-capa-de-servicios-y-server-actions)
13. [Historias de usuario y criterios de aceptación](#13-historias-de-usuario-y-criterios-de-aceptación)
14. [Requisitos no funcionales](#14-requisitos-no-funcionales)
15. [Riesgos y mitigaciones](#15-riesgos-y-mitigaciones)
16. [Plan de entrega del MVP](#16-plan-de-entrega-del-mvp)
17. [Supuestos y preguntas abiertas](#17-supuestos-y-preguntas-abiertas)

---

## 1. Resumen ejecutivo

WeDevs es un estudio de desarrollo de software que opera en Venezuela. Factura en varias monedas (USD, VES, EUR y otras) y cobra por métodos muy distintos entre sí: transferencias nacionales e internacionales, Pago Móvil, Zelle, Zinli, PayPal, USDT y efectivo.

**WeDevs Core** es el sistema interno que centraliza esta información:

- clientes y sus contactos;
- proyectos, con sus enlaces, stack y esquema de cobro;
- facturas, que se registran aquí aunque se emitan en otro sistema;
- pagos y su conciliación contra facturas;
- cuentas de la empresa y gastos operativos;
- documentos (legales, técnicos y operativos) con versionado;
- notas con texto enriquecido.

El sistema ofrece además tres capacidades transversales:

- **Vista de grafo.** Muestra las relaciones entre registros, tanto desde el detalle de cada uno como en un grafo global del estudio.
- **Portal público.** Permite compartir documentos con clientes mediante un enlace exacto, sin cuenta.
- **Reportes y KPI.** Ofrece una vista financiera y operativa del estudio.

El MVP se construye como un monolito Next.js con Server Actions. La lógica de dominio queda aislada en una capa de servicios para poder extraerla a un backend independiente en la siguiente etapa.

---

## 2. Objetivos y métricas de éxito

### 2.1 Objetivos de negocio

| # | Objetivo |
|---|---|
| O1 | Tener una única fuente de verdad sobre clientes, proyectos, documentos y dinero del estudio. |
| O2 | Saber en todo momento cuánto se ha facturado, cuánto se ha cobrado, cuánto se debe y cuánto se ha gastado, expresado en USD. |
| O3 | No perder nunca un contrato, NDA o documento técnico, ni su versión vigente. |
| O4 | Compartir documentos con clientes de forma profesional y trazable. |
| O5 | Sentar una base de datos y de arquitectura que soporte crecer en usuarios, en módulos (gestión de proyectos) y en infraestructura (backend separado). |

### 2.2 Métricas de éxito del MVP

| Métrica | Meta |
|---|---|
| Clientes, proyectos y documentos activos migrados al sistema | 100 % en las 4 semanas posteriores al lanzamiento |
| Facturas y pagos registrados en el sistema frente a los emitidos o recibidos | 100 % a partir del lanzamiento |
| Diferencia entre el saldo de cada cuenta en el sistema y el saldo real al cierre de mes | ≤ 1 % |
| Tiempo para registrar un pago y conciliarlo con su factura | < 2 minutos |
| Tiempo para encontrar cualquier registro mediante la búsqueda global | < 10 segundos |
| Contratos o NDA vencidos sin alerta previa | 0 |

---

## 3. Alcance

### 3.1 Incluido en el MVP

1. Autenticación con Clerk (solo por invitación) y roles preparados para ampliarse.
2. Clientes (persona o empresa) y sus contactos.
3. Proyectos con relación N:M con clientes, enlaces agrupables, stack tomado de un catálogo y esquema de cobro (anticipos, cuotas, hitos y cobros recurrentes).
4. Facturas registradas (no emitidas por el sistema) con PDF adjunto, multiproyecto, multimoneda, con IVA y retenciones.
5. Pagos con asignación N:M a facturas, comprobante adjunto, IGTF y comisiones.
6. Cuentas de la empresa (bancos y wallets), transferencias entre cuentas y movimientos de socios.
7. Gastos operativos, puntuales y recurrentes, imputables a proyectos.
8. Documentos con categorías y tipos configurables, tres formatos (markdown editable en el sistema, archivo o enlace), versionado, estados, firma, vencimiento y alertas, y vínculo con varias entidades.
9. Notas con texto enriquecido, autor, fecha, etiquetas y adjuntos, vinculables a cualquier entidad.
10. Portal público de documentos accesible solo mediante enlace exacto.
11. Vista de grafo por registro (expandible) y grafo global.
12. Dashboard general, overview por módulo y módulo de reportes y KPI.
13. Búsqueda global (Cmd+K) y etiquetas transversales.
14. Tablas con filtros, ordenamiento, paginación, columnas configurables y exportación a CSV.
15. Registro de actividad completo.
16. Borrado lógico con papelera y restauración.
17. Interfaz en español e inglés, con modo claro y oscuro.
18. Alertas dentro de la aplicación.
19. Catálogos configurables: tecnologías, tipos y categorías de documento, categorías de gasto, métodos de pago, monedas, tasas de cambio y parámetros fiscales.

### 3.2 Fuera del alcance del MVP

| Funcionalidad | Fase prevista |
|---|---|
| Gestión de proyectos (tareas, hitos operativos, horas, asignación de equipo) | Fase 2 |
| Notificaciones por email | Fase 2 |
| Emisión de facturas en el sistema (numeración fiscal, PDF propio, factura electrónica SENIAT) | Por definir |
| Integración con la API de GitHub | Por definir |
| Generación de PDF en el servidor a partir de markdown | Fase 2. En el MVP se usa la impresión del navegador. |
| Firma electrónica dentro del sistema | Por definir |
| Backend independiente (API REST) | Fase 2 |
| Obtención automática de la tasa BCV | Fase 2. En el MVP la tasa se carga manualmente, con autocompletado desde la última tasa registrada. |
| Cálculo de diferencial cambiario contable | Por definir |
| Pipeline comercial o CRM de leads | No previsto |

---

## 4. Usuarios, roles y permisos

### 4.1 Perfiles

| Perfil | Descripción | MVP |
|---|---|---|
| Socio (Owner) | Socio fundador con control total, incluida la gestión de usuarios y la configuración. | Sí, 2 usuarios |
| Admin | Control total sobre los datos, sin gestión de usuarios. | Modelo preparado |
| Colaborador (Member) | Acceso a proyectos, documentos y notas, sin finanzas. | Modelo preparado |
| Lector (Viewer) | Solo lectura sobre los módulos que se le habiliten. | Modelo preparado |
| Visitante del portal | Persona externa con un enlace de portal. No se autentica. | Sí |

### 4.2 Autenticación

- **Proveedor.** Clerk, con el registro restringido: solo se entra por invitación o lista de correos permitidos.
- **Métodos de acceso.** Google OAuth y email con código. Se recomienda activar MFA en Clerk para los socios.
- **Sincronización.** Un webhook de Clerk (`user.created`, `user.updated`, `user.deleted`, `session.created`) mantiene una tabla local `User`. Esa tabla es la que usan las claves foráneas, la autoría y el registro de actividad.
- **Roles.** El rol se guarda en la base de datos local, que es la fuente de verdad para la autorización. Se replica en `publicMetadata` de Clerk solo para mostrarlo en la interfaz.
- **Rutas públicas.** El middleware de Clerk protege todas las rutas, salvo `/sign-in`, `/s/[token]` (portal) y `/api/webhooks/*`.

### 4.3 Matriz de permisos

Leyenda: C = crear · R = leer · U = editar · D = borrado lógico.

| Recurso | Owner | Admin | Member | Viewer |
|---|---|---|---|---|
| Clientes y contactos | CRUD | CRUD | R | R |
| Proyectos | CRUD | CRUD | RU | R |
| Esquema de cobro | CRUD | CRUD | – | – |
| Facturas, pagos, cuentas y gastos | CRUD | CRUD | – | – |
| Documentos | CRUD | CRUD | CRU | R |
| Compartir en el portal | ✓ | ✓ | – | – |
| Notas | CRUD | CRUD | CRUD (D solo en las propias) | R |
| Reportes y KPI | ✓ | ✓ | – | – |
| Registro de actividad | ✓ | ✓ | – | – |
| Configuración y catálogos | ✓ | ✓ | – | – |
| Usuarios y roles | ✓ | – | – | – |
| Papelera (restaurar) | ✓ | ✓ | – | – |

La autorización se implementa en la capa de servicios mediante una función central `can(user, action, resource)`. **Todas** las Server Actions la invocan antes de ejecutar nada. La interfaz oculta las acciones no permitidas, pero eso es cosmético: la regla se aplica en el servidor.

---

## 5. Glosario

| Término | Definición |
|---|---|
| Entidad principal | Registro de primer nivel con detalle propio: Cliente, Proyecto, Factura, Pago, Gasto, Cuenta, Documento o Nota. |
| Esquema de cobro (Billing Plan) | Acuerdo económico de un proyecto: modelo, monto contratado, cuotas y cobros recurrentes. |
| Cuota (Installment) | Monto que se espera facturar en un momento o al cumplirse una condición. Puede ser anticipo, hito, cuota, pago final, periodo recurrente o ajuste. |
| Cobro recurrente | Plantilla que genera cuotas periódicas, por ejemplo mantenimiento mensual o una iguala. |
| Asignación (Allocation) | Porción de un pago que se aplica a una factura concreta. |
| Monto por cobrar | Total de la factura menos las retenciones que aplica el cliente. |
| Saldo a favor | Parte de un pago que todavía no se ha asignado a ninguna factura. |
| Tasa (usdRate) | Unidades de la moneda de la transacción por cada 1 USD. Para USD vale 1. Por ejemplo, VES = 755,16 significa que 1 USD equivale a 755,16 Bs. |
| Snapshot USD | Equivalente en USD calculado y guardado en el momento del registro. No se recalcula después. |
| Enlace de portal (Share Link) | URL con un token aleatorio que da acceso de solo lectura a un conjunto de documentos. |
| Borrado lógico | Marcar un registro con `deletedAt` en lugar de eliminarlo. Se puede restaurar desde la papelera. |

---

## 6. Arquitectura y decisiones técnicas

### 6.1 Diagrama lógico

```
┌───────────────────────────── Netlify ─────────────────────────────┐
│  Next.js (App Router)                                              │
│  ┌──────────────┐   ┌──────────────────┐   ┌───────────────────┐  │
│  │ RSC / Pages  │──▶│  Server Actions  │──▶│  Services (dominio)│  │
│  │ shadcn/ui    │   │  auth·zod·revalid│   │  sin imports Next  │  │
│  └──────────────┘   └──────────────────┘   └─────────┬─────────┘  │
│  ┌──────────────┐                                    │            │
│  │ /s/[token]   │──── portal público (sin Clerk) ────┤            │
│  └──────────────┘                                    │            │
│  Scheduled Functions (cron diario) ──────────────────┤            │
└──────────────────────────────────────────────────────┼────────────┘
                                                       │
        ┌──────────────┐     ┌─────────────────────────┼─────────┐
        │    Clerk     │     │  Neon                   ▼         │
        │ (auth, MFA)  │     │  Postgres (Prisma) · Object Storage│
        └──────────────┘     └───────────────────────────────────┘
```

### 6.2 Decisiones técnicas

| Área | Decisión | Motivo |
|---|---|---|
| Framework | Next.js con App Router, React Server Components y Server Actions | Requisito del stack. Las Server Actions permiten iterar rápido en el MVP. |
| Lenguaje | TypeScript en modo `strict` | Seguridad de tipos de extremo a extremo. |
| UI | shadcn/ui + Tailwind CSS + lucide-react | Requisito del stack. Componentes propios y personalizables. |
| Formularios | react-hook-form + Zod (`@hookform/resolvers`) | Los esquemas Zod se comparten entre cliente y servidor. |
| Tablas | TanStack Table con el patrón *data-table* de shadcn, paginado en el servidor | Filtros, ordenamiento y columnas configurables. |
| Estado en la URL | `nuqs` | Filtros, orden y página quedan en la URL, así que se pueden compartir. |
| ORM | Prisma 7 (generador `prisma-client`, `prisma.config.ts`) con el *driver adapter* de Neon (`@prisma/adapter-neon`) y conexión *pooled* | Requisito del stack. Compatible con funciones serverless. |
| Base de datos | Neon Postgres, con las extensiones `pg_trgm` y `unaccent` | Requisito del stack. Búsqueda tolerante a acentos y errores tipográficos. |
| Archivos | Neon Object Storage (compatible con S3), detrás de una interfaz `StorageProvider` | El servicio está en **beta**. La interfaz permite migrar a Cloudflare R2 o S3 cambiando solo variables de entorno (ver §15). |
| Subida de archivos | URL prefirmada: el navegador sube directo al bucket | Evita el límite de tamaño de payload de las funciones de Netlify. |
| Autenticación | Clerk | Decisión del equipo. |
| Grafo | React Flow (`@xyflow/react`), con `elkjs` para layouts jerárquico y radial y `d3-force` para el layout de fuerzas | Es la opción con mejor resultado visual: los nodos son componentes React (con shadcn, badges y avatares), e incluye minimapa, controles y aristas animadas. Ver §8.12. |
| Texto enriquecido (notas) | Tiptap | Editor *headless* que encaja con el estilo de shadcn. Se guarda como JSON y como texto plano para la búsqueda. |
| Editor markdown (documentos) | CodeMirror 6 con vista previa usando `react-markdown`, `remark-gfm` y `rehype-sanitize` | Edición y vista previa lado a lado, con salida sanitizada (importante para el portal). |
| Gráficos | Componente *Chart* de shadcn (sobre Recharts) | Coherente con el sistema de diseño. |
| Internacionalización | `next-intl`, idioma guardado en cookie y en la preferencia del usuario, sin prefijo en las rutas | Interfaz bilingüe ES/EN. |
| Tema | `next-themes` (claro, oscuro y sistema) | Requisito. |
| Dinero | `Decimal` de Prisma + `decimal.js`. **Nunca** `float`. | Precisión monetaria. |
| Fechas | Se guardan en UTC. Las fechas de negocio usan `@db.Date`. La zona de presentación es `America/Caracas` (`date-fns-tz`). | Operación en Venezuela. |
| Tareas programadas | Netlify Scheduled Functions | Vencimientos y generación de recurrencias. |
| Notificaciones en pantalla | `sonner` (toasts) | Estándar de shadcn. |
| Observabilidad | Sentry (errores) + logs de Netlify | Diagnóstico en producción. |
| Pruebas | Vitest (unitarias y de servicios) + Playwright (end-to-end) | El cálculo monetario es crítico. |

### 6.3 Estructura de carpetas

```
src/
├── app/
│   ├── (auth)/sign-in/[[...sign-in]]/page.tsx
│   ├── (app)/                      # layout autenticado: sidebar, topbar, Cmd+K
│   │   ├── dashboard/
│   │   ├── clients/ projects/ invoices/ payments/ expenses/
│   │   ├── accounts/ documents/ notes/ graph/ reports/ activity/
│   │   └── settings/
│   ├── s/[token]/                  # portal público
│   └── api/
│       ├── webhooks/clerk/route.ts
│       └── files/[id]/download/route.ts
├── features/<modulo>/
│   ├── components/                 # tablas, formularios, vistas de detalle
│   ├── actions.ts                  # Server Actions (delgadas)
│   └── queries.ts                  # lecturas para RSC
├── server/
│   ├── services/<modulo>.service.ts   # lógica de dominio pura
│   ├── db/ (prisma client, extensión de soft delete, transacciones)
│   ├── auth/ (getCurrentUser, can())
│   ├── activity/ (logActivity)
│   ├── storage/ (StorageProvider, neon-storage.ts)
│   ├── search/ (indexación)
│   └── jobs/ (tareas programadas)
├── lib/
│   ├── validators/<modulo>.ts      # esquemas Zod compartidos
│   ├── money.ts  rates.ts  dates.ts
│   └── utils.ts
├── i18n/ (messages/es.json, messages/en.json)
└── components/ui/                  # shadcn
netlify/functions/                  # funciones programadas
prisma/ (schema.prisma, migrations/, seed.ts)
```

### 6.4 Preparación para un backend separado

El monolito Next.js vivirá solo durante el MVP. Para que la extracción posterior sea barata, se aplican estas reglas desde el primer día:

1. **Las Server Actions son adaptadores.** Cada una sigue la misma secuencia: obtener el usuario, verificar permisos con `can()`, validar con Zod, llamar al servicio, invocar `revalidatePath` y devolver un resultado.
2. **Los servicios no importan nada de Next.js.** Reciben `ctx = { db, user, now }` y devuelven DTOs tipados. Se pueden montar sin cambios en Hono, NestJS o Fastify.
3. **Los esquemas Zod de `lib/validators` son el contrato.** Servirán para generar OpenAPI (`zod-to-openapi`) cuando exista la API REST.
4. **Los componentes nunca acceden a Prisma.** Las lecturas pasan por `queries.ts`, que a su vez llama a los servicios.
5. **Los efectos secundarios viven en el servicio y dentro de la misma transacción.** Esto incluye el registro de actividad, el índice de búsqueda y el recálculo de saldos.
6. **El almacenamiento y la autenticación están detrás de interfaces** (`StorageProvider` y `AuthContext`).

### 6.5 Entornos

| Entorno | Netlify | Neon |
|---|---|---|
| Producción | Rama `main` | Rama `main`, base de datos y bucket |
| Preview | Deploy preview por cada PR | Rama de Neon por cada PR (la base de datos y el bucket se ramifican juntos) |
| Local | `netlify dev` / `next dev` | Rama `dev` personal |

Variables de entorno: `DATABASE_URL` (pooled), `DIRECT_URL`, `CLERK_*`, `CLERK_WEBHOOK_SECRET`, `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `SHARE_IP_SALT`, `SENTRY_DSN`, `APP_URL`.

---

## 7. Patrones transversales de interfaz

### 7.1 Navegación

Cada módulo sigue el patrón **Overview → Tabla → Detalle**. Las altas y ediciones se hacen en una página de formulario a la que se llega desde la tabla o desde el detalle.

```
/clients            → Overview del módulo (KPI del módulo, recientes, alertas, accesos rápidos)
/clients/list       → Tabla completa
/clients/new        → Formulario de alta
/clients/[id]       → Detalle (pestañas)
/clients/[id]/edit  → Formulario de edición
/clients/[id]/graph → Vista de grafo del registro
```

**Layout de la aplicación:**

- **Sidebar** colapsable, agrupada en tres secciones:
  - *Comercial:* Clientes, Proyectos.
  - *Finanzas:* Facturas, Pagos, Gastos, Cuentas.
  - *Conocimiento:* Documentos, Notas.
  - *Análisis:* Grafo global, Reportes, Actividad.
  - *Configuración.*
- **Topbar** con breadcrumbs, el disparador de búsqueda (Cmd+K), la campana de alertas, el selector de idioma, el selector de tema y el menú de usuario de Clerk.

### 7.2 Vista de detalle (estructura común)

- **Encabezado:** código (por ejemplo `CLI-0007`), nombre, badge de estado, etiquetas y acciones (Editar, Ver grafo, Compartir si aplica, Más → Archivar). El alternador **Detalle | Grafo** está siempre visible.
- **Panel lateral** con datos clave y métricas del registro, como el saldo por cobrar.
- **Pestañas** que dependen de la entidad. Siempre incluyen *Notas*, *Documentos* y *Actividad*.
- Cada pestaña relacionada muestra una mini-tabla y la acción "+ Nuevo", que precarga el vínculo con el registro actual.

### 7.3 Tablas

Todas las tablas del sistema tienen:

- **Paginación en el servidor**, de 25, 50 o 100 filas.
- **Ordenamiento** por cualquier columna ordenable.
- **Filtros por faceta:** estado, etiquetas, moneda, rango de fechas, cliente, proyecto y tecnología, según la entidad. Además, una búsqueda de texto con *debounce*.
- **Columnas configurables:** visibilidad, orden y ancho. Se guardan por usuario y por tabla en `UserPreference`.
- **Selección múltiple** con acciones masivas (etiquetar, archivar, exportar).
- **Exportación a CSV** de todo el conjunto filtrado, con un máximo de 10 000 filas. Usa codificación UTF-8 con BOM para que Excel la abra bien, respeta las columnas visibles y deja la acción en el registro de actividad.
- **Estado vacío** con una llamada a la acción, y **skeletons** durante la carga.
- La opción "Mostrar archivados" (solo para Owner y Admin).

### 7.4 Formularios

- Validación con Zod en el cliente y de nuevo en el servidor.
- Aviso si el usuario intenta salir con cambios sin guardar.
- Los campos de dinero usan un componente `MoneyInput` (moneda + monto) y muestran el equivalente en USD en vivo.
- Los campos de tasa usan un componente `RateInput`, que se precarga con la tasa registrada para esa fecha y moneda y se puede editar.
- Los selectores relacionales son *comboboxes* con búsqueda asíncrona y la opción "Crear nuevo" en línea.
- Los campos de fecha muestran la fecha en la zona `America/Caracas`.

### 7.5 Etiquetas

- Son globales: nombre más color.
- Se pueden asignar a clientes, contactos, proyectos, facturas, pagos, gastos, documentos y notas.
- Se gestionan desde Configuración y también se pueden crear en línea.
- Sirven como filtro en las tablas, la búsqueda y el grafo.

### 7.6 Búsqueda global (Cmd+K)

- Usa el componente `Command` de shadcn y se abre con `⌘K` o `Ctrl+K`.
- Los resultados se agrupan por tipo de entidad, mostrando icono, código, título, subtítulo y estado.
- Permite filtrar por prefijo: `c:` clientes, `p:` proyectos, `f:` facturas, `d:` documentos, `n:` notas.
- Incluye acciones rápidas ("Nuevo cliente", "Registrar pago", "Ir a Reportes…") y los registros visitados recientemente.
- Por debajo usa un índice `SearchEntry` (ver §10) con `tsvector` (configuración `simple` + `unaccent`) y trigramas para tolerar errores tipográficos. El tiempo de respuesta objetivo es < 200 ms en p95.

### 7.7 Borrado lógico y papelera

- Las entidades principales tienen los campos `deletedAt` y `deletedById`. Una extensión del cliente de Prisma excluye los registros borrados por defecto.
- En **Configuración → Papelera** se listan los registros archivados con filtros, y desde ahí se restauran.
- **Bloqueos de integridad:**
  - Una factura con pagos asignados no se puede archivar; hay que **anularla**.
  - Un cliente con proyectos o facturas activas no se puede archivar sin confirmación explícita, que además archiva sus contactos.
  - Una cuenta con movimientos no se puede archivar; solo se desactiva.
- La purga definitiva no existe en el MVP.

### 7.8 Internacionalización y tema

- Todos los textos de la interfaz salen de `messages/{es,en}.json`. El idioma predeterminado es el español.
- Los catálogos configurables (tipos de documento, categorías y otros) guardan `name` (ES) y `nameEn` (EN, opcional; si falta, se usa el ES).
- Números, monedas y fechas se formatean según el idioma con `Intl`.
- Los datos que ingresan los usuarios no se traducen.
- El tema puede ser claro, oscuro o el del sistema, y se guarda por usuario.

### 7.9 Alertas en la aplicación

La campana de la topbar muestra un contador y un panel con las alertas. Las alertas se calculan en vivo con consultas; no se generan con un job. Cada usuario puede descartarlas o posponerlas, y eso se guarda en `AlertDismissal`.

| Alerta | Condición |
|---|---|
| Factura vencida | `status = VENCIDA` |
| Factura por vencer | `dueDate` en los próximos 7 días y saldo > 0 |
| Cuota por facturar | Cuota `PENDIENTE` con `dueDate` en ≤ 7 días o ya vencida |
| Documento por vencer | `expiresAt` dentro de los `alertDaysBefore` días configurados (30 por defecto) |
| Documento vencido | `status = VENCIDO` |
| Gasto recurrente pendiente | Gasto generado en estado `PENDIENTE` con `dueDate` en ≤ 5 días o ya vencido |
| Pago por verificar | Pago `PENDIENTE_VERIFICACION` con más de 2 días de antigüedad |
| Saldo a favor sin asignar | Pago confirmado con `unallocatedAmount > 0` y más de 15 días de antigüedad |
| Tasa faltante | No hay tasa VES registrada para hoy (solo en días hábiles) |

Las mismas alertas aparecen en el dashboard y en el overview de cada módulo.

---

## 8. Módulos funcionales

### 8.1 Dashboard general

**Ruta:** `/dashboard`. Todas las cifras se expresan en USD a partir de los snapshots guardados en cada registro.

**Tarjetas KPI.** Cada una muestra la comparación con el periodo anterior.

| Tarjeta | Cálculo |
|---|---|
| Cobrado en el mes | Suma de `amountUsd` de las asignaciones de pagos confirmados con fecha en el mes |
| Facturado en el mes | Suma de `totalUsd` de las facturas emitidas en el mes (excluye anuladas y borradores) |
| Cuentas por cobrar | Suma de los saldos en USD de las facturas `EMITIDA`, `PARCIAL` o `VENCIDA`. Se muestra aparte el monto vencido. |
| Gastos del mes | Suma de `amountUsd` de los gastos `PAGADO` del mes |
| Resultado del mes | Cobrado menos gastos |
| Saldo total en cuentas | Suma de los saldos de las cuentas activas, convertidos a USD con la última tasa |
| MRR | Suma de los cobros recurrentes `ACTIVO`, normalizados a mes |
| Proyectos activos | Proyectos con estado `EN_CURSO` o `MANTENIMIENTO` |

**Paneles:**

- Ingresos frente a gastos de los últimos 12 meses (gráfico de barras).
- Facturas vencidas y por vencer (top 5).
- Cuotas por facturar (próximos 30 días).
- Documentos por vencer (próximos 30 días).
- Gastos recurrentes próximos.
- Actividad reciente (últimos 15 eventos).

### 8.2 Clientes y contactos

#### Campos del cliente

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| Código | texto | auto | `CLI-0001`, secuencial e inmutable |
| Tipo | enum `PERSONA` · `EMPRESA` | sí | |
| Nombre comercial | texto | sí | Nombre visible en todo el sistema |
| Razón social | texto | sí para `EMPRESA` | En `PERSONA` es el nombre legal |
| Identificador fiscal | texto | sí | RIF (V, E, J, G, P), NIT, Tax ID, etc. Se valida su formato cuando el país es VE. |
| País | ISO 3166-1 alfa-2 | sí | Combobox con banderas |
| Dirección | texto multilínea | sí | |
| Teléfono | texto (E.164) | sí | Componente de teléfono internacional |
| Email | email | no | Email general de la empresa |
| Sitio web | url | no | |
| Estado | enum `PROSPECTO` · `ACTIVO` · `INACTIVO` | sí | Por defecto `PROSPECTO` |
| Etiquetas | Tag[] | no | |

**Reglas:**

- La combinación (identificador fiscal + país) es única entre los clientes no archivados. Al intentar duplicarla, el sistema avisa y ofrece abrir el registro existente.
- El cambio de estado es manual. Al registrar la primera factura de un cliente `PROSPECTO`, el sistema **sugiere** pasarlo a `ACTIVO`.

#### Contacto (entidad dependiente del cliente)

| Campo | Tipo | Obligatorio |
|---|---|---|
| Nombre completo | texto | sí |
| Cargo | texto | no |
| Email | email | no (al menos un medio de contacto) |
| Teléfono | texto | no (al menos un medio de contacto) |
| Contacto principal | booleano | no. Solo puede haber uno por cliente. |

Los contactos se gestionan dentro del detalle del cliente, en una pestaña con tabla y modal de alta o edición. No tienen tabla global en el MVP, pero sí aparecen en la búsqueda global y en el grafo.

#### Vistas

- **Overview** (`/clients`): conteo por estado, top 5 de clientes por ingresos cobrados en los últimos 12 meses, clientes con saldo vencido y clientes creados recientemente.
- **Tabla** (`/clients/list`). Columnas: código, nombre comercial, tipo, país, estado, número de proyectos, total facturado (USD), saldo por cobrar (USD), etiquetas y última actividad.
- **Detalle** (`/clients/[id]`). Pestañas:
  - **Resumen:** datos, contactos destacados y métricas (total facturado, total cobrado, saldo, saldo a favor y número de proyectos).
  - **Contactos.**
  - **Proyectos.**
  - **Facturas.**
  - **Pagos.**
  - **Documentos.**
  - **Notas.**
  - **Actividad.**
  - **Grafo.**

### 8.3 Proyectos

#### Campos

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| Código | texto | auto | `PRY-0001` |
| Nombre | texto | sí | |
| Clientes | Client[] (N:M) | sí, al menos 1 | Sin cliente principal. Cada vínculo admite un rol opcional en texto libre, por ejemplo "Contratante" o "Usuario final". |
| Resumen | texto (≤ 280 caracteres) | sí | Aparece en tablas y en el grafo |
| Descripción (generalidades) | texto enriquecido (Tiptap) | no | |
| Estado | enum `PROPUESTA` · `EN_CURSO` · `PAUSADO` · `ENTREGADO` · `MANTENIMIENTO` · `CANCELADO` | sí | Por defecto `PROPUESTA` |
| Fecha de inicio | fecha | no | Obligatoria al pasar a `EN_CURSO` |
| Fecha estimada de entrega | fecha | no | |
| Fecha real de entrega | fecha | no | Obligatoria al pasar a `ENTREGADO` |
| Stack | Technology[] | no | Solo valores del catálogo |
| Enlaces | ProjectLink[] | no | Ver más abajo |
| Esquema de cobro | BillingPlan | no al crear | Recomendado. Ver §8.4. |
| Etiquetas | Tag[] | no | |

#### Transiciones de estado

```
PROPUESTA ──▶ EN_CURSO ──▶ ENTREGADO ──▶ MANTENIMIENTO
    │            │  ▲            │              │
    │            ▼  │            │              │
    │          PAUSADO           │              │
    └────────────┴───────────────┴──────────────┴──▶ CANCELADO
```

- Pasar a `EN_CURSO` sin un esquema de cobro definido muestra una advertencia, pero no bloquea.
- Pasar a `MANTENIMIENTO` sugiere crear un cobro recurrente si el proyecto no tiene ninguno activo.
- Pasar a `CANCELADO` pide confirmación y ofrece cancelar las cuotas `PENDIENTE` y finalizar los cobros recurrentes.
- Cada transición queda en el registro de actividad como `STATUS_CHANGE`.

#### Enlaces del proyecto

Los enlaces son una lista agrupable de elementos (solo URLs, sin integraciones). Cada elemento tiene:

- `grupo` (enum): `REPOSITORIO` · `ENTORNO` (producción, staging, desarrollo) · `DISENO` (Figma) · `GESTION` (Jira, Linear, Notion) · `DOCUMENTACION` · `INFRAESTRUCTURA` (Netlify, Neon, AWS, dominios) · `COMUNICACION` (Slack, Discord) · `OTRO`.
- `etiqueta`, por ejemplo "Frontend repo" o "Staging".
- `url`.
- `orden`, ajustable arrastrando el elemento dentro de su grupo.

La interfaz agrupa los enlaces en tarjetas colapsables y muestra el favicon del dominio. Cada enlace tiene botones para abrirlo en otra pestaña y para copiar la URL. Un proyecto puede tener cualquier cantidad de repositorios.

#### Stack (catálogo de tecnologías)

- Cada tecnología tiene: nombre (único), slug, categoría (`LENGUAJE`, `FRONTEND`, `BACKEND`, `BASE_DE_DATOS`, `INFRAESTRUCTURA`, `MOBILE`, `IA`, `TESTING`, `HERRAMIENTA`, `OTRO`), icono opcional (slug de Simple Icons), color y estado activo o inactivo.
- El catálogo se gestiona en **Configuración → Tecnologías**. Una tecnología en uso no se puede borrar; solo se desactiva.
- En el formulario de proyecto, el stack se elige con un multiselect agrupado por categoría. No se aceptan valores libres.
- La tabla de proyectos y el grafo global permiten filtrar por tecnología.
- La semilla inicial incluye unas 60 tecnologías comunes (Next.js, React, Node.js, NestJS, PostgreSQL, Prisma, Tailwind, Flutter, React Native, Python, Docker, AWS, Netlify, Vercel, OpenAI, Anthropic, entre otras).

#### Vistas

- **Overview** (`/projects`): proyectos por estado (gráfico), entregas próximas, proyectos sin esquema de cobro, top de tecnologías usadas y proyectos con mayor saldo por facturar.
- **Tabla.** Columnas: código, nombre, clientes, estado, inicio, entrega estimada, stack (iconos), valor contratado (USD), facturado, cobrado, por facturar y etiquetas.
- **Detalle.** Pestañas:
  - **Resumen:** generalidades, clientes, fechas y stack.
  - **Enlaces.**
  - **Cobro:** esquema, cuotas, recurrentes y resumen financiero.
  - **Facturas.**
  - **Gastos.**
  - **Documentos.**
  - **Notas.**
  - **Actividad.**
  - **Grafo.**

### 8.4 Esquema de cobro del proyecto

Este módulo define **qué se va a cobrar, cuánto y cuándo**. Es la base para alertar de las cuotas pendientes de facturar y para medir la salud financiera de cada proyecto.

#### 8.4.1 Modelos de cobro

| Modelo | Descripción | Componentes |
|---|---|---|
| `PRECIO_FIJO` | Monto cerrado dividido en cuotas: anticipo, hitos y pago final | Monto contratado + cuotas |
| `RECURRENTE` | Iguala, mantenimiento o soporte periódico sin monto cerrado | Uno o más cobros recurrentes |
| `MIXTO` | Desarrollo a precio fijo más mantenimiento posterior | Cuotas + cobros recurrentes |

El modelo por horas queda fuera hasta que exista el registro de horas (Fase 2). Ver §17.

#### 8.4.2 Cuotas (installments)

| Campo | Notas |
|---|---|
| Tipo | `ANTICIPO` · `HITO` · `CUOTA` · `FINAL` · `RECURRENTE` (generada por un cobro recurrente) · `AJUSTE` (cambio de alcance, adenda) |
| Etiqueta | Por ejemplo "Anticipo 40 %" o "Entrega MVP" |
| Monto y moneda | Por defecto, la moneda del esquema |
| Porcentaje | Opcional. Si se indica, el monto se calcula como porcentaje del monto contratado. |
| Fecha estimada | Opcional |
| Condición | Texto opcional, por ejemplo "Al aprobar los diseños" |
| Orden | |
| Estado | Se calcula: `PENDIENTE` · `FACTURADA` · `COBRADA_PARCIAL` · `COBRADA` · `CANCELADA` |

**Plantillas rápidas** al crear el esquema:

- 100 % anticipado.
- 50 / 50.
- 40 / 30 / 30.
- 30 / 40 / 30.
- 3 cuotas iguales.
- Personalizado.

Al elegir una plantilla se generan las cuotas, que luego se pueden editar libremente.

**Reglas:**

- **Validación de suma.** La suma de las cuotas no `AJUSTE` debe igualar el monto contratado (con tolerancia de ±0,01). Si no coincide, se muestra un aviso persistente en el detalle del proyecto, pero no se bloquea el guardado.
- **Bloqueo de cuotas facturadas.** Una cuota facturada (con al menos una línea de factura que la referencia) no puede cambiar de monto ni de moneda. Solo se puede editar la etiqueta. Si el alcance cambia, se registra una cuota `AJUSTE`, que puede ser positiva o negativa, y se recomienda vincular la adenda.
- **Cálculo del estado de la cuota:**
  - `CANCELADA` si se canceló manualmente.
  - Si no, `PENDIENTE` si ninguna línea de factura no anulada la referencia.
  - Si no, `COBRADA` si todas sus facturas están `PAGADA`.
  - Si no, `COBRADA_PARCIAL` si alguna de sus facturas tiene pagos.
  - En otro caso, `FACTURADA`.
- **Facturación parcial.** Una cuota puede repartirse entre varias facturas. Se considera totalmente facturada cuando la suma de sus líneas alcanza su monto.

#### 8.4.3 Cobros recurrentes

| Campo | Notas |
|---|---|
| Etiqueta | Por ejemplo "Mantenimiento mensual" o "Hosting gestionado" |
| Monto y moneda | |
| Frecuencia | `MENSUAL` · `TRIMESTRAL` · `SEMESTRAL` · `ANUAL` |
| Fecha de inicio y fecha de fin | La fecha de fin es opcional |
| Día de facturación | 1 a 28 |
| Días de anticipación | Por defecto 7. Indica cuántos días antes del periodo se genera la cuota. |
| Estado | `ACTIVO` · `PAUSADO` · `FINALIZADO` |

**Funcionamiento:**

- Una tarea programada diaria genera la cuota `RECURRENTE` del siguiente periodo cuando faltan los días de anticipación configurados. Cada cuota lleva `periodStart` y `periodEnd`.
- La generación es **idempotente**, gracias a la restricción única (`recurringChargeId`, `periodStart`).
- Al pausar un cobro se dejan de generar cuotas. Al reactivarlo no se generan los periodos que se saltaron, salvo que se pida explícitamente con la acción "Generar periodos faltantes".
- Cambiar el monto de un cobro solo afecta a los periodos futuros.

#### 8.4.4 Resumen financiero del proyecto

Se muestra en la pestaña *Cobro* y en la tabla de proyectos. Todos los montos se expresan en USD con los snapshots.

| Indicador | Cálculo |
|---|---|
| Valor contratado | Monto contratado + ajustes |
| Facturado | Suma de las líneas de factura del proyecto en facturas no anuladas |
| Cobrado | Parte cobrada de esas líneas (proporcional a lo pagado de cada factura) |
| Por facturar | Valor contratado − facturado (solo para precio fijo y mixto) |
| Por cobrar | Facturado − cobrado |
| Recurrente mensual | Cobros recurrentes activos, normalizados a mes |
| Gastos imputados | Suma de los gastos pagados vinculados al proyecto |
| Margen | Cobrado − gastos imputados. También se muestra en porcentaje. |

Una barra de progreso apilada muestra las proporciones de cobrado, facturado pendiente y por facturar.

### 8.5 Facturas

Las facturas **se registran**: el documento fiscal se emite fuera del sistema (imprenta autorizada o proveedor de facturación) y aquí se adjunta el PDF real.

#### Campos

| Campo | Notas |
|---|---|
| Código interno | `FAC-0001` |
| Cliente | Uno solo por factura (supuesto; ver §17) |
| Número de factura | Número fiscal emitido. Único entre las facturas no archivadas. |
| Número de control | Opcional. Es el número de control de la imprenta. |
| Fecha de emisión y fecha de vencimiento | Por defecto, el vencimiento es la emisión + 15 días (configurable) |
| Moneda y tasa (`usdRate`) | La tasa se precarga con la del día de emisión |
| Tasa BCV de referencia | Opcional. Se guarda para facturas en divisa que deben expresar su equivalente en Bs. |
| Líneas | Descripción, proyecto (opcional), cuota (opcional), cantidad, precio unitario e importe |
| Descuento | Monto |
| Monto exento | Parte no gravada |
| Base imponible | Subtotal − descuento − exento |
| Alícuota de IVA | Por defecto 16 % (configurable). Admite 0 % para exportación de servicios. |
| IVA | Se calcula y se puede ajustar ±0,01 para cuadrar con el documento físico |
| Total | Base + exento + IVA |
| Retención de IVA | Monto. Lo retiene el cliente si es agente de retención (por ejemplo, contribuyente especial). |
| Retención de ISLR | Monto |
| Otras retenciones | Monto, con descripción |
| Monto por cobrar | Total − retenciones |
| Snapshots USD | `totalUsd` y `receivableUsd` |
| Archivo | PDF o imagen de la factura real |
| Estado | Calculado (ver §9.4). `BORRADOR` y `ANULADA` se fijan manualmente. |
| Motivo de anulación | Obligatorio al anular |
| Notas internas | Vía notas vinculadas |

**Funcionamiento:**

- **Asistente "Facturar cuotas".** Desde el detalle de un proyecto, o al crear una factura después de elegir el cliente, el usuario puede seleccionar cuotas `PENDIENTE` de cualquiera de los proyectos de ese cliente. El sistema genera una línea por cuota, con el proyecto y la cuota ya vinculados.
- **Factura multiproyecto.** Cada línea puede apuntar a un proyecto distinto. El grafo y los resúmenes por proyecto usan esas líneas.
- **Comprobantes de retención.** Se suben como Documento del tipo "Comprobante de retención" vinculado a la factura.
- **Anular una factura:**
  - Sin pagos asignados, se anula directamente.
  - Con pagos asignados, el sistema exige primero desasignarlos. Los pagos quedan como saldo a favor.

**Vistas:**

- **Overview:** facturado frente a cobrado en los últimos 6 meses, antigüedad de las cuentas por cobrar (0-30, 31-60, 61-90, más de 90 días), facturas vencidas y total por moneda.
- **Tabla.** Columnas: código, número, cliente, proyectos, emisión, vencimiento, moneda, total, saldo, total en USD, saldo en USD, estado y días de mora.
- **Detalle.** Pestañas:
  - **Resumen:** cabecera, líneas, totales e impuestos.
  - **Pagos:** asignaciones con enlace a cada pago y botón "Registrar pago".
  - **Archivo:** visor del PDF.
  - **Documentos.**
  - **Notas.**
  - **Actividad.**
  - **Grafo.**

### 8.6 Pagos

#### Campos

| Campo | Notas |
|---|---|
| Código | `PAG-0001` |
| Cliente pagador | Obligatorio |
| Fecha | |
| Cuenta destino | Cuenta de la empresa donde entra el dinero |
| Método | Del catálogo: Transferencia nacional, Pago Móvil, Transferencia internacional, Zelle, Zinli, PayPal, USDT/Cripto, Efectivo USD, Efectivo VES, Otro |
| Moneda | Por defecto, la moneda de la cuenta |
| Monto recibido | Lo que pagó el cliente |
| IGTF | Parte del monto que corresponde a IGTF. Se propone 3 % cuando el método se paga en divisas y la configuración lo indica. Se puede editar. |
| Comisión | Lo que descuenta el procesador (PayPal, exchange, banco) |
| Neto acreditado | Monto − comisión. Es lo que entra en la cuenta. |
| Monto asignable | Monto − IGTF. Es lo que se puede aplicar a facturas. |
| Tasa y snapshot USD | |
| Referencia | Número de operación. Es obligatorio en los métodos que lo exigen. |
| Comprobante | Archivo (captura o PDF) |
| Estado | `PENDIENTE_VERIFICACION` · `CONFIRMADO` · `ANULADO` |
| Saldo sin asignar | Se calcula |

#### Asignación a facturas (N:M)

- El formulario de pago incluye una sección "Aplicar a facturas" que lista las facturas abiertas del cliente.
- Para cada factura se indica el monto en la moneda del pago. El sistema propone el monto en la moneda de la factura usando las tasas del día del pago, y el usuario lo puede ajustar.
- **Validaciones:**
  - La suma de las asignaciones no puede superar el monto asignable.
  - La asignación a una factura no puede superar su saldo.
- El monto asignable que sobra queda como **saldo a favor** del cliente y se puede aplicar después desde el detalle del pago o de la factura.
- Las asignaciones solo cuentan para el estado de la factura si el pago está `CONFIRMADO`.
- Anular un pago elimina sus asignaciones lógicamente y recalcula las facturas afectadas.
- No se pueden registrar duplicados: un pago con la misma referencia, el mismo método y la misma cuenta genera un aviso de posible duplicado.

**Vistas:**

- **Overview:** cobrado por mes, por método y por cuenta, pagos por verificar y saldos a favor.
- **Tabla.** Columnas: código, fecha, cliente, método, cuenta, moneda, monto, USD, asignado, sin asignar, referencia y estado.
- **Detalle.** Pestañas:
  - **Resumen.**
  - **Asignaciones.**
  - **Comprobante.**
  - **Documentos.**
  - **Notas.**
  - **Actividad.**
  - **Grafo.**

### 8.7 Cuentas de la empresa

#### Campos

| Campo | Notas |
|---|---|
| Nombre | Por ejemplo "Banesco Bs", "Zelle BofA", "Binance USDT" o "Caja USD" |
| Tipo | `BANCO_NACIONAL` · `BANCO_INTERNACIONAL` · `BILLETERA_DIGITAL` (Zinli, PayPal) · `WALLET_CRIPTO` · `EFECTIVO` |
| Institución | |
| Moneda | Una por cuenta |
| Identificador | Enmascarado: solo los últimos 4 dígitos o los primeros y últimos caracteres de la wallet |
| Titular | |
| Saldo inicial y fecha del saldo inicial | |
| Activa | Booleano |

#### Movimientos que afectan el saldo

| Movimiento | Efecto |
|---|---|
| Saldo inicial | + |
| Pago confirmado (neto acreditado) | + |
| Gasto pagado desde la cuenta | − |
| Transferencia entre cuentas | − en la cuenta origen (monto + comisión) y + en la cuenta destino (monto recibido). Admite distinta moneda en cada lado y guarda la tasa. |
| Movimiento manual | `APORTE_CAPITAL` (+), `RETIRO_SOCIO` (−) o `AJUSTE` (±). Los aportes y retiros indican el socio. |

**Vistas:**

- **Overview** (`/accounts`): tarjetas por cuenta con su saldo en la moneda propia y en USD, y el total consolidado en USD.
- **Detalle:** libro de movimientos con saldo corrido, filtros por fecha y tipo, exportación a CSV y la acción **"Conciliar"**. Esta acción registra el saldo real a una fecha y, si hay diferencia, sugiere un `AJUSTE`.

### 8.8 Gastos operativos

#### Campos

| Campo | Notas |
|---|---|
| Código | `GAS-0001` |
| Fecha y fecha de vencimiento | El vencimiento aplica a los gastos pendientes |
| Descripción y proveedor | El proveedor es texto libre con autocompletado de valores previos |
| Categoría | Catálogo jerárquico de dos niveles, por ejemplo Infraestructura → Hosting. Semilla: Infraestructura, Software y SaaS, IA, Dominios, Freelancers, Comisiones e impuestos, Oficina, Marketing, Legal y contable, Otros. |
| Cuenta de pago | Obligatoria para marcar el gasto como `PAGADO` |
| Proyecto | Opcional. Si se indica, el gasto se imputa al margen del proyecto. |
| Moneda, monto, tasa y snapshot USD | |
| Estado | `PENDIENTE` · `PAGADO` · `ANULADO` |
| Comprobante | Archivo |
| Origen recurrente | Si fue generado por un gasto recurrente |

#### Gastos recurrentes

Ejemplos: hosting, suscripciones de IA, Clerk, Neon, dominios.

| Campo | Notas |
|---|---|
| Nombre, proveedor y categoría | |
| Cuenta por defecto y proyecto opcional | |
| Moneda y monto estimado | |
| Frecuencia | `MENSUAL` · `TRIMESTRAL` · `SEMESTRAL` · `ANUAL` |
| Día del periodo | |
| Días de anticipación | Por defecto 5 |
| Fecha de inicio y fecha de fin | |
| Estado | `ACTIVO` · `PAUSADO` · `FINALIZADO` |

**Funcionamiento:**

- La tarea programada diaria genera un `Expense` en estado `PENDIENTE` para cada periodo. La generación es idempotente gracias a (`recurringExpenseId`, `periodStart`).
- El usuario lo confirma con "Marcar como pagado", donde ajusta el monto real, la tasa y el comprobante.

**Vistas:**

- **Overview:** gasto por mes y por categoría, gasto recurrente mensual comprometido y próximos vencimientos.
- **Tabla de gastos** y **tabla de recurrentes**.
- **Detalle** con documentos, notas, actividad y grafo.

### 8.9 Documentos

#### 8.9.1 Clasificación

- **Categorías** configurables. Semilla: Legal, Comercial, Técnico, Operativo, Financiero.
- **Tipos** configurables dentro de cada categoría. Cada tipo define estos atributos:

| Atributo del tipo | Efecto |
|---|---|
| `requiresSignature` | Habilita el estado `FIRMADO` y el campo de fecha de firma |
| `hasExpiration` | Habilita la fecha de vencimiento y las alertas |
| `defaultFormat` | `MARKDOWN` · `ARCHIVO` · `ENLACE` |
| `active` | |

**Semilla de tipos:**

- **Legal:** Contrato de servicios, Acuerdo de confidencialidad (NDA), Adenda, Acta de entrega, Cesión de propiedad intelectual.
- **Comercial:** Propuesta comercial, Cotización.
- **Técnico:** PRD, TSD, Roadmap, Arquitectura, Manual de usuario.
- **Operativo:** Minuta de reunión, Credenciales (solo un enlace al gestor de contraseñas, nunca el secreto), Onboarding.
- **Financiero:** Comprobante de retención, Estado de cuenta.

#### 8.9.2 Campos del documento

| Campo | Notas |
|---|---|
| Código | `DOC-0001` |
| Título | |
| Tipo | La categoría se deriva del tipo |
| Resumen | Opcional |
| Estado | `BORRADOR` · `EN_REVISION` · `APROBADO` · `ENVIADO` · `FIRMADO` · `VENCIDO` · `ANULADO` |
| Fecha efectiva | |
| Fecha de firma | Solo en tipos con firma |
| Fecha de vencimiento | Solo en tipos con vencimiento |
| Días de alerta | Por defecto 30 |
| Vínculos | Uno o más registros: clientes, contactos, proyectos, facturas, pagos o gastos. Un documento puede existir sin vínculos. |
| Versión vigente | |
| Etiquetas | |

#### 8.9.3 Formatos y versionado

Cada **versión** tiene un único formato:

- `MARKDOWN`: el contenido se edita en el sistema con un editor dividido (código y vista previa), compatible con GitHub Flavored Markdown (tablas, listas de tareas, bloques de código con resaltado).
- `ARCHIVO`: archivo subido al bucket (PDF, DOCX, imágenes, etc.).
- `ENLACE`: URL externa, por ejemplo de Google Drive.

**Reglas de versionado:**

- **Borrador con autoguardado.** Mientras se edita un documento markdown, el contenido se guarda automáticamente cada 5 segundos de inactividad en `draftContent`. El borrador no crea versión.
- **Publicar versión.** La acción "Publicar versión" crea una `DocumentVersion` inmutable con número incremental y nota de cambios opcional, y la marca como versión vigente.
- **Nueva versión de archivo o enlace.** Se crea con la acción "Subir nueva versión" o "Actualizar enlace".
- **Historial.** El historial lista las versiones con autor, fecha y nota. Permite ver una versión, descargarla, compararla con la vigente (diff de texto, solo en markdown) y **restaurarla**. Restaurar crea una nueva versión copiando la elegida; no reescribe el historial.
- **Bloqueo por firma.** Un documento `FIRMADO` no admite nuevas versiones. Para modificarlo se crea un documento nuevo, por ejemplo una adenda, vinculado al original.

#### 8.9.4 Estados y transiciones

```
BORRADOR ⇄ EN_REVISION → APROBADO → ENVIADO → FIRMADO → VENCIDO (automático)
   cualquiera (salvo VENCIDO) → ANULADO
```

- `FIRMADO` solo existe en los tipos con firma. Al pasar a ese estado se exige la fecha de firma y se recomienda adjuntar como versión el archivo firmado.
- `VENCIDO` lo asigna la tarea diaria cuando `expiresAt` es anterior a hoy.
- Compartir un documento en el portal propone pasarlo a `ENVIADO` si estaba `APROBADO`.

#### 8.9.5 Vistas

- **Overview:** documentos por categoría y estado, por vencer en los próximos 30, 60 y 90 días, recientes y borradores con más de 14 días sin cambios.
- **Tabla.** Columnas: código, título, categoría, tipo, estado, formato vigente, versión, vinculado a (chips), vencimiento, compartido (sí o no) y actualizado.
- **Detalle.** Pestañas:
  - **Contenido:** visor según el formato, con el botón "Editar" en markdown.
  - **Versiones.**
  - **Vínculos.**
  - **Compartir:** enlaces del portal que lo incluyen.
  - **Notas.**
  - **Actividad.**
  - **Grafo.**
- **Impresión.** La vista markdown tiene la acción "Imprimir / Guardar como PDF", con hoja de estilos de impresión y membrete de WeDevs.

### 8.10 Notas

| Campo | Notas |
|---|---|
| Título | Opcional. Si falta, se usan las primeras palabras del contenido. |
| Contenido | Texto enriquecido con Tiptap: encabezados, listas, listas de tareas, enlaces, código, citas, tablas e imágenes pegadas, que se suben como adjuntos |
| Autor | Usuario que la crea. Inmutable. |
| Fecha | `createdAt` y `updatedAt` |
| Etiquetas | |
| Fijada | Booleano. Las notas fijadas aparecen arriba en el detalle de la entidad. |
| Adjuntos | Varios archivos |
| Vínculos | Una o más entidades: cliente, contacto, proyecto, documento, factura, pago o gasto |

**Funcionamiento:**

- Se crean desde la pestaña *Notas* de cualquier entidad (con el vínculo precargado) o desde la tabla global `/notes`.
- En el detalle de cada entidad se muestran como un *feed* cronológico: tarjetas con autor, fecha, etiquetas, vista previa expandible y adjuntos.
- La tabla global permite filtrar por autor, etiqueta, tipo de entidad vinculada y fechas.

### 8.11 Portal público de documentos

Permite compartir uno o varios documentos con terceros mediante una **URL exacta**. No requiere cuenta, el contenido no se puede listar y los buscadores no lo indexan.

#### Enlace de portal (Share Link)

| Campo | Notas |
|---|---|
| Token | 32 bytes aleatorios en base64url (43 caracteres), generados con CSPRNG. Es único. |
| Título y mensaje | Se muestran al visitante, por ejemplo "Documentación contractual — Proyecto X" |
| Cliente | Opcional. Personaliza el encabezado. |
| Documentos | Uno o más. Cada uno se fija a una **versión concreta** (por defecto) o se configura como "siempre la última versión". |
| Permitir descarga | Booleano. Por defecto verdadero. |
| Idioma del portal | ES o EN |
| Vencimiento | Fecha opcional |
| Estado | Activo o revocado (`revokedAt`) |

**URL:** `https://<dominio>/s/<token>`

**Comportamiento del portal:**

- La página pública lleva la marca WeDevs, el título, el mensaje y la lista de documentos con su tipo, versión y fecha.
- Cada documento tiene un visor:
  - PDF incrustado;
  - markdown renderizado y sanitizado;
  - imagen;
  - enlace externo, que se muestra como botón.
- **Descargas.** Se sirven mediante una URL prefirmada de corta duración (5 minutos) que se genera en cada clic. Los markdown se descargan como `.md` y se pueden imprimir como PDF con la hoja de impresión.
- **Enlace inválido.** Si el token no existe, está revocado o venció, se muestra una página genérica de "Enlace no disponible" con código 404, sin indicar el motivo.
- **Cabeceras.** `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer` y `Cache-Control: private, no-store`.
- **Rate limiting.** 60 peticiones por minuto por IP en `/s/*`.

**Trazabilidad:**

- Se registra cada visita (`VIEW`) y cada descarga (`DOWNLOAD`) en `ShareAccessLog`, con la fecha, el hash de la IP (SHA-256 con *salt*), el user agent y el documento.
- El detalle del enlace muestra: número de visitas, número de descargas, último acceso y la tabla de accesos.

**Gestión:**

- Se crean desde el detalle de un documento ("Compartir") o desde el detalle de un cliente o proyecto ("Compartir documentos…", con selección múltiple).
- Desde el detalle del enlace se puede copiar la URL, generar un código QR, revocar el enlace, cambiar el vencimiento y añadir o quitar documentos.
- La vista `/documents/shares` lista todos los enlaces.

### 8.12 Vista de grafo

#### 8.12.1 Librería y estética

Se usa **React Flow (`@xyflow/react`)**. Es la opción con mejor resultado visual para este caso:

- Los nodos son componentes React, así que se pueden construir con los mismos elementos de shadcn (badges de estado, avatares, iconos lucide) y respetan el tema claro u oscuro.
- Incluye minimapa, controles de zoom, fondo de puntos, aristas animadas y etiquetadas, y transiciones suaves al expandir.

Los layouts se calculan con:

- **ELK (`elkjs`)** para los layouts **radial** (por defecto en el detalle, con la raíz en el centro) y **jerárquico** (de izquierda a derecha).
- **d3-force** para el layout **de fuerzas** (por defecto en el grafo global).

Los layouts se calculan en un *Web Worker* para no bloquear la interfaz.

> **Umbral de escalabilidad.** React Flow rinde bien hasta unos 1 000–1 500 nodos visibles. Si el grafo global supera esa cantidad de forma habitual, se migrará solo esa vista a Sigma.js con renderizado WebGL. El contrato de datos (§8.12.5) no cambia.

#### 8.12.2 Tipos de nodo

| Nodo | Icono (lucide) | Color (token) | Contenido de la tarjeta |
|---|---|---|---|
| Cliente | `building-2` o `user` | azul | Nombre comercial, código, estado y saldo por cobrar |
| Contacto | `contact` | celeste | Nombre y cargo |
| Proyecto | `folder-kanban` | violeta | Nombre, estado e iconos del stack (máximo 4) |
| Factura | `receipt` | ámbar | Número, total, saldo y estado |
| Pago | `banknote` | verde | Monto, fecha y método |
| Gasto | `credit-card` | rojo | Descripción, monto y estado |
| Cuenta | `landmark` | gris azulado | Nombre y moneda |
| Documento | `file-text` | índigo | Título, tipo, estado y versión |
| Nota | `sticky-note` | amarillo | Título o extracto, y autor |
| Tecnología | `cpu` | gris | Nombre e icono. Oculta por defecto. |
| Etiqueta | `tag` | color de la etiqueta | Nombre. Oculta por defecto. |

Los nodos archivados se muestran semitransparentes y con borde discontinuo, y solo aparecen si se activa "Mostrar archivados". El nodo raíz es más grande y lleva un anillo de foco.

#### 8.12.3 Aristas (relaciones)

| Origen → Destino | Etiqueta |
|---|---|
| Cliente → Contacto | contacto |
| Cliente ↔ Proyecto | participa (y el rol, si existe) |
| Cliente → Factura | facturado a |
| Proyecto → Factura | incluido en (vía líneas) |
| Factura ← Pago | paga (con el monto asignado) |
| Cliente → Pago | pagó |
| Pago → Cuenta | acreditado en |
| Gasto → Cuenta | pagado desde |
| Gasto → Proyecto | imputado a |
| Documento → cualquier entidad | adjunto a |
| Nota → cualquier entidad | anotado en |
| Proyecto → Tecnología | usa |
| Cualquier entidad → Etiqueta | etiquetado |

#### 8.12.4 Interacciones

**Vista de grafo del registro** (`/<entidad>/[id]/graph`):

- Carga la raíz y sus relaciones directas (profundidad 1).
- **Expandir:** un clic en el botón "+" de un nodo, o doble clic sobre el nodo, carga sus vecinos. Los vecinos se añaden con animación y se recalcula el layout de forma incremental, sin mover los nodos ya fijados. El botón "−" colapsa lo que se expandió.
- **Seleccionar:** un clic selecciona el nodo y abre un panel lateral con su resumen y las acciones "Abrir detalle", "Ver su grafo" y "Expandir".
- **Vista previa:** al pasar el cursor por un nodo, se muestra una *hover card* con los datos clave tras 300 ms.
- **Navegar:** `Ctrl` o `⌘` + clic abre el detalle; el botón "Abrir detalle" del panel hace lo mismo.
- **Filtros por tipo de nodo:** casillas con contador.
- **Filtros por estado, etiqueta y rango de fechas.**
- **Alternar archivados.**
- **Elegir layout:** radial, jerárquico o de fuerzas.
- **Buscar dentro del grafo:** resalta y centra el nodo encontrado.
- **Modo foco:** al seleccionar un nodo, atenúa todo lo que no es su vecindad.
- **Controles:** zoom, ajustar a pantalla, minimapa, pantalla completa y **exportar a PNG o SVG**.
- **Leyenda** de tipos y colores.
- **Fijar posición:** arrastrar un nodo fija su posición durante la sesión.
- **Límite de expansión:** como máximo 50 vecinos por expansión. Si hay más, aparece un nodo agregado "+N más" que, al pulsarlo, carga la siguiente página.

**Grafo global** (`/graph`):

- Por defecto muestra clientes, proyectos y documentos, más sus aristas. Los demás tipos se activan con filtros para evitar un grafo saturado.
- Usa el layout de fuerzas, con agrupación visual opcional por cliente (*clusters* con un halo de color).
- Filtros: los del grafo de detalle más tecnología, estado de proyecto y "Solo activos".
- La búsqueda centra el grafo en un nodo, y la acción "Ver desde aquí" abre la vista de detalle de ese nodo.
- Muestra estadísticas: número de nodos y de aristas, y los nodos más conectados.

#### 8.12.5 Contrato de datos

```ts
type GraphNodeType =
  | 'CLIENT' | 'CONTACT' | 'PROJECT' | 'INVOICE' | 'PAYMENT'
  | 'EXPENSE' | 'ACCOUNT' | 'DOCUMENT' | 'NOTE' | 'TECHNOLOGY' | 'TAG';

interface GraphNode {
  id: string;                 // `${type}:${entityId}`
  type: GraphNodeType;
  entityId: string;
  label: string;
  code?: string;
  status?: string;
  meta: Record<string, string | number | null>; // datos para la tarjeta y la hover card
  archived: boolean;
  degree: number;             // número total de relaciones (para mostrar "+N")
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;           // 'participa', 'paga', ...
  label?: string;
}

interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: { nodeId: string; remaining: number }[];
}

// Servicios
getEntityGraph({ type, id, depth = 1, include?: GraphNodeType[], includeArchived?: boolean }): GraphResponse
expandNode({ nodeId, include?, cursor? }): GraphResponse
getGlobalGraph({ include, filters }): GraphResponse
```

Las consultas del grafo se resuelven con consultas Prisma específicas para cada tipo de relación, ejecutadas en paralelo. **No** se usa una tabla genérica de aristas, para conservar la integridad referencial. Los resultados de `getGlobalGraph` se cachean con `unstable_cache` y la etiqueta `graph`, que se invalida en cada mutación.

### 8.13 Reportes y KPI

**Ruta:** `/reports`.

**Filtros globales:**

- Rango de fechas. Predefinidos: este mes, mes anterior, trimestre, año y últimos 12 meses.
- Cliente.
- Proyecto.
- Etiqueta.

La moneda de presentación es USD, a partir de los snapshots. Cada gráfico tiene una tabla de datos desplegable y exportación a CSV.

#### 8.13.1 Reportes financieros

| Reporte | Definición |
|---|---|
| Ingresos cobrados por mes | Asignaciones de pagos confirmados agrupadas por mes del pago (USD) |
| Facturado frente a cobrado | Totales mensuales en barras dobles |
| Ingresos por cliente | Ranking por cobrado y facturado |
| Ingresos por proyecto | Ranking por cobrado, con el margen |
| Cuentas por cobrar y antigüedad | Saldo por cliente en tramos de 0-30, 31-60, 61-90 y más de 90 días desde el vencimiento |
| Gastos por mes y por categoría | Barras apiladas por categoría |
| Resultado neto mensual | Cobrado − gastos pagados |
| Flujo por cuenta | Entradas y salidas por cuenta y mes |
| Cobros por método | Distribución por método de pago |
| Impuestos registrados | IVA facturado, retenciones sufridas e IGTF registrado por mes. Es informativo, no reemplaza la contabilidad. |

#### 8.13.2 KPI

| KPI | Fórmula |
|---|---|
| MRR | Σ cobros recurrentes activos normalizados a mes (trimestral ÷ 3, semestral ÷ 6, anual ÷ 12) |
| ARR | MRR × 12 |
| DSO (días de cobro) | (Cuentas por cobrar al cierre ÷ facturado en el periodo) × días del periodo |
| Tasa de cobro | Cobrado en el periodo ÷ facturado en el periodo |
| Morosidad | Saldo vencido ÷ cuentas por cobrar totales |
| Margen por proyecto | (Cobrado − gastos imputados) ÷ cobrado |
| Margen operativo | (Cobrado − gastos totales) ÷ cobrado |
| Gasto fijo mensual | Σ gastos recurrentes activos normalizados a mes |
| Runway (meses) | Saldo total en cuentas (USD) ÷ promedio de gasto mensual de los últimos 3 meses |
| Concentración de ingresos | % del cobrado en los últimos 12 meses que corresponde al top 1 y al top 3 de clientes |
| Ticket promedio por proyecto | Valor contratado medio de los proyectos iniciados en el periodo |
| LTV por cliente | Cobrado histórico por cliente; también su promedio |
| Nuevos clientes | Clientes que pasaron a `ACTIVO` en el periodo |
| Conversión de prospectos | Prospectos que pasaron a `ACTIVO` ÷ prospectos creados (en el periodo) |
| Duración media de proyecto | Promedio de (entrega real − inicio) de los proyectos entregados |
| Proyectos a tiempo | % de proyectos entregados en o antes de la fecha estimada |
| Uso del stack | Número de proyectos por tecnología |
| Cobertura documental | % de proyectos activos con contrato `FIRMADO` y NDA vigente |

La página de KPI muestra tarjetas con el valor, la variación frente al periodo anterior y una *sparkline* de 12 meses. Al pulsar una tarjeta se abre el reporte detallado.

### 8.14 Registro de actividad

Es completo e inmutable.

#### Eventos registrados

`CREATE`, `UPDATE`, `DELETE` (lógico), `RESTORE`, `STATUS_CHANGE`, `LINK` y `UNLINK` (vínculos de documentos, notas, etiquetas, clientes y proyectos), `UPLOAD`, `VERSION_PUBLISH`, `SHARE_CREATE`, `SHARE_REVOKE`, `ALLOCATE` y `DEALLOCATE` (pagos), `EXPORT` (CSV), `LOGIN`, `SETTINGS_CHANGE`, `SYSTEM_JOB` (generaciones automáticas) y `PORTAL_ACCESS` (resumen; el detalle queda en `ShareAccessLog`).

#### Datos de cada evento

- Actor: usuario, `SYSTEM` o `PUBLIC`.
- Acción.
- Tipo e ID de la entidad.
- Etiqueta de la entidad en ese momento (snapshot).
- `changes`: diff por campo con el formato `{ campo: [antes, después] }`. Se excluyen los campos sensibles y los textos largos; de estos solo se registra que cambiaron.
- `metadata`.
- IP y user agent (en las acciones de usuario).
- Fecha y hora.

#### Implementación

- `logActivity()` se invoca dentro de la misma transacción que la mutación, desde la capa de servicios. No se usa un middleware genérico, para conservar la semántica de cada acción y el actor.
- La tabla es *append-only*: no existen servicios de actualización ni de borrado sobre ella.

#### Vistas

- `/activity`: tabla global con filtros por usuario, acción, tipo de entidad y fechas, y exportación a CSV.
- Pestaña *Actividad* en cada detalle: línea de tiempo con el diff legible ("Estado: Emitida → Pagada").

### 8.15 Configuración

**Ruta:** `/settings`.

| Sección | Contenido |
|---|---|
| Empresa | Nombre, razón social, RIF, dirección y logo (para el portal y la impresión) |
| Usuarios | Lista, rol e invitación (vía Clerk). Solo Owner. |
| Preferencias | Idioma, tema y zona horaria (por usuario) |
| Monedas | Código, nombre, símbolo, decimales y activa. Semilla: USD, VES, EUR, USDT, COP. |
| Tasas de cambio | Tabla por fecha y moneda, con la fuente (`MANUAL`, `BCV`, `OTRA`). Permite carga rápida del día e importación desde CSV. |
| Fiscal | Alícuota de IVA por defecto (16 %), alícuota de IGTF (3 %), métodos y monedas que proponen IGTF y días de vencimiento por defecto de las facturas |
| Métodos de pago | Catálogo: nombre, si requiere referencia, si propone IGTF y si está activo |
| Tecnologías | Catálogo (§8.3) |
| Documentos | Categorías y tipos (§8.9) |
| Categorías de gasto | Catálogo jerárquico |
| Etiquetas | Nombre y color |
| Papelera | Registros archivados y restauración |

---

## 9. Reglas de negocio monetarias y fiscales

### 9.1 Representación

- **Montos:** `Decimal(18,2)`. Las operaciones usan `decimal.js` y se redondean con `ROUND_HALF_UP` a 2 decimales al persistir.
- **Tasas:** `Decimal(20,8)`.
- **Porcentajes:** `Decimal(5,2)`.
- Está prohibido usar `number` para dinero en la capa de servicios. Los DTOs exponen los montos como `string`.

### 9.2 Tasas de cambio

- `usdRate` indica cuántas unidades de la moneda equivalen a 1 USD. Para USD vale siempre 1.
- `amountUsd = round(amount / usdRate, 2)`.
- **Precarga de la tasa** en los formularios, en este orden:
  1. La tasa de esa fecha y moneda en `ExchangeRate`.
  2. Si no existe, la última tasa anterior, con el aviso "Usando tasa del dd/mm".
  3. Si tampoco existe, la tasa se debe ingresar manualmente.
- El valor elegido se guarda como **snapshot** en la transacción. Cambiar después la tabla `ExchangeRate` **no** recalcula transacciones existentes.
- Editar la tasa de una transacción ya registrada se permite, queda en el registro de actividad y recalcula sus snapshots y los agregados que dependen de ella.

### 9.3 Cálculo de la factura

```
subtotal       = Σ líneas.amount                  (amount = quantity × unitPrice)
taxBase        = subtotal − discount − exemptAmount
ivaAmount      = round(taxBase × ivaRate / 100, 2)   (editable ±0.01)
total          = taxBase + exemptAmount + ivaAmount
withholdings   = ivaWithheld + islrWithheld + otherWithheld
receivable     = total − withholdings
totalUsd       = round(total / usdRate, 2)
receivableUsd  = round(receivable / usdRate, 2)
paidAmount     = Σ allocations.amountInvoiceCurrency  (solo pagos CONFIRMADO, asignaciones no anuladas)
balance        = receivable − paidAmount
```

### 9.4 Estado de la factura

El estado se recalcula en tres momentos:

- en cada mutación de la factura o de sus asignaciones;
- en cada cambio de estado de un pago relacionado;
- en la tarea diaria, para detectar los vencimientos.

```ts
function computeInvoiceStatus(inv, today): InvoiceStatus {
  if (inv.voidedAt) return 'ANULADA';
  if (inv.isDraft) return 'BORRADOR';
  if (inv.balance <= 0.00) return 'PAGADA';
  if (inv.dueDate < today) return 'VENCIDA';   // aunque tenga pagos parciales
  if (inv.paidAmount > 0) return 'PARCIAL';
  return 'EMITIDA';
}
```

Una factura vencida con pagos parciales se muestra como `VENCIDA`, con el indicador secundario "Pago parcial". El estado se guarda en la base de datos (materializado) para poder filtrar y ordenar.

### 9.5 Asignación entre monedas

Sea `P` un pago en la moneda `Mp` con tasa `rp` y `F` una factura en la moneda `Mf`:

```
amountPaymentCurrency  = lo que el usuario aplica de P
amountUsd              = round(amountPaymentCurrency / rp, 2)
amountInvoiceCurrency  = round(amountUsd × rf(fecha del pago), 2)   // propuesto y editable
```

Aquí, `rf(fecha del pago)` es la tasa de `Mf` en la fecha del pago, tomada de `ExchangeRate`. Si `Mp = Mf`, entonces `amountInvoiceCurrency = amountPaymentCurrency`.

Una factura se considera saldada si su saldo en la moneda de la factura queda en ≤ 0,01. La diferencia cambiaria entre la tasa de emisión y la de cobro **no** se contabiliza en el MVP, pero el reporte de facturas la muestra de forma informativa: `receivableUsd` frente a la suma de `allocations.amountUsd`.

### 9.6 IGTF y comisiones en pagos

```
allocatable    = amount − igtfAmount
netCredited    = amount − feeAmount            → entra en la cuenta
unallocated    = allocatable − Σ allocations.amountPaymentCurrency
```

- El IGTF **no** cuenta como ingreso en los KPI. Se acumula en el reporte de impuestos registrados.
- La comisión reduce el neto acreditado. En los reportes aparece como "Comisiones de cobro", calculadas a partir de los pagos; no se duplica como gasto.

### 9.7 Saldo de una cuenta

```
balance(account, hasta T) =
    openingBalance
  + Σ payments.netCredited       (CONFIRMADO, fecha ≤ T, accountId)
  − Σ expenses.amount            (PAGADO, fecha de pago ≤ T, accountId)
  + Σ transfers.amountTo         (toAccountId)
  − Σ (transfers.amountFrom + transfers.feeAmount)   (fromAccountId)
  ± Σ movements.amount           (APORTE +, RETIRO −, AJUSTE con signo)
```

Si la moneda de un gasto difiere de la moneda de la cuenta desde la que se paga, el formulario pide el **monto debitado en la moneda de la cuenta** (`accountAmount`), y ese es el valor que usa el saldo.

### 9.8 Consideraciones fiscales (Venezuela)

> El sistema **registra** información fiscal, pero no es un sistema contable ni de facturación homologado. Las alícuotas son parámetros configurables y deben validarse con el contador del estudio.

- **IVA.** La alícuota general vigente es 16 % y existe una reducida de 8 %. En el MVP se usa una sola alícuota por factura más un monto exento. Las facturas mixtas con varias alícuotas quedan pendientes (ver §17).
- **Exportación de servicios.** Los servicios prestados a personas en el exterior sin establecimiento permanente en Venezuela pueden tener alícuota 0 %. Por eso el campo `ivaRate` admite 0.
- **IGTF.** Grava con 3 % ciertos pagos en divisas. El sistema lo registra como parte del pago cuando corresponde, propuesto según el método o la moneda y editable.
- **Retenciones.** Las retenciones de IVA e ISLR que practica el cliente se registran como montos en la factura y reducen el monto por cobrar. El comprobante de retención se adjunta como documento.
- **Factura electrónica.** No está en el alcance. Las facturas emitidas por un proveedor autorizado se registran igual, con su número de factura y su número de control.

---

## 10. Modelo de datos (Prisma)

### 10.1 Diagrama de relaciones (resumen)

```
User ─┬─< Note (author)          ShareLink >─< Document (ShareLinkDocument)
      └─< File (uploader)        ShareLink ─< ShareAccessLog

Client ─< Contact
Client >─< Project               (ProjectClient)
Project ─< ProjectLink
Project >─< Technology           (ProjectTechnology)
Project ─1 BillingPlan
Project ─< BillingInstallment >─ RecurringCharge
Client ─< Invoice ─< InvoiceLine >─ Project / BillingInstallment
Client ─< Payment >─< Invoice    (PaymentAllocation)
Payment >─ Account  >─ PaymentMethod
Expense >─ Account / Project / ExpenseCategory / RecurringExpense
Account ─< AccountTransfer (from/to) · AccountMovement
DocumentCategory ─< DocumentType ─< Document ─< DocumentVersion >─ File
Document ─< DocumentLink  >─ Client | Contact | Project | Invoice | Payment | Expense
Note     ─< NoteLink      >─ Client | Contact | Project | Document | Invoice | Payment | Expense
Note >─< File (NoteAttachment)
Tag ─< TagAssignment      >─ Client | Contact | Project | Invoice | Payment | Expense | Document | Note
ActivityLog · SearchEntry · ExchangeRate · Currency · Setting · Sequence · UserPreference · AlertDismissal
```

**Vínculos polimórficos.** Los vínculos de documentos, notas y etiquetas no usan una tabla genérica `(entityType, entityId)`. Usan **tablas de enlace con claves foráneas opcionales**, más una restricción `CHECK` que exige exactamente una FK no nula. Así se mantienen la integridad referencial y los tipos de Prisma, y el grafo se construye con *joins* tipados.

### 10.2 `schema.prisma`

> Nota: el esquema está escrito para **Prisma 7** y validado con su validador oficial. Las URLs de conexión se declaran en `prisma.config.ts` (ver §10.2.1) y el cliente se instancia con el *driver adapter* de Neon. Los campos `createdById` y `updatedById` se guardan sin relación explícita para no saturar el esquema; la autoría completa vive en `ActivityLog`.

```prisma
generator client {
  provider = "prisma-client"            // Prisma 7
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"               // las URLs viven en prisma.config.ts
}

// ───────────────────────────── ENUMS ─────────────────────────────

enum UserRole {
  OWNER
  ADMIN
  MEMBER
  VIEWER
}
enum ClientKind {
  PERSONA
  EMPRESA
}
enum ClientStatus {
  PROSPECTO
  ACTIVO
  INACTIVO
}
enum ProjectStatus {
  PROPUESTA
  EN_CURSO
  PAUSADO
  ENTREGADO
  MANTENIMIENTO
  CANCELADO
}
enum ProjectLinkGroup {
  REPOSITORIO
  ENTORNO
  DISENO
  GESTION
  DOCUMENTACION
  INFRAESTRUCTURA
  COMUNICACION
  OTRO
}
enum TechCategory {
  LENGUAJE
  FRONTEND
  BACKEND
  BASE_DE_DATOS
  INFRAESTRUCTURA
  MOBILE
  IA
  TESTING
  HERRAMIENTA
  OTRO
}
enum BillingModel {
  PRECIO_FIJO
  RECURRENTE
  MIXTO
}
enum InstallmentKind {
  ANTICIPO
  HITO
  CUOTA
  FINAL
  RECURRENTE
  AJUSTE
}
enum InstallmentStatus {
  PENDIENTE
  FACTURADA
  COBRADA_PARCIAL
  COBRADA
  CANCELADA
}
enum Frequency {
  MENSUAL
  TRIMESTRAL
  SEMESTRAL
  ANUAL
}
enum RecurringStatus {
  ACTIVO
  PAUSADO
  FINALIZADO
}
enum InvoiceStatus {
  BORRADOR
  EMITIDA
  PARCIAL
  PAGADA
  VENCIDA
  ANULADA
}
enum PaymentStatus {
  PENDIENTE_VERIFICACION
  CONFIRMADO
  ANULADO
}
enum AccountType {
  BANCO_NACIONAL
  BANCO_INTERNACIONAL
  BILLETERA_DIGITAL
  WALLET_CRIPTO
  EFECTIVO
}
enum AccountMovementType {
  APORTE_CAPITAL
  RETIRO_SOCIO
  AJUSTE
}
enum ExpenseStatus {
  PENDIENTE
  PAGADO
  ANULADO
}
enum DocumentStatus {
  BORRADOR
  EN_REVISION
  APROBADO
  ENVIADO
  FIRMADO
  VENCIDO
  ANULADO
}
enum DocumentFormat {
  MARKDOWN
  ARCHIVO
  ENLACE
}
enum FileStatus {
  PENDING
  READY
}
enum RateSource {
  MANUAL
  BCV
  OTRA
}
enum ShareEvent {
  VIEW
  DOWNLOAD
}
enum ActorType {
  USER
  SYSTEM
  PUBLIC
}
enum EntityType {
  CLIENT
  CONTACT
  PROJECT
  INVOICE
  PAYMENT
  EXPENSE
  RECURRING_EXPENSE
  ACCOUNT
  TRANSFER
  ACCOUNT_MOVEMENT
  DOCUMENT
  NOTE
  FILE
  SHARE_LINK
  BILLING_PLAN
  INSTALLMENT
  RECURRING_CHARGE
  TAG
  SETTING
  USER
}

enum ActivityAction {
  CREATE
  UPDATE
  DELETE
  RESTORE
  STATUS_CHANGE
  LINK
  UNLINK
  UPLOAD
  VERSION_PUBLISH
  SHARE_CREATE
  SHARE_REVOKE
  ALLOCATE
  DEALLOCATE
  EXPORT
  LOGIN
  SETTINGS_CHANGE
  SYSTEM_JOB
  PORTAL_ACCESS
}

// ───────────────────────────── USUARIOS ─────────────────────────────

model User {
  id          String    @id @default(cuid())
  clerkId     String    @unique
  email       String    @unique
  name        String
  imageUrl    String?
  role        UserRole  @default(ADMIN)
  locale      String    @default("es")
  theme       String    @default("system")
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?

  notes        Note[]
  files        File[]
  preferences  UserPreference[]
  dismissals   AlertDismissal[]
  activity     ActivityLog[]
  movements    AccountMovement[]
}

model UserPreference {
  id     String @id @default(cuid())
  userId String
  key    String               // p. ej. "table:clients:columns"
  value  Json
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, key])
}

model AlertDismissal {
  id             String    @id @default(cuid())
  userId         String
  alertKey       String    // p. ej. "INVOICE_OVERDUE:<invoiceId>"
  dismissedUntil DateTime?
  createdAt      DateTime  @default(now())
  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, alertKey])
}

// ───────────────────────────── CLIENTES ─────────────────────────────

model Client {
  id          String       @id @default(cuid())
  code        String       @unique
  kind        ClientKind
  tradeName   String
  legalName   String
  taxId       String
  country     String       @db.Char(2)
  address     String
  phone       String
  email       String?
  website     String?
  status      ClientStatus @default(PROSPECTO)
  activatedAt DateTime?
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
  createdById String?
  updatedById String?
  deletedAt   DateTime?
  deletedById String?

  contacts      Contact[]
  projects      ProjectClient[]
  invoices      Invoice[]
  payments      Payment[]
  documentLinks DocumentLink[]
  noteLinks     NoteLink[]
  tags          TagAssignment[]
  shareLinks    ShareLink[]

  @@index([status])
  @@index([deletedAt])
}

model Contact {
  id          String    @id @default(cuid())
  clientId    String
  fullName    String
  position    String?
  email       String?
  phone       String?
  isPrimary   Boolean   @default(false)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?

  client        Client          @relation(fields: [clientId], references: [id])
  documentLinks DocumentLink[]
  noteLinks     NoteLink[]
  tags          TagAssignment[]

  @@index([clientId])
}

// ───────────────────────────── PROYECTOS ─────────────────────────────

model Project {
  id              String        @id @default(cuid())
  code            String        @unique
  name            String
  summary         String        @db.VarChar(280)
  description     Json?         // Tiptap JSON
  descriptionText String?       // texto plano para la búsqueda
  status          ProjectStatus @default(PROPUESTA)
  startDate       DateTime?     @db.Date
  targetEndDate   DateTime?     @db.Date
  endDate         DateTime?     @db.Date
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  createdById     String?
  updatedById     String?
  deletedAt       DateTime?
  deletedById     String?

  clients          ProjectClient[]
  links            ProjectLink[]
  technologies     ProjectTechnology[]
  billingPlan      BillingPlan?
  installments     BillingInstallment[]
  recurringCharges RecurringCharge[]
  invoiceLines     InvoiceLine[]
  expenses         Expense[]
  recurringExpenses RecurringExpense[]
  documentLinks    DocumentLink[]
  noteLinks        NoteLink[]
  tags             TagAssignment[]

  @@index([status])
  @@index([deletedAt])
}

model ProjectClient {
  projectId String
  clientId  String
  role      String?
  createdAt DateTime @default(now())
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  client    Client   @relation(fields: [clientId], references: [id])
  @@id([projectId, clientId])
  @@index([clientId])
}

model ProjectLink {
  id        String           @id @default(cuid())
  projectId String
  group     ProjectLinkGroup
  label     String
  url       String
  order     Int              @default(0)
  createdAt DateTime         @default(now())
  updatedAt DateTime         @updatedAt
  project   Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@index([projectId, group, order])
}

model Technology {
  id        String       @id @default(cuid())
  name      String       @unique
  slug      String       @unique
  category  TechCategory
  iconSlug  String?
  color     String?
  active    Boolean      @default(true)
  projects  ProjectTechnology[]
}

model ProjectTechnology {
  projectId    String
  technologyId String
  project      Project    @relation(fields: [projectId], references: [id], onDelete: Cascade)
  technology   Technology @relation(fields: [technologyId], references: [id])
  @@id([projectId, technologyId])
  @@index([technologyId])
}

// ───────────────────────────── ESQUEMA DE COBRO ─────────────────────────────

model BillingPlan {
  id             String       @id @default(cuid())
  projectId      String       @unique
  model          BillingModel
  currency       String
  contractAmount Decimal?     @db.Decimal(18, 2)
  notes          String?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  project        Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  currencyRef    Currency     @relation(fields: [currency], references: [code])
  installments   BillingInstallment[]
}

model BillingInstallment {
  id                String            @id @default(cuid())
  projectId         String
  billingPlanId     String?
  recurringChargeId String?
  kind              InstallmentKind
  label             String
  amount            Decimal           @db.Decimal(18, 2)
  currency          String
  percentage        Decimal?          @db.Decimal(5, 2)
  dueDate           DateTime?         @db.Date
  trigger           String?
  periodStart       DateTime?         @db.Date
  periodEnd         DateTime?         @db.Date
  order             Int               @default(0)
  status            InstallmentStatus @default(PENDIENTE)
  cancelledAt       DateTime?
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt

  project         Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  billingPlan     BillingPlan?     @relation(fields: [billingPlanId], references: [id])
  recurringCharge RecurringCharge? @relation(fields: [recurringChargeId], references: [id])
  currencyRef     Currency         @relation(fields: [currency], references: [code])
  invoiceLines    InvoiceLine[]

  @@unique([recurringChargeId, periodStart])
  @@index([projectId, status])
  @@index([dueDate])
}

model RecurringCharge {
  id                       String          @id @default(cuid())
  projectId                String
  label                    String
  amount                   Decimal         @db.Decimal(18, 2)
  currency                 String
  frequency                Frequency
  startDate                DateTime        @db.Date
  endDate                  DateTime?       @db.Date
  billingDay               Int             // 1..28
  leadDays                 Int             @default(7)
  status                   RecurringStatus @default(ACTIVO)
  lastGeneratedPeriodStart DateTime?       @db.Date
  createdAt                DateTime        @default(now())
  updatedAt                DateTime        @updatedAt

  project      Project              @relation(fields: [projectId], references: [id], onDelete: Cascade)
  currencyRef  Currency             @relation(fields: [currency], references: [code])
  installments BillingInstallment[]

  @@index([status])
}

// ───────────────────────────── FACTURAS ─────────────────────────────

model Invoice {
  id             String        @id @default(cuid())
  code           String        @unique
  clientId       String
  invoiceNumber  String
  controlNumber  String?
  issueDate      DateTime      @db.Date
  dueDate        DateTime      @db.Date
  currency       String
  usdRate        Decimal       @db.Decimal(20, 8)
  bcvRate        Decimal?      @db.Decimal(20, 8)
  subtotal       Decimal       @db.Decimal(18, 2)
  discount       Decimal       @default(0) @db.Decimal(18, 2)
  exemptAmount   Decimal       @default(0) @db.Decimal(18, 2)
  taxBase        Decimal       @db.Decimal(18, 2)
  ivaRate        Decimal       @db.Decimal(5, 2)
  ivaAmount      Decimal       @db.Decimal(18, 2)
  total          Decimal       @db.Decimal(18, 2)
  ivaWithheld    Decimal       @default(0) @db.Decimal(18, 2)
  islrWithheld   Decimal       @default(0) @db.Decimal(18, 2)
  otherWithheld  Decimal       @default(0) @db.Decimal(18, 2)
  otherWithheldNote String?
  receivable     Decimal       @db.Decimal(18, 2)
  totalUsd       Decimal       @db.Decimal(18, 2)
  receivableUsd  Decimal       @db.Decimal(18, 2)
  paidAmount     Decimal       @default(0) @db.Decimal(18, 2)   // caché
  balance        Decimal       @db.Decimal(18, 2)               // caché
  isDraft        Boolean       @default(false)
  status         InvoiceStatus @default(EMITIDA)
  voidedAt       DateTime?
  voidReason     String?
  fileId         String?       @unique
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  createdById    String?
  updatedById    String?
  deletedAt      DateTime?
  deletedById    String?

  client        Client              @relation(fields: [clientId], references: [id])
  currencyRef   Currency            @relation(fields: [currency], references: [code])
  file          File?               @relation("InvoiceFile", fields: [fileId], references: [id])
  lines         InvoiceLine[]
  allocations   PaymentAllocation[]
  documentLinks DocumentLink[]
  noteLinks     NoteLink[]
  tags          TagAssignment[]

  @@index([clientId, status])
  @@index([dueDate])
  @@index([issueDate])
  // Unicidad de invoiceNumber entre las no archivadas: índice parcial en la migración SQL (§10.3)
}

model InvoiceLine {
  id            String   @id @default(cuid())
  invoiceId     String
  projectId     String?
  installmentId String?
  description   String
  quantity      Decimal  @default(1) @db.Decimal(12, 2)
  unitPrice     Decimal  @db.Decimal(18, 2)
  amount        Decimal  @db.Decimal(18, 2)
  order         Int      @default(0)

  invoice     Invoice             @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  project     Project?            @relation(fields: [projectId], references: [id])
  installment BillingInstallment? @relation(fields: [installmentId], references: [id])

  @@index([projectId])
  @@index([installmentId])
}

// ───────────────────────────── PAGOS ─────────────────────────────

model PaymentMethod {
  id                String    @id @default(cuid())
  code              String    @unique   // ZELLE, PAGO_MOVIL, ...
  name              String
  nameEn            String?
  requiresReference Boolean   @default(true)
  suggestsIgtf      Boolean   @default(false)
  active            Boolean   @default(true)
  payments          Payment[]
}

model Payment {
  id                String        @id @default(cuid())
  code              String        @unique
  clientId          String
  date              DateTime      @db.Date
  accountId         String
  methodId          String
  currency          String
  amount            Decimal       @db.Decimal(18, 2)
  igtfAmount        Decimal       @default(0) @db.Decimal(18, 2)
  feeAmount         Decimal       @default(0) @db.Decimal(18, 2)
  netCredited       Decimal       @db.Decimal(18, 2)
  allocatable       Decimal       @db.Decimal(18, 2)
  unallocated       Decimal       @db.Decimal(18, 2)  // caché
  usdRate           Decimal       @db.Decimal(20, 8)
  amountUsd         Decimal       @db.Decimal(18, 2)
  reference         String?
  status            PaymentStatus @default(CONFIRMADO)
  receiptFileId     String?       @unique
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt
  createdById       String?
  updatedById       String?
  deletedAt         DateTime?
  deletedById       String?

  client        Client              @relation(fields: [clientId], references: [id])
  account       Account             @relation(fields: [accountId], references: [id])
  method        PaymentMethod       @relation(fields: [methodId], references: [id])
  currencyRef   Currency            @relation(fields: [currency], references: [code])
  receiptFile   File?               @relation("PaymentReceipt", fields: [receiptFileId], references: [id])
  allocations   PaymentAllocation[]
  documentLinks DocumentLink[]
  noteLinks     NoteLink[]
  tags          TagAssignment[]

  @@index([clientId, date])
  @@index([accountId, date])
  @@index([reference])
}

model PaymentAllocation {
  id                    String    @id @default(cuid())
  paymentId             String
  invoiceId             String
  amountPaymentCurrency Decimal   @db.Decimal(18, 2)
  amountInvoiceCurrency Decimal   @db.Decimal(18, 2)
  amountUsd             Decimal   @db.Decimal(18, 2)
  createdAt             DateTime  @default(now())
  createdById           String?
  deletedAt             DateTime?

  payment Payment @relation(fields: [paymentId], references: [id])
  invoice Invoice @relation(fields: [invoiceId], references: [id])

  @@index([invoiceId])
  @@index([paymentId])
  // Unicidad (paymentId, invoiceId) entre las no anuladas: índice parcial (§10.3)
}

// ───────────────────────────── CUENTAS ─────────────────────────────

model Account {
  id               String      @id @default(cuid())
  name             String
  type             AccountType
  institution      String?
  currency         String
  identifierMasked String?
  holderName       String?
  openingBalance   Decimal     @default(0) @db.Decimal(18, 2)
  openingDate      DateTime    @db.Date
  active           Boolean     @default(true)
  notes            String?
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt
  deletedAt        DateTime?

  currencyRef       Currency          @relation(fields: [currency], references: [code])
  payments          Payment[]
  expenses          Expense[]
  recurringExpenses RecurringExpense[]
  transfersOut      AccountTransfer[] @relation("TransferFrom")
  transfersIn       AccountTransfer[] @relation("TransferTo")
  movements         AccountMovement[]
  reconciliations   AccountReconciliation[]
}

model AccountTransfer {
  id            String    @id @default(cuid())
  date          DateTime  @db.Date
  fromAccountId String
  toAccountId   String
  amountFrom    Decimal   @db.Decimal(18, 2)
  amountTo      Decimal   @db.Decimal(18, 2)
  feeAmount     Decimal   @default(0) @db.Decimal(18, 2)
  rate          Decimal?  @db.Decimal(20, 8)
  amountUsd     Decimal   @db.Decimal(18, 2)
  reference     String?
  notes         String?
  createdAt     DateTime  @default(now())
  createdById   String?
  deletedAt     DateTime?

  fromAccount Account @relation("TransferFrom", fields: [fromAccountId], references: [id])
  toAccount   Account @relation("TransferTo", fields: [toAccountId], references: [id])
}

model AccountMovement {
  id          String              @id @default(cuid())
  accountId   String
  type        AccountMovementType
  date        DateTime            @db.Date
  amount      Decimal             @db.Decimal(18, 2)  // con signo
  amountUsd   Decimal             @db.Decimal(18, 2)
  partnerId   String?             // socio, en APORTE y RETIRO
  description String
  createdAt   DateTime            @default(now())
  createdById String?
  deletedAt   DateTime?

  account Account @relation(fields: [accountId], references: [id])
  partner User?   @relation(fields: [partnerId], references: [id])
}

model AccountReconciliation {
  id              String   @id @default(cuid())
  accountId       String
  date            DateTime @db.Date
  statementBalance Decimal @db.Decimal(18, 2)
  systemBalance   Decimal  @db.Decimal(18, 2)
  difference      Decimal  @db.Decimal(18, 2)
  notes           String?
  createdAt       DateTime @default(now())
  createdById     String?
  account         Account  @relation(fields: [accountId], references: [id])
}

// ───────────────────────────── GASTOS ─────────────────────────────

model ExpenseCategory {
  id        String            @id @default(cuid())
  name      String
  nameEn    String?
  color     String?
  parentId  String?
  active    Boolean           @default(true)
  parent    ExpenseCategory?  @relation("CategoryTree", fields: [parentId], references: [id])
  children  ExpenseCategory[] @relation("CategoryTree")
  expenses  Expense[]
  recurring RecurringExpense[]
}

model Expense {
  id                 String        @id @default(cuid())
  code               String        @unique
  date               DateTime      @db.Date
  dueDate            DateTime?     @db.Date
  paidAt             DateTime?     @db.Date
  description        String
  vendor             String?
  categoryId         String
  accountId          String?
  projectId          String?
  currency           String
  amount             Decimal       @db.Decimal(18, 2)
  accountAmount      Decimal?      @db.Decimal(18, 2)   // monto debitado en la moneda de la cuenta
  usdRate            Decimal       @db.Decimal(20, 8)
  amountUsd          Decimal       @db.Decimal(18, 2)
  status             ExpenseStatus @default(PAGADO)
  receiptFileId      String?       @unique
  recurringExpenseId String?
  periodStart        DateTime?     @db.Date
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt
  createdById        String?
  updatedById        String?
  deletedAt          DateTime?
  deletedById        String?

  category      ExpenseCategory   @relation(fields: [categoryId], references: [id])
  account       Account?          @relation(fields: [accountId], references: [id])
  project       Project?          @relation(fields: [projectId], references: [id])
  currencyRef   Currency          @relation(fields: [currency], references: [code])
  receiptFile   File?             @relation("ExpenseReceipt", fields: [receiptFileId], references: [id])
  recurring     RecurringExpense? @relation(fields: [recurringExpenseId], references: [id])
  documentLinks DocumentLink[]
  noteLinks     NoteLink[]
  tags          TagAssignment[]

  @@unique([recurringExpenseId, periodStart])
  @@index([date])
  @@index([status, dueDate])
  @@index([projectId])
}

model RecurringExpense {
  id                       String          @id @default(cuid())
  name                     String
  vendor                   String?
  categoryId               String
  accountId                String?
  projectId                String?
  currency                 String
  amount                   Decimal         @db.Decimal(18, 2)
  frequency                Frequency
  dayOfPeriod              Int             // 1..28
  leadDays                 Int             @default(5)
  startDate                DateTime        @db.Date
  endDate                  DateTime?       @db.Date
  status                   RecurringStatus @default(ACTIVO)
  lastGeneratedPeriodStart DateTime?       @db.Date
  createdAt                DateTime        @default(now())
  updatedAt                DateTime        @updatedAt
  deletedAt                DateTime?

  category    ExpenseCategory @relation(fields: [categoryId], references: [id])
  account     Account?        @relation(fields: [accountId], references: [id])
  project     Project?        @relation(fields: [projectId], references: [id])
  currencyRef Currency        @relation(fields: [currency], references: [code])
  expenses    Expense[]
}

// ───────────────────────────── DOCUMENTOS ─────────────────────────────

model DocumentCategory {
  id     String         @id @default(cuid())
  name   String
  nameEn String?
  color  String?
  order  Int            @default(0)
  types  DocumentType[]
}

model DocumentType {
  id                String           @id @default(cuid())
  categoryId        String
  name              String
  nameEn            String?
  requiresSignature Boolean          @default(false)
  hasExpiration     Boolean          @default(false)
  defaultFormat     DocumentFormat   @default(ARCHIVO)
  active            Boolean          @default(true)
  category          DocumentCategory @relation(fields: [categoryId], references: [id])
  documents         Document[]
}

model Document {
  id               String         @id @default(cuid())
  code             String         @unique
  title            String
  typeId           String
  summary          String?
  status           DocumentStatus @default(BORRADOR)
  draftContent     String?        // autoguardado markdown
  draftUpdatedAt   DateTime?
  currentVersionId String?        @unique
  effectiveDate    DateTime?      @db.Date
  signedAt         DateTime?      @db.Date
  expiresAt        DateTime?      @db.Date
  alertDaysBefore  Int            @default(30)
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt
  createdById      String?
  updatedById      String?
  deletedAt        DateTime?
  deletedById      String?

  type           DocumentType        @relation(fields: [typeId], references: [id])
  currentVersion DocumentVersion?    @relation("CurrentVersion", fields: [currentVersionId], references: [id])
  versions       DocumentVersion[]   @relation("DocumentVersions")
  links          DocumentLink[]
  noteLinks      NoteLink[]
  tags           TagAssignment[]
  shares         ShareLinkDocument[]

  @@index([status])
  @@index([expiresAt])
}

model DocumentVersion {
  id            String         @id @default(cuid())
  documentId    String
  versionNumber Int
  format        DocumentFormat
  content       String?        // markdown
  fileId        String?        @unique
  url           String?
  changelog     String?
  createdAt     DateTime       @default(now())
  createdById   String

  document      Document            @relation("DocumentVersions", fields: [documentId], references: [id], onDelete: Cascade)
  currentOf     Document?           @relation("CurrentVersion")
  file          File?               @relation("VersionFile", fields: [fileId], references: [id])
  sharedIn      ShareLinkDocument[]

  @@unique([documentId, versionNumber])
}

model DocumentLink {
  id          String   @id @default(cuid())
  documentId  String
  clientId    String?
  contactId   String?
  projectId   String?
  invoiceId   String?
  paymentId   String?
  expenseId   String?
  createdAt   DateTime @default(now())
  createdById String?

  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  client   Client?  @relation(fields: [clientId], references: [id])
  contact  Contact? @relation(fields: [contactId], references: [id])
  project  Project? @relation(fields: [projectId], references: [id])
  invoice  Invoice? @relation(fields: [invoiceId], references: [id])
  payment  Payment? @relation(fields: [paymentId], references: [id])
  expense  Expense? @relation(fields: [expenseId], references: [id])

  @@unique([documentId, clientId])
  @@unique([documentId, contactId])
  @@unique([documentId, projectId])
  @@unique([documentId, invoiceId])
  @@unique([documentId, paymentId])
  @@unique([documentId, expenseId])
  @@index([clientId])
  @@index([projectId])
  @@index([invoiceId])
  // CHECK num_nonnulls(...) = 1  (§10.3)
}

// ───────────────────────────── NOTAS ─────────────────────────────

model Note {
  id          String    @id @default(cuid())
  title       String?
  content     Json      // Tiptap JSON
  contentText String    // texto plano
  authorId    String
  pinned      Boolean   @default(false)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?
  deletedById String?

  author      User             @relation(fields: [authorId], references: [id])
  links       NoteLink[]
  attachments NoteAttachment[]
  tags        TagAssignment[]

  @@index([authorId, createdAt])
}

model NoteLink {
  id         String    @id @default(cuid())
  noteId     String
  clientId   String?
  contactId  String?
  projectId  String?
  documentId String?
  invoiceId  String?
  paymentId  String?
  expenseId  String?
  createdAt  DateTime  @default(now())

  note     Note      @relation(fields: [noteId], references: [id], onDelete: Cascade)
  client   Client?   @relation(fields: [clientId], references: [id])
  contact  Contact?  @relation(fields: [contactId], references: [id])
  project  Project?  @relation(fields: [projectId], references: [id])
  document Document? @relation(fields: [documentId], references: [id])
  invoice  Invoice?  @relation(fields: [invoiceId], references: [id])
  payment  Payment?  @relation(fields: [paymentId], references: [id])
  expense  Expense?  @relation(fields: [expenseId], references: [id])

  @@unique([noteId, clientId])
  @@unique([noteId, contactId])
  @@unique([noteId, projectId])
  @@unique([noteId, documentId])
  @@unique([noteId, invoiceId])
  @@unique([noteId, paymentId])
  @@unique([noteId, expenseId])
  @@index([clientId])
  @@index([projectId])
  @@index([documentId])
}

model NoteAttachment {
  noteId String
  fileId String
  note   Note   @relation(fields: [noteId], references: [id], onDelete: Cascade)
  file   File   @relation(fields: [fileId], references: [id])
  @@id([noteId, fileId])
}

// ───────────────────────────── ARCHIVOS ─────────────────────────────

model File {
  id           String     @id @default(cuid())
  storageKey   String     @unique   // p. ej. "documents/2026/10/<cuid>-contrato.pdf"
  bucket       String
  originalName String
  mimeType     String
  sizeBytes    Int
  sha256       String?
  status       FileStatus @default(PENDING)
  uploadedById String
  createdAt    DateTime   @default(now())
  deletedAt    DateTime?

  uploadedBy      User              @relation(fields: [uploadedById], references: [id])
  invoice         Invoice?          @relation("InvoiceFile")
  paymentReceipt  Payment?          @relation("PaymentReceipt")
  expenseReceipt  Expense?          @relation("ExpenseReceipt")
  documentVersion DocumentVersion?  @relation("VersionFile")
  noteAttachments NoteAttachment[]

  @@index([status, createdAt])
}

// ───────────────────────────── ETIQUETAS ─────────────────────────────

model Tag {
  id          String          @id @default(cuid())
  name        String          @unique
  color       String
  createdAt   DateTime        @default(now())
  assignments TagAssignment[]
}

model TagAssignment {
  id         String    @id @default(cuid())
  tagId      String
  clientId   String?
  contactId  String?
  projectId  String?
  invoiceId  String?
  paymentId  String?
  expenseId  String?
  documentId String?
  noteId     String?
  createdAt  DateTime  @default(now())

  tag      Tag       @relation(fields: [tagId], references: [id], onDelete: Cascade)
  client   Client?   @relation(fields: [clientId], references: [id])
  contact  Contact?  @relation(fields: [contactId], references: [id])
  project  Project?  @relation(fields: [projectId], references: [id])
  invoice  Invoice?  @relation(fields: [invoiceId], references: [id])
  payment  Payment?  @relation(fields: [paymentId], references: [id])
  expense  Expense?  @relation(fields: [expenseId], references: [id])
  document Document? @relation(fields: [documentId], references: [id])
  note     Note?     @relation(fields: [noteId], references: [id])

  @@unique([tagId, clientId])
  @@unique([tagId, contactId])
  @@unique([tagId, projectId])
  @@unique([tagId, invoiceId])
  @@unique([tagId, paymentId])
  @@unique([tagId, expenseId])
  @@unique([tagId, documentId])
  @@unique([tagId, noteId])
}

// ───────────────────────────── PORTAL ─────────────────────────────

model ShareLink {
  id             String    @id @default(cuid())
  token          String    @unique
  title          String
  message        String?
  clientId       String?
  locale         String    @default("es")
  allowDownload  Boolean   @default(true)
  expiresAt      DateTime?
  revokedAt      DateTime?
  viewCount      Int       @default(0)
  downloadCount  Int       @default(0)
  lastAccessedAt DateTime?
  createdAt      DateTime  @default(now())
  createdById    String

  client    Client?             @relation(fields: [clientId], references: [id])
  documents ShareLinkDocument[]
  accessLog ShareAccessLog[]
}

model ShareLinkDocument {
  shareLinkId String
  documentId  String
  versionId   String?   // null = siempre la versión vigente
  order       Int       @default(0)

  shareLink ShareLink        @relation(fields: [shareLinkId], references: [id], onDelete: Cascade)
  document  Document         @relation(fields: [documentId], references: [id])
  version   DocumentVersion? @relation(fields: [versionId], references: [id])

  @@id([shareLinkId, documentId])
}

model ShareAccessLog {
  id          String     @id @default(cuid())
  shareLinkId String
  documentId  String?
  event       ShareEvent
  ipHash      String
  userAgent   String?
  createdAt   DateTime   @default(now())
  shareLink   ShareLink  @relation(fields: [shareLinkId], references: [id], onDelete: Cascade)
  @@index([shareLinkId, createdAt])
}

// ───────────────────────────── TRANSVERSALES ─────────────────────────────

model Currency {
  code     String  @id            // ISO 4217 o "USDT"
  name     String
  symbol   String
  decimals Int     @default(2)
  active   Boolean @default(true)

  rates             ExchangeRate[]
  billingPlans      BillingPlan[]
  installments      BillingInstallment[]
  recurringCharges  RecurringCharge[]
  invoices          Invoice[]
  payments          Payment[]
  accounts          Account[]
  expenses          Expense[]
  recurringExpenses RecurringExpense[]
}

model ExchangeRate {
  id          String     @id @default(cuid())
  date        DateTime   @db.Date
  currency    String
  usdRate     Decimal    @db.Decimal(20, 8)
  source      RateSource @default(MANUAL)
  createdAt   DateTime   @default(now())
  createdById String?
  currencyRef Currency   @relation(fields: [currency], references: [code])
  @@unique([date, currency, source])
  @@index([currency, date])
}

model ActivityLog {
  id          String         @id @default(cuid())
  actorType   ActorType
  actorId     String?
  action      ActivityAction
  entityType  EntityType
  entityId    String
  entityLabel String
  changes     Json?
  metadata    Json?
  ip          String?
  userAgent   String?
  createdAt   DateTime       @default(now())
  actor       User?          @relation(fields: [actorId], references: [id])

  @@index([entityType, entityId, createdAt])
  @@index([actorId, createdAt])
  @@index([createdAt])
}

model SearchEntry {
  id         String     @id @default(cuid())
  entityType EntityType
  entityId   String
  code       String?
  title      String
  subtitle   String?
  body       String?
  status     String?
  archived   Boolean    @default(false)
  updatedAt  DateTime   @updatedAt
  // columna tsvector generada + índices GIN en la migración SQL (§10.3)
  @@unique([entityType, entityId])
}

model Sequence {
  name  String @id   // "CLI", "PRY", "FAC", "PAG", "GAS", "DOC"
  value Int    @default(0)
}

model Setting {
  key       String   @id   // "company", "fiscal", "invoice.defaultDueDays", ...
  value     Json
  updatedAt DateTime @updatedAt
}
```

#### 10.2.1 Configuración de Prisma 7

```ts
// prisma.config.ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: env('DIRECT_URL') },   // conexión directa (sin pooler) para Migrate
});
```

```ts
// src/server/db/client.ts
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! }); // pooled
export const prisma = new PrismaClient({ adapter }).$extends(softDeleteExtension);
```

### 10.3 Migración SQL complementaria

Prisma no expresa estos elementos de forma nativa, así que se añaden en una migración SQL personalizada:

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Vínculos polimórficos: exactamente una FK no nula
ALTER TABLE "DocumentLink"  ADD CONSTRAINT doclink_one_target
  CHECK (num_nonnulls("clientId","contactId","projectId","invoiceId","paymentId","expenseId") = 1);
ALTER TABLE "NoteLink"      ADD CONSTRAINT notelink_one_target
  CHECK (num_nonnulls("clientId","contactId","projectId","documentId","invoiceId","paymentId","expenseId") = 1);
ALTER TABLE "TagAssignment" ADD CONSTRAINT tag_one_target
  CHECK (num_nonnulls("clientId","contactId","projectId","invoiceId","paymentId","expenseId","documentId","noteId") = 1);

-- Unicidades que respetan el borrado lógico
CREATE UNIQUE INDEX client_taxid_country_active  ON "Client"("taxId","country") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX invoice_number_active        ON "Invoice"("invoiceNumber") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX allocation_unique_active     ON "PaymentAllocation"("paymentId","invoiceId") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX contact_one_primary          ON "Contact"("clientId") WHERE "isPrimary" AND "deletedAt" IS NULL;

-- Reglas de integridad
ALTER TABLE "RecurringCharge"  ADD CONSTRAINT rc_billing_day  CHECK ("billingDay"  BETWEEN 1 AND 28);
ALTER TABLE "RecurringExpense" ADD CONSTRAINT re_day          CHECK ("dayOfPeriod" BETWEEN 1 AND 28);
ALTER TABLE "AccountTransfer"  ADD CONSTRAINT tr_diff_account CHECK ("fromAccountId" <> "toAccountId");
ALTER TABLE "Payment"          ADD CONSTRAINT pay_amounts     CHECK ("amount" > 0 AND "igtfAmount" >= 0 AND "feeAmount" >= 0);

-- Búsqueda
CREATE TEXT SEARCH CONFIGURATION es_unaccent ( COPY = simple );
ALTER TEXT SEARCH CONFIGURATION es_unaccent ALTER MAPPING FOR hword, hword_part, word WITH unaccent, simple;

ALTER TABLE "SearchEntry" ADD COLUMN search tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('es_unaccent', coalesce("code",'')),     'A') ||
  setweight(to_tsvector('es_unaccent', coalesce("title",'')),    'A') ||
  setweight(to_tsvector('es_unaccent', coalesce("subtitle",'')), 'B') ||
  setweight(to_tsvector('es_unaccent', coalesce("body",'')),     'C')
) STORED;
CREATE INDEX search_entry_fts  ON "SearchEntry" USING GIN (search);
CREATE INDEX search_entry_trgm ON "SearchEntry" USING GIN ("title" gin_trgm_ops);
```

### 10.4 Semilla (`prisma/seed.ts`)

- **Monedas:** USD, VES, EUR, USDT, COP.
- **Métodos de pago:** Transferencia nacional, Pago Móvil, Transferencia internacional, Zelle, Zinli, PayPal, USDT/Cripto, Efectivo USD, Efectivo VES, Otro.
- **Categorías y tipos de documento** según §8.9.1.
- **Categorías de gasto** según §8.8.
- **Unas 60 tecnologías.**
- **Settings fiscales:** IVA 16, IGTF 3, vencimiento de factura a 15 días.
- **Secuencias en 0:** `CLI`, `PRY`, `FAC`, `PAG`, `GAS`, `DOC`.

Los códigos se generan dentro de la transacción con `UPDATE "Sequence" SET value = value + 1 WHERE name = $1 RETURNING value` y se formatean con relleno a 4 dígitos.

---

## 11. Mapa de rutas

| Ruta | Descripción | Acceso |
|---|---|---|
| `/sign-in` | Inicio de sesión (Clerk) | Público |
| `/dashboard` | Dashboard general | Owner, Admin. Member y Viewer ven una versión sin datos financieros. |
| `/clients` · `/clients/list` · `/clients/new` | Overview, tabla y alta de clientes | Según §4.3 |
| `/clients/[id]` · `/edit` · `/graph` | Detalle (pestañas por `?tab=`), edición y grafo | |
| `/projects` · `/projects/list` · `/projects/new` | Overview, tabla y alta de proyectos | |
| `/projects/[id]` · `/edit` · `/graph` · `/billing` | Detalle, edición, grafo y editor del esquema de cobro | |
| `/invoices` · `/invoices/list` · `/invoices/new` | Overview, tabla y alta de facturas. Admite `?clientId=` y `?installments=` para precargar. | |
| `/invoices/[id]` · `/edit` · `/graph` | Detalle, edición y grafo | |
| `/payments` · `/payments/list` · `/payments/new` | Overview, tabla y alta de pagos. Admite `?invoiceId=` para precargar. | |
| `/payments/[id]` · `/edit` · `/graph` | Detalle, edición y grafo | |
| `/expenses` · `/expenses/list` · `/expenses/new` | Overview, tabla y alta de gastos | |
| `/expenses/recurring` · `/expenses/recurring/new` · `/expenses/recurring/[id]` | Gastos recurrentes | |
| `/expenses/[id]` · `/edit` · `/graph` | Detalle, edición y grafo | |
| `/accounts` · `/accounts/new` | Overview (tarjetas) y alta de cuentas | |
| `/accounts/[id]` · `/edit` | Libro de la cuenta, conciliación y edición | |
| `/accounts/transfers/new` · `/accounts/movements/new` | Transferencia entre cuentas y movimiento manual | |
| `/documents` · `/documents/list` · `/documents/new` | Overview, tabla y alta de documentos | |
| `/documents/[id]` · `/edit` · `/graph` | Detalle y edición de metadatos | |
| `/documents/[id]/editor` | Editor markdown a pantalla completa | |
| `/documents/[id]/versions/[versionId]` | Ver una versión o compararla con la vigente | |
| `/documents/shares` · `/documents/shares/[id]` | Enlaces de portal | |
| `/notes` · `/notes/new` · `/notes/[id]` | Tabla global de notas, alta y detalle o edición | |
| `/graph` | Grafo global | |
| `/reports` · `/reports/[report]` | KPI y reportes detallados | Owner, Admin |
| `/activity` | Registro de actividad global | Owner, Admin |
| `/settings/*` | `company`, `users`, `preferences`, `currencies`, `rates`, `fiscal`, `payment-methods`, `technologies`, `document-types`, `expense-categories`, `tags`, `trash` | Según §4.3 |
| `/s/[token]` | Portal público | Público, con token |
| `/api/webhooks/clerk` | Sincronización de usuarios | Firma de Svix |
| `/api/files/[id]/download` | Redirección a una URL prefirmada | Autenticado |
| `/api/s/[token]/files/[documentId]` | Descarga desde el portal | Token válido |

---

## 12. Capa de servicios y Server Actions

Todas las mutaciones devuelven `ActionResult<T> = { ok: true; data: T } | { ok: false; error: { code; message; fieldErrors? } }`.

| Módulo | Servicios principales |
|---|---|
| clients | `createClient`, `updateClient`, `setClientStatus`, `archiveClient`, `restoreClient`, `listClients(filters)`, `getClient(id)`, `getClientFinancials(id)` |
| contacts | `createContact`, `updateContact`, `setPrimaryContact`, `archiveContact` |
| projects | `createProject`, `updateProject`, `setProjectStatus`, `setProjectClients`, `setProjectTechnologies`, `upsertProjectLinks`, `reorderProjectLinks`, `archiveProject`, `getProjectFinancials(id)` |
| billing | `upsertBillingPlan`, `applyInstallmentTemplate`, `createInstallment`, `updateInstallment`, `cancelInstallment`, `createRecurringCharge`, `updateRecurringCharge`, `setRecurringChargeStatus`, `generateMissingPeriods`, `recomputeInstallmentStatus` |
| invoices | `createInvoice`, `updateInvoice`, `issueDraft`, `voidInvoice`, `archiveInvoice`, `recomputeInvoice(id)`, `listOpenInvoices(clientId)` |
| payments | `createPayment`, `updatePayment`, `setPaymentStatus`, `allocatePayment`, `deallocatePayment`, `detectDuplicatePayment` |
| accounts | `createAccount`, `updateAccount`, `getAccountLedger`, `getAccountBalance(at)`, `createTransfer`, `createMovement`, `reconcileAccount` |
| expenses | `createExpense`, `updateExpense`, `markExpensePaid`, `voidExpense`, `createRecurringExpense`, `updateRecurringExpense`, `setRecurringExpenseStatus` |
| documents | `createDocument`, `updateDocumentMeta`, `saveDraft`, `publishVersion`, `uploadVersion`, `restoreVersion`, `setDocumentStatus`, `linkDocument`, `unlinkDocument` |
| notes | `createNote`, `updateNote`, `pinNote`, `linkNote`, `unlinkNote`, `attachFile`, `archiveNote` |
| files | `requestUpload(meta)` (devuelve una URL prefirmada PUT y el `fileId`), `confirmUpload(fileId)`, `getDownloadUrl(fileId)` |
| shares | `createShareLink`, `updateShareLink`, `revokeShareLink`, `resolveShareToken` (público), `recordShareAccess` (público) |
| graph | `getEntityGraph`, `expandNode`, `getGlobalGraph` |
| search | `searchGlobal(q, filters)`, `reindexEntity(type, id)` |
| reports | Un servicio por reporte o KPI de §8.13 |
| activity | `logActivity` (interno), `listActivity(filters)` |
| settings | CRUD de catálogos, `upsertExchangeRate`, `importRatesCsv`, `getRateFor(date, currency)` |
| tags | `createTag`, `updateTag`, `assignTags`, `unassignTag` |
| export | `exportCsv(entity, filters, columns)` |

### Tareas programadas (Netlify Scheduled Functions)

| Tarea | Frecuencia | Qué hace |
|---|---|---|
| `daily-maintenance` | Diaria a las 06:00 VET (10:00 UTC) | 1. Recalcula el estado de las facturas con `dueDate < hoy` y saldo > 0 (pasan a `VENCIDA`). 2. Marca los documentos vencidos. 3. Genera las cuotas de los cobros recurrentes. 4. Genera los gastos recurrentes. 5. Marca como vencidos los enlaces de portal caducados (solo informativo). Cada paso es idempotente y queda en el registro de actividad como `SYSTEM_JOB`. |
| `cleanup-files` | Diaria | Elimina del bucket y de la base de datos los `File` en estado `PENDING` con más de 24 h de antigüedad. |

---

## 13. Historias de usuario y criterios de aceptación

Formato: **Como** socio, **quiero**… **para**… Los criterios de aceptación (CA) son verificables y sirven de base para las pruebas end-to-end.

### Autenticación y usuarios

**HU-01 · Acceso restringido.** Como socio, quiero que solo las personas invitadas puedan entrar, para proteger la información del estudio.
- CA1: Un email que no está en la lista de permitidos o sin invitación no puede registrarse ni entrar.
- CA2: Al entrar por primera vez se crea el `User` local mediante el webhook, con el rol que se asignó en la invitación.
- CA3: Cualquier ruta de `(app)` sin sesión redirige a `/sign-in`, y `/s/*` sigue siendo accesible sin sesión.
- CA4: Cada inicio de sesión queda en el registro de actividad como `LOGIN`.

**HU-02 · Roles.** Como Owner, quiero asignar roles, para habilitar colaboradores en el futuro.
- CA1: Solo el Owner ve la sección `/settings/users`.
- CA2: Si un Member invoca una acción financiera directamente desde el servidor, recibe el error `FORBIDDEN` y no se modifica nada.

### Clientes

**HU-03 · Registrar cliente.** Como socio, quiero registrar un cliente con sus datos fiscales, para tenerlo identificado.
- CA1: El formulario exige el tipo, el nombre comercial, la razón social (solo para empresas), el identificador fiscal, el país, la dirección y el teléfono.
- CA2: Al guardar se asigna un código `CLI-####` correlativo.
- CA3: Si ya existe un cliente activo con el mismo identificador fiscal y país, el sistema muestra un error con un enlace a ese registro.
- CA4: Se crea una entrada `CREATE` en la actividad y la entrada correspondiente en el índice de búsqueda.

**HU-04 · Contactos.** Como socio, quiero añadir varios contactos a un cliente, para saber con quién hablar.
- CA1: Un contacto exige el nombre y al menos un email o un teléfono.
- CA2: Marcar un contacto como principal desmarca el anterior.
- CA3: Los contactos aparecen en la búsqueda global y en el grafo del cliente.

### Proyectos

**HU-05 · Crear proyecto con varios clientes.** Como socio, quiero vincular un proyecto a uno o varios clientes.
- CA1: No se puede guardar un proyecto sin al menos un cliente.
- CA2: Cada vínculo con un cliente admite un rol opcional en texto.
- CA3: El proyecto aparece en la pestaña *Proyectos* de cada cliente vinculado.

**HU-06 · Stack desde el catálogo.** Como socio, quiero elegir el stack de una lista válida, para poder filtrar por tecnología.
- CA1: El selector solo muestra tecnologías activas del catálogo, agrupadas por categoría.
- CA2: Filtrar la tabla de proyectos por "Next.js" devuelve solo los proyectos que la usan.
- CA3: Una tecnología en uso no se puede borrar; solo se desactiva.

**HU-07 · Enlaces agrupados.** Como socio, quiero guardar los repositorios y enlaces del proyecto agrupados por tipo.
- CA1: Puedo añadir varios enlaces en el grupo `REPOSITORIO`.
- CA2: Puedo reordenar los enlaces arrastrándolos dentro de su grupo, y el orden se mantiene.
- CA3: Las URLs inválidas no se guardan y el error se muestra en el campo.

**HU-08 · Transiciones de estado.** Como socio, quiero cambiar el estado del proyecto con reglas claras.
- CA1: Pasar a `EN_CURSO` exige la fecha de inicio.
- CA2: Pasar a `ENTREGADO` exige la fecha real de entrega.
- CA3: Pasar a `CANCELADO` ofrece cancelar las cuotas pendientes y finalizar los cobros recurrentes.
- CA4: Cada cambio queda como `STATUS_CHANGE` en la actividad.

### Esquema de cobro

**HU-09 · Definir esquema con plantilla.** Como socio, quiero definir el esquema de cobro con una plantilla, para no calcular las cuotas a mano.
- CA1: Si elijo "40/30/30" con un monto contratado de 10 000 USD, se generan cuotas de 4 000, 3 000 y 3 000.
- CA2: Si la suma de las cuotas no `AJUSTE` difiere del monto contratado en más de 0,01, se muestra un aviso persistente.
- CA3: Una cuota ya facturada no permite cambiar su monto ni su moneda.

**HU-10 · Mantenimiento recurrente.** Como socio, quiero configurar un cobro mensual de mantenimiento, para recibir un aviso cada vez que haya que facturarlo.
- CA1: Un cobro mensual con día 5 y 7 días de anticipación genera la cuota del periodo el día 28 o 29 del mes anterior.
- CA2: Ejecutar la tarea dos veces el mismo día no duplica cuotas.
- CA3: Un cobro pausado no genera cuotas.
- CA4: La alerta "Cuota por facturar" aparece en la campana y en el dashboard.

### Facturas

**HU-11 · Registrar factura desde cuotas.** Como socio, quiero facturar cuotas pendientes de uno o varios proyectos del cliente en una sola factura.
- CA1: Al elegir el cliente se listan las cuotas `PENDIENTE` de todos sus proyectos, y al seleccionarlas se crean las líneas correspondientes.
- CA2: Los totales (base, IVA, total, retenciones, por cobrar y USD) se calculan en vivo según §9.3.
- CA3: El número de factura es único entre las facturas no archivadas.
- CA4: Puedo adjuntar el PDF de la factura real y verlo en el detalle.
- CA5: Al guardar, las cuotas seleccionadas pasan a `FACTURADA`.

**HU-12 · Estado automático.** Como socio, quiero que el estado de la factura se calcule solo.
- CA1: Una factura sin pagos y no vencida está `EMITIDA`.
- CA2: Con un pago confirmado menor que el saldo pasa a `PARCIAL`.
- CA3: Con el saldo ≤ 0,01 pasa a `PAGADA`.
- CA4: Si vence con saldo pendiente, la tarea diaria la marca `VENCIDA`.
- CA5: Anular exige un motivo y solo se permite sin asignaciones activas.

### Pagos

**HU-13 · Registrar pago y asignarlo.** Como socio, quiero registrar un pago y aplicarlo a una o varias facturas.
- CA1: El formulario exige el cliente, la fecha, la cuenta, el método, la moneda, el monto, la tasa y la referencia (si el método la requiere).
- CA2: Para el caso de un pago de 100 USD con IGTF de 3 y comisión de 0:
  - el monto asignable es 97;
  - el neto acreditado en la cuenta es 100.
- CA3: La suma de las asignaciones no puede superar el monto asignable, y cada asignación no puede superar el saldo de su factura.
- CA4: Si un pago está en VES y la factura en USD, el sistema propone el monto en USD con la tasa del día del pago, y el usuario lo puede editar.
- CA5: Lo que no se asigna queda como saldo a favor visible en el cliente y en el pago.
- CA6: Si existe otro pago con la misma referencia, el mismo método y la misma cuenta, se muestra un aviso de posible duplicado.

**HU-14 · Comprobante.** Como socio, quiero adjuntar el comprobante del pago.
- CA1: Se aceptan PDF, PNG, JPG y WEBP de hasta 10 MB, que se suben directamente al bucket.
- CA2: El comprobante se puede ver en el detalle sin descargarlo.

### Cuentas y gastos

**HU-15 · Saldos de cuentas.** Como socio, quiero ver el saldo de cada cuenta y el total en USD.
- CA1: El saldo cumple la fórmula de §9.7.
- CA2: El libro muestra cada movimiento con su saldo corrido.
- CA3: Una conciliación con diferencia sugiere un movimiento `AJUSTE` por ese monto.

**HU-16 · Transferencia entre cuentas.** Como socio, quiero mover dinero entre cuentas de distinta moneda.
- CA1: Una transferencia de 100 USD desde Zelle a Binance (USDT), recibiendo 99 USDT, descuenta 100 de la cuenta origen y suma 99 a la cuenta destino.
- CA2: No se puede transferir de una cuenta a sí misma.

**HU-17 · Gastos recurrentes.** Como socio, quiero que las suscripciones generen sus gastos automáticamente.
- CA1: Una suscripción mensual activa genera un gasto `PENDIENTE` por periodo, sin duplicados.
- CA2: "Marcar como pagado" exige la cuenta y permite ajustar el monto real y la tasa.
- CA3: Un gasto imputado a un proyecto reduce el margen de ese proyecto.

### Documentos

**HU-18 · Documento markdown versionado.** Como socio, quiero redactar un PRD en markdown dentro del sistema, con versiones.
- CA1: El editor guarda el borrador automáticamente sin crear una versión.
- CA2: "Publicar versión" crea la versión N+1, que pasa a ser la vigente.
- CA3: Puedo comparar cualquier versión con la vigente y restaurarla, lo que crea una versión nueva.
- CA4: La vista previa sanitiza el HTML: no ejecuta scripts ni iframes.

**HU-19 · Contrato con vencimiento.** Como socio, quiero registrar un contrato firmado con su fecha de vencimiento, para no perder renovaciones.
- CA1: Los tipos con firma exigen la fecha de firma al pasar a `FIRMADO`.
- CA2: El documento aparece en las alertas cuando faltan `alertDaysBefore` días para el vencimiento.
- CA3: Al día siguiente del vencimiento pasa a `VENCIDO` automáticamente.
- CA4: Un documento `FIRMADO` no admite versiones nuevas.

**HU-20 · Vincular un documento a varias entidades.** Como socio, quiero vincular un NDA a un cliente y a dos proyectos.
- CA1: El documento aparece en la pestaña *Documentos* de los tres registros.
- CA2: Desvincularlo de uno no afecta a los otros vínculos y queda como `UNLINK` en la actividad.

**HU-21 · Tipos configurables.** Como Admin, quiero crear tipos de documento dentro de categorías.
- CA1: Un tipo nuevo está disponible al instante en el formulario de documentos.
- CA2: Un tipo en uso no se puede borrar; solo se desactiva.

### Portal

**HU-22 · Compartir documentos.** Como socio, quiero compartir el contrato y el NDA con un cliente mediante un enlace.
- CA1: Se genera una URL `/s/<token>` con un token de 43 caracteres.
- CA2: Sin sesión, la URL muestra solo los documentos incluidos, con visor y descarga.
- CA3: Cambiar un carácter del token muestra "Enlace no disponible" con código 404.
- CA4: Si el enlace está revocado o vencido, muestra la misma página genérica.
- CA5: Cada visita y cada descarga quedan registradas, y los contadores aparecen en el detalle del enlace.
- CA6: Por defecto el enlace fija la versión vigente al momento de compartir. Una versión publicada después no cambia lo que ve el cliente, salvo que el enlace esté en modo "siempre la última".
- CA7: La respuesta incluye `X-Robots-Tag: noindex`.

### Notas

**HU-23 · Notas con texto enriquecido.** Como socio, quiero dejar notas con formato y adjuntos en cualquier registro.
- CA1: La nota guarda el autor, la fecha y las etiquetas, y admite varios adjuntos.
- CA2: Una nota puede vincularse a la vez a un cliente y a un proyecto.
- CA3: El contenido de la nota aparece en la búsqueda global.

### Grafo

**HU-24 · Grafo del registro.** Como socio, quiero ver las relaciones de un cliente en un grafo.
- CA1: El grafo carga el cliente como raíz junto con sus contactos, proyectos, facturas, pagos, documentos y notas directos.
- CA2: Al expandir un proyecto aparecen sus documentos, facturas, gastos y los otros clientes que comparten el proyecto.
- CA3: Pasar el cursor por un nodo muestra una tarjeta de vista previa, y "Abrir detalle" navega al registro.
- CA4: Los filtros por tipo ocultan o muestran nodos sin recargar la página.
- CA5: Con más de 50 vecinos aparece el nodo "+N más".

**HU-25 · Grafo global.** Como socio, quiero ver el mapa completo del estudio.
- CA1: Por defecto muestra clientes, proyectos y documentos con el layout de fuerzas.
- CA2: Buscar un nombre centra y resalta ese nodo.
- CA3: Con 500 nodos el desplazamiento y el zoom son fluidos (≥ 50 fps en un equipo de referencia).

### Transversales

**HU-26 · Búsqueda global.** Como socio, quiero encontrar cualquier registro con Cmd+K.
- CA1: Buscar "garcia" encuentra "García" (ignora acentos).
- CA2: Buscar "invsion" encuentra "Inversión" (similitud por trigramas).
- CA3: Buscar el código `FAC-0012` lleva directamente a esa factura.

**HU-27 · Tablas configurables y CSV.** Como socio, quiero ajustar las columnas y exportar lo que estoy viendo.
- CA1: Ocultar columnas en una tabla se mantiene al recargar y en otro dispositivo.
- CA2: El CSV contiene todas las filas del filtro (hasta 10 000) y solo las columnas visibles, y se abre correctamente en Excel.

**HU-28 · Papelera.** Como Admin, quiero restaurar un registro archivado por error.
- CA1: Un registro archivado desaparece de las tablas, la búsqueda y el grafo, salvo que se active "Mostrar archivados".
- CA2: Restaurarlo lo devuelve a su estado anterior y queda como `RESTORE` en la actividad.

**HU-29 · Registro de actividad.** Como socio, quiero saber quién cambió qué y cuándo.
- CA1: Editar el total de una factura registra el diff `total: [antes, después]`.
- CA2: Ningún usuario puede editar ni borrar entradas del registro.

**HU-30 · Bilingüe y tema.** Como usuario, quiero usar el sistema en español o inglés y en modo oscuro.
- CA1: Cambiar el idioma traduce toda la interfaz sin recargar los datos y formatea los números según el idioma.
- CA2: La preferencia de idioma y de tema se mantiene entre sesiones.

**HU-31 · KPI.** Como socio, quiero ver los KPI financieros y operativos del estudio.
- CA1: Cada KPI de §8.13.2 coincide con su fórmula sobre un conjunto de datos de prueba conocido (cubierto por pruebas unitarias).
- CA2: Cambiar el rango de fechas actualiza todas las tarjetas y gráficos.

---

## 14. Requisitos no funcionales

| Categoría | Requisito |
|---|---|
| Rendimiento | TTFB < 500 ms en p75 para las páginas de tabla con 10 000 registros. Mutaciones < 800 ms en p95. Búsqueda < 200 ms en p95. Grafo de detalle cargado en < 1,5 s. |
| Escala de diseño | Hasta 5 000 clientes, 2 000 proyectos, 50 000 facturas y pagos, y 20 000 documentos sin cambios de arquitectura. |
| Seguridad: autorización | Toda Server Action valida la sesión, `can()` y el esquema Zod. No se confía en ningún ID que venga del cliente sin verificar su existencia y su estado de borrado. |
| Seguridad: archivos | Bucket privado. URLs prefirmadas con TTL de 5 min. Validación del MIME por *magic bytes* al confirmar la subida. Lista de tipos permitidos (PDF, imágenes, DOCX, XLSX, PPTX, MD, TXT, ZIP). Tamaño máximo de 25 MB (configurable). |
| Seguridad: portal | Token de 256 bits. Rate limiting. Respuesta genérica de 404. IP guardada solo como hash con *salt*. Sin listados públicos. |
| Seguridad: cabeceras | CSP estricta (con los dominios de Clerk y del bucket en la lista de permitidos), HSTS, `X-Content-Type-Options` y `frame-ancestors 'none'`. |
| Seguridad: contenido | El markdown y el texto enriquecido se sanitizan siempre al renderizar. |
| Datos sensibles | No se guardan contraseñas, claves ni secretos de clientes; solo enlaces a un gestor de contraseñas. Los identificadores de cuentas se guardan enmascarados. |
| Integridad | Las operaciones con dinero y sus agregados (saldos, estados) se ejecutan en una transacción `Serializable` o con bloqueo `SELECT … FOR UPDATE` sobre la factura y el pago. |
| Respaldo | Neon PITR según el plan contratado. Exportación mensual (`pg_dump`) a un almacenamiento externo. Versionado del bucket, si está disponible. |
| Disponibilidad | 99,5 % mensual, heredado de Netlify, Neon y Clerk. |
| Accesibilidad | WCAG 2.1 AA: navegación completa por teclado (incluido el grafo, con una lista alternativa de nodos), contraste suficiente y etiquetas ARIA. |
| Responsive | Diseñado para escritorio, totalmente usable en tablet. En móvil, el dashboard, los detalles, el registro de pagos y gastos y las notas son usables; el grafo se puede consultar. |
| Internacionalización | Ninguna cadena de texto escrita directamente en los componentes. Hay una prueba en CI que detecta claves faltantes entre `es` y `en`. |
| Observabilidad | Sentry con el usuario y la acción como contexto (sin PII sensible). Logs estructurados en los servicios y en las tareas programadas. |
| Calidad | ESLint y Prettier. `tsc --noEmit` en CI. Cobertura ≥ 90 % en `lib/money`, `rates` y en los servicios de facturas, pagos, cuentas y billing. Pruebas end-to-end de las HU críticas (03, 09, 11, 13, 18, 22, 24). |
| CI/CD | GitHub Actions ejecuta lint, typecheck, pruebas unitarias y end-to-end contra una rama de Neon. Netlify crea un deploy preview por cada PR. Las migraciones se aplican con `prisma migrate deploy` en el build de producción. |
| Portabilidad | La capa de servicios no depende de Next.js (§6.4). El almacenamiento es compatible con S3. |

---

## 15. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Neon Object Storage está en **beta** | Alto | Usar la interfaz `StorageProvider` con un cliente S3 estándar. Tener documentado el plan de salida a Cloudflare R2 o S3: cambiar el endpoint y las credenciales y copiar los objetos con `rclone`. Hacer respaldos periódicos del bucket. |
| Alcance amplio con todo dentro del MVP | Alto | Entrega interna por fases (§16), con funcionalidades usables al cierre de cada una. Congelar el alcance durante el MVP. |
| Volatilidad cambiaria y tasas mal registradas | Medio | Guardar snapshots por transacción. Alerta de tasa faltante. Advertencia cuando la tasa ingresada difiere más de un 10 % de la última registrada. |
| Cambios normativos (IVA, IGTF, retenciones, factura electrónica) | Medio | Alícuotas y reglas como parámetros configurables. Validación con el contador. El sistema no actúa como libro fiscal. |
| Rendimiento del grafo global | Medio | Filtros por defecto, *clusters*, layout en un Web Worker y plan de migración a Sigma.js por encima de unos 1 500 nodos. |
| Límites de las funciones serverless de Netlify (tiempo de ejecución y tamaño de payload) | Medio | Subidas directas al bucket. CSV limitado a 10 000 filas. Tareas programadas idempotentes y procesadas por lotes. |
| Dependencia de Clerk | Bajo | Tabla `User` local como fuente de verdad del dominio. La autenticación queda aislada en `server/auth`. |
| Fuga de un enlace del portal | Medio | Vencimiento opcional, revocación inmediata, registro de accesos y versión fija por defecto. |
| Deriva entre las cachés (saldos, estados) y los datos | Medio | Recalcular siempre dentro de la transacción. Script `recompute-all` para auditoría, ejecutable bajo demanda. |

---

## 16. Plan de entrega del MVP

Todo lo definido en este documento es parte del MVP. Se propone construirlo en fases internas que se pueden usar a medida que se completan. Las fechas se fijarán con el equipo.

| Fase | Contenido | Resultado usable |
|---|---|---|
| **F0 · Fundaciones** | Repositorio, CI, Netlify y Neon (base de datos y bucket), Clerk y webhook, layout de la aplicación, i18n y tema, esquema Prisma con migraciones y semilla, `can()`, `logActivity`, `StorageProvider`, componentes base (data-table, MoneyInput, RateInput, combobox, uploader) | Login y estructura navegable |
| **F1 · Núcleo comercial** | Clientes, contactos, proyectos, enlaces, tecnologías, etiquetas, notas (Tiptap y adjuntos), papelera y actividad | Gestión de cartera y proyectos |
| **F2 · Finanzas** | Monedas y tasas, configuración fiscal, cuentas, esquema de cobro, facturas, pagos y asignaciones, transferencias y movimientos, gastos y recurrentes, tareas programadas | Control de facturación, cobranza y caja |
| **F3 · Documentos y portal** | Categorías y tipos, documentos en tres formatos, editor markdown, versionado, estados y vencimientos, vínculos, portal público y registro de accesos | Repositorio documental y portal para clientes |
| **F4 · Inteligencia** | Grafo de detalle y global, búsqueda global, dashboard y overview por módulo, reportes y KPI, alertas, exportación a CSV | Visión completa del estudio |
| **F5 · Endurecimiento** | Pruebas end-to-end de las HU críticas, auditoría de seguridad (cabeceras, autorización, portal), rendimiento, accesibilidad, migración de los datos existentes y documentación de operación | Lanzamiento del MVP |

---

## 17. Supuestos y preguntas abiertas

### Supuestos adoptados

Si alguno es incorrecto, hay que corregirlo antes de la Fase 2.

1. **Factura y cliente.** Una factura pertenece a **un solo cliente**, aunque abarque varios proyectos.
2. **Overview → Tabla.** Cada módulo tiene una página de overview (`/x`) separada de su tabla (`/x/list`).
3. **Dinero y almacenamiento:**
   - El modelo de cobro por horas queda fuera hasta que exista el registro de horas.
   - Los aportes y retiros de socios se registran como movimientos de cuenta, para que los saldos cuadren, pero sin lógica de reparto de utilidades.
   - Se usa Neon Object Storage, aun estando en beta, detrás de una interfaz intercambiable.
4. **Tasas e impuestos:**
   - La tasa BCV se carga manualmente en el MVP.
   - Se usa una sola alícuota de IVA por factura.

### Preguntas abiertas

| # | Pregunta |
|---|---|
| P1 | ¿Hace falta un reparto formal de utilidades entre socios (porcentajes, liquidaciones periódicas)? |
| P2 | ¿Alguna factura puede tener líneas con alícuotas distintas (16 % y 8 %, o gravado y exento por línea)? |
| P3 | ¿WeDevs es o será contribuyente especial? Esto cambia el tratamiento del IGTF y de las retenciones. Se debe validar con el contador. |
| P4 | ¿Se debe automatizar la obtención diaria de la tasa BCV en la Fase 2? |
| P5 | ¿El portal necesita contraseña o código opcional por enlace, además del token? |
| P6 | ¿Cuánto tiempo se conservan `ActivityLog` y `ShareAccessLog`? (Propuesta: indefinido y 24 meses, respectivamente.) |
| P7 | ¿Hay datos existentes (hojas de cálculo, Drive) que migrar? ¿En qué formato? Esto define si hace falta un importador CSV por entidad. |
| P8 | ¿Qué dominio se usará para la aplicación y para el portal? ¿Se quiere un subdominio separado para el portal, por ejemplo `docs.wedevs…`? |
| P9 | ¿El portal debe llevar la identidad visual completa de WeDevs (logo, colores)? ¿Existe ya un manual de marca? |

---

## Anexo · Referencias consultadas

- Neon Object Storage, documentación y anuncio de la beta: https://neon.com/docs/storage/get-started · https://neon.com/blog/building-neon-object-storage
- PwC Tax Summaries, Venezuela, otros impuestos (IVA, revisado en enero de 2026): https://taxsummaries.pwc.com/venezuela/corporate/other-taxes
- Referencia de IVA e IGTF en Venezuela 2026: https://hacecuentas.com/ve
