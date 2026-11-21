# Front · Perfiles Consultor y Administrador

Interfaz gráfica (HTML + CSS + JavaScript vanilla, **sin build ni dependencias**) para los perfiles de **consultor** y **administrador de empresa**, construida a partir de las maquetas de [`UI_mock/`](../../UI_mock).

> **Principios del diseño**
> 1. **Cero datos hardcodeados en las vistas.** Todo dato sale de un endpoint del backend (`js/api/endpoints.js`). Mientras el backend no esté listo, unos **mocks** separados responden con el mismo formato.
> 2. **Imagen de marca 100 % variable (white-label).** Logo, isotipo, nombre, colores, fuente, favicon, texto legal y perfil de voz llegan del backend (`GET /brand`) y se aplican en tiempo de ejecución con variables CSS. Ningún color de marca está escrito a fuego en los estilos.
> 3. **Un solo punto de integración.** Para conectar con el backend real solo hay que tocar `js/config.js` y, si cambian rutas o nombres de campo, `js/api/endpoints.js` / `normalizeBrand()`.

---

## Índice

1. [Arranque rápido](#1-arranque-rápido)
2. [Estructura de carpetas](#2-estructura-de-carpetas)
3. [Arquitectura y flujo de arranque](#3-arquitectura-y-flujo-de-arranque)
4. [Configuración de entorno](#4-configuración-de-entorno)
5. [Imagen de marca variable (white-label)](#5-imagen-de-marca-variable-white-label)
6. [Capa de datos: cliente, endpoints y mocks](#6-capa-de-datos-cliente-endpoints-y-mocks)
7. [Contrato de datos (lo que el front espera del backend)](#7-contrato-de-datos-lo-que-el-front-espera-del-backend)
8. [Rutas, roles y navegación](#8-rutas-roles-y-navegación)
9. [Pantallas: maqueta → vista → endpoints](#9-pantallas-maqueta--vista--endpoints)
10. [Sistema de diseño (tokens y componentes)](#10-sistema-de-diseño-tokens-y-componentes)
11. [Seguridad, accesibilidad y responsive](#11-seguridad-accesibilidad-y-responsive)
12. [Cómo añadir una vista nueva](#12-cómo-añadir-una-vista-nueva)
13. [Checklist de integración con backend](#13-checklist-de-integración-con-backend)
14. [Decisiones tomadas y puntos abiertos](#14-decisiones-tomadas-y-puntos-abiertos)

---

## 1. Arranque rápido

Las vistas usan **módulos ES** (`<script type="module">`), así que hay que servir la carpeta por HTTP (abrir `index.html` con doble clic **no funciona** por CORS de `file://`).

```bash
cd ui/front
python3 dev-server.py          # http://localhost:5173  (sin caché, recomendado)
```

Alternativas: `python3 -m http.server 5173` o `npx serve .` (pueden cachear los `.js`; si no ves cambios, recarga forzada).

| URL | Qué muestra |
|---|---|
| `http://localhost:5173/` | Perfil **consultor** con datos mock |
| `http://localhost:5173/?role=admin` | Perfil **administrador** con datos mock |
| `http://localhost:5173/?mock=0` | Desactiva mocks → llama al backend real (`API_BASE_URL`) |

En modo mock aparece abajo una etiqueta **"MODO MOCK · datos de ejemplo"** y en la sidebar un botón **"Ver como admin / consultor"** para alternar perfil. Ninguno de los dos existe con `USE_MOCKS=false`.

---

## 2. Estructura de carpetas

```
ui/front/
├── index.html                 # Único HTML. Carga CSS y js/main.js
├── dev-server.py              # Servidor estático sin caché para desarrollo
├── assets/brand/favicon.svg   # Favicon por defecto (se sustituye por brand.iconUrl)
├── css/
│   ├── tokens.css             # Variables: BRAND (variables) + neutros/estados/espaciado
│   ├── base.css               # Reset, tipografía, utilidades
│   ├── layout.css             # Sidebar, topbar, contenido, grids, responsive
│   ├── components.css         # Botones, KPI, chips, tags, avatar, toggle, inputs, stepper, player, modal, toast...
│   └── views.css              # Estilos específicos de cada pantalla
└── js/
    ├── config.js              # URLs y flags de entorno (único sitio)
    ├── main.js                # Arranque: marca → sesión → shell → router
    ├── brand.js               # White-label: normaliza y aplica la marca
    ├── routes.js              # Rutas, roles y nav
    ├── router.js              # Router por hash (#/ruta) con guardia de rol
    ├── shell.js               # Sidebar + topbar
    ├── api/
    │   ├── client.js          # fetch wrapper (token, JSON/FormData, errores, timeout, mocks)
    │   ├── endpoints.js       # ← CATÁLOGO DE ENDPOINTS (contrato con backend)
    │   └── mocks/
    │       ├── data.js        # Datos de ejemplo = ejemplo vivo del contrato
    │       └── index.js       # Router de mocks "MÉTODO /ruta/:param"
    ├── ui/
    │   ├── dom.js             # html`` con auto-escape, sanitizeHtml, formatos (Intl), helpers
    │   ├── icons.js           # Iconos SVG inline (currentColor)
    │   └── components.js      # Componentes de presentación + toast/modal/mountAsync
    └── views/
        ├── consultor/         # inicio, familias, alertas, alerta-detalle, historial, plantillas, configuracion
        └── admin/             # resumen, usuarios, marca, gobernanza, integraciones
```

---

## 3. Arquitectura y flujo de arranque

```
index.html
  └─ js/main.js
       1. initBrand()        → aplica marca cacheada (localStorage) y luego GET /brand
       2. sessionApi.me()    → GET /me  → { role: "consultor" | "admin", ... }
       3. renderShell()      → sidebar + topbar según rol y marca
       4. startRouter()      → pinta la vista de la ruta (#/...) dentro de <main id="outlet">
```

- **SPA sin framework**: cada vista es un módulo con `export default { title, render(el, ctx) }`. Se carga con `import()` dinámico (solo se descarga la vista que se visita).
- `ctx = { params, query, session, navigate }`.
- Si `render` devuelve una función, el router la llama al salir de la vista (limpieza de listeners, pausar audio, timers…).
- Cada bloque de datos de una vista se carga con `mountAsync(el, load, render)` que gestiona **skeleton → datos → error con botón "Reintentar"**. Una vista puede tener varios bloques independientes (p.ej. KPIs y lista) que cargan en paralelo.

---

## 4. Configuración de entorno

Archivo: [`js/config.js`](js/config.js)

| Clave | Por defecto | Descripción |
|---|---|---|
| `API_BASE_URL` | `http://localhost:8000/api` | Prefijo de todas las peticiones |
| `USE_MOCKS` | `true` | `true` = no hay red, responde `js/api/mocks`. **Poner a `false` al integrar** |
| `MOCK_LATENCY_MS` | `350` | Latencia simulada para ver los skeletons |
| `REQUEST_TIMEOUT_MS` | `15000` | Timeout de peticiones reales |
| `AUTH_TOKEN_KEY` | `sherpas.token` | Clave en `localStorage` del token Bearer |
| `BRAND_CACHE_KEY` | `sherpas.brand` | Cache de la marca para evitar parpadeo al cargar |
| `MOCK_ROLE` | `consultor` | Rol simulado (o `?role=admin`) |
| `LOCALE` / `CURRENCY` | `es-ES` / `USD` | Formateo de números, fechas y moneda (`Intl`) |

Se pueden sobrescribir **sin tocar código** declarando antes de `main.js` en `index.html`:

```html
<script>
  window.__APP_CONFIG__ = { API_BASE_URL: "https://api.midominio.com/api", USE_MOCKS: false };
</script>
```

Y en desarrollo con query params: `?mock=0|1`, `?role=admin|consultor`.

---

## 5. Imagen de marca variable (white-label)

Todo lo que es marca se resuelve en **runtime**. Archivo: [`js/brand.js`](js/brand.js).

### 5.1 Qué es variable

| Elemento | Campo | Dónde se ve |
|---|---|---|
| Nombre del producto | `appName` | Wordmark de texto (si no hay logo), título de pestaña, píldora "X Admin", migas, textos ("Define qué acciones ejecuta **X**…") |
| Nombre del tenant/empresa | `tenantName` | Topbar ("CDTM Valencia Hacks 2026"), título de pestaña |
| Logo principal | `logoUrl` | Sidebar, cabecera del email de previsualización |
| Isotipo / icono | `iconUrl` | Favicon, icono de la notificación móvil |
| Color primario | `colors.primary` | Nav activo, títulos, botones contorno/primarios, barra del email |
| Color de acento | `colors.accent` | CTAs, toggles, chips activos, KPIs, reproductor de audio |
| Tipografía | `fontFamily` + `fontUrl` | Toda la app (se inyecta `<link>` a la hoja de la fuente) |
| Texto legal | `legalFooter` | Pie de los emails al cliente |
| Perfil de voz IA | `voiceProfileId` | Llamadas automatizadas |

### 5.2 Cómo se aplica

1. Al arrancar se aplica la **marca cacheada** en `localStorage` (sin parpadeo de colores) y después la del backend.
2. `applyBrand(brand)` escribe en `:root` las variables `--brand-primary`, `--brand-accent`, `--brand-font-family`… y calcula automáticamente:
   - `--brand-*-contrast`: blanco o casi-negro según luminancia WCAG del color (el texto sobre botones siempre es legible aunque la marca elija un color claro).
   - Variantes suaves/fuertes con `color-mix()` en [`css/tokens.css`](css/tokens.css): `--brand-accent-soft`, `--brand-accent-strong`, `--brand-primary-soft`, etc.
3. Cambia favicon y `document.title`, carga la fuente y emite `brand:change`; el shell repinta logo y tenant sin recargar.
4. Si `GET /brand` falla, se mantiene la cache o `DEFAULT_BRAND`.

### 5.3 Adaptador de formato

Como aún no sabemos el formato exacto en el que llegará la marca, **toda la app trabaja con un objeto normalizado** y la traducción vive en una sola función: `normalizeBrand()` en `js/brand.js`. Ya acepta `camelCase`, `snake_case` y colores anidados (`colors.primary`) o planos (`primary_color`). Si el backend usa otro formato, solo se toca esa función.

### 5.4 Editor de marca (admin)

`#/admin/marca` trabaja sobre un **borrador local**: los cambios solo afectan a la vista previa (variables `--pv-primary` / `--pv-accent` en el contenedor de previsualización), **no** a la app, hasta pulsar **Publicar**. Logos: PNG/SVG, máx. 2 MB (validado en cliente), arrastrar o seleccionar; se suben al momento (`POST /brand/assets`) y se guarda la URL devuelta.

### 5.5 Lo que NO es variable (sistema)

Neutros (grises, fondos), colores semánticos de estado (éxito/aviso/peligro/info), radios, sombras y espaciados están en `tokens.css` y son comunes a todas las marcas para mantener la legibilidad de estados (p.ej. "Sobrecargado" siempre en rojo).

---

## 6. Capa de datos: cliente, endpoints y mocks

```
Vista  ──►  endpoints.js (consultorApi / adminApi / brandApi / …)  ──►  client.js  ──►  fetch(API_BASE_URL + ruta)
                                                                           └─ si USE_MOCKS ─► mocks/index.js ─► mocks/data.js
```

- **Las vistas nunca llaman a `fetch`**: solo a funciones de `endpoints.js`.
- `client.js`:
  - Añade `Authorization: Bearer <token>` si hay token en `localStorage` (`setToken()` / `getToken()`), y `credentials: "include"` por si el backend usa cookies.
  - Envía JSON o `FormData` (subidas).
  - Lanza `ApiError { status, message, details }`; el mensaje se toma de `message` o `detail` del cuerpo (compatible con FastAPI/DRF/Express).
  - En `401` borra el token y emite `auth:expired`.
  - Soporta `responseType: "blob"` para descargas (informe compliance, facturas).
- **Mocks**: `mocks/index.js` empareja `"MÉTODO /ruta/:param"`; si una ruta no está mockeada lanza 404 para detectarlo. Los mocks se importan dinámicamente: con `USE_MOCKS=false` **ni se descargan**. Se pueden borrar cuando el backend esté completo.

---

## 7. Contrato de datos (lo que el front espera del backend)

> Propuesta de contrato. Rutas relativas a `API_BASE_URL`. Ejemplos completos en [`js/api/mocks/data.js`](js/api/mocks/data.js). Los nombres de campo son `camelCase`; si backend prefiere `snake_case`, se adapta en `endpoints.js` o se acuerda.

### 7.1 Sesión, marca y notificaciones

| Método | Ruta | Respuesta / cuerpo |
|---|---|---|
| GET | `/me` | `{ id, name, avatarUrl, role: "consultor"\|"admin", tenant: { id, name } }` |
| POST | `/auth/logout` | — |
| GET | `/brand` | `Brand` (abajo) |
| PUT | `/brand/draft` | body `Brand` |
| POST | `/brand/publish` | body `Brand` → `Brand` publicado |
| POST | `/brand/reset` | → `Brand` por defecto |
| POST | `/brand/assets` | `multipart/form-data` `{ kind: "logo"\|"icon", file }` → `{ url }` |
| GET | `/brand/voices` | `[{ id, label, status }]` |
| GET | `/notifications/count` | `{ unread: number }` |

```ts
Brand = {
  appName: string; tenantName: string;
  logoUrl: string|null; iconUrl: string|null;
  colors: { primary: "#RRGGBB"; accent: "#RRGGBB" };
  fontFamily: string|null; fontUrl: string|null;
  legalFooter: string; voiceProfileId: string|null; integrationActive: boolean;
}
```

### 7.2 Consultor

| Método | Ruta | Respuesta / cuerpo |
|---|---|---|
| GET | `/consultant/dashboard` | `{ familiesMonitored, activeAlerts, avgReviewMinutes, silentActions }` |
| GET | `/alerts/categories` | `[{ id, label }]` (chips de filtro de Inicio) |
| GET | `/alerts?category=a&category=b&status=pending&consultant=` | `AlertSummary[]` |
| GET | `/alerts/:id` | `AlertDetail` |
| POST | `/alerts/batch-approve` | `{ ids: string[] }` → `{ approved }` |
| PUT | `/alerts/:id/draft` | `{ email: { subject, bodyHtml }, call: { script } }` |
| POST | `/alerts/:id/email/approve` | — |
| POST | `/alerts/:id/call/launch` | — |
| POST | `/alerts/:id/snooze` | `{ until: ISODate }` |
| GET | `/families/summary` | `{ total, needsApproval, autopilot }` |
| GET | `/families?q=&status=all\|needs_approval\|autopilot` | `FamilySummary[]` |
| GET | `/history/summary` | `{ total, silent, approved }` |
| GET | `/history?type=all\|silent\|approved` | `HistoryItem[]` |
| POST | `/history/:id/revert` | — |
| GET | `/templates` | `[{ id, name, channel: "email"\|"call", updatedAt, usage }]` |
| GET / PUT | `/consultant/settings/autonomy` | `AutonomySettings` |

```ts
AlertSummary = { id; family: { id, name, avatarUrls: string[] }; title; categories: string[];
                 tags: string[]; impact: "high"|"medium"|"low"; channels: { email: boolean; call: boolean } }

AlertDetail = { id; family: { id, name };
  facts: string[];                                      // "Hipoteca: $560,000", ...
  touchpoints: { step: number; label: string; status: "sent"|"current"|"pending" }[];
  email: { to; subject; tone; dataVerified: boolean; bodyHtml: string };   // HTML: se sanitiza en el front
  call:  { enabled: boolean; audioUrl: string|null; durationSec: number; voiceLabel: string; script: string } }

FamilySummary = { id; name; avatarUrls: string[]; risk: string; riskProfile?: string;
  status: "needs_approval"|"autopilot"; facts: string[]; goal: string; planUrl: string; psychProfileUrl: string }

HistoryItem = { id; kind: "silent"|"approved"; title; subtitle; tags: string[];
  family: { id, name, avatarUrls }|null; createdAt: ISODate }

AutonomySettings = {
  sections: { id; title; rules: { id; label; example?; hint?; enabled: boolean }[] }[];
  integration: { name; status: "connected"|"error"|"pending"; description } | null }
```

> Las reglas de autonomía y los guardrails **vienen del backend como lista**: añadir una regla nueva no requiere tocar el front.

### 7.3 Administrador

| Método | Ruta | Respuesta / cuerpo |
|---|---|---|
| GET | `/admin/summary` | `{ activeFamilies, activeConsultants, slaMinutes, silenceRate (0-1), unreadNotifications }` |
| GET | `/admin/consultants/workload?filter=all\|overloaded\|low_sla\|inactive` | `ConsultantWorkload[]` |
| POST | `/admin/portfolios/reassign` | `{ fromConsultantId, toConsultantId, count \| familyIds[] }` |
| GET | `/admin/compliance/report` | Blob (PDF/CSV) |
| GET / PUT | `/admin/onboarding/settings` | `{ autoAccept: boolean }` |
| GET | `/admin/onboarding/queue` | `[{ id, familyName, avatarUrls, registeredAt, members }]` |
| POST | `/admin/onboarding/:id/accept` | `{ consultantId }` |
| POST | `/admin/onboarding/:id/reject` | — |
| GET | `/admin/users` | `TeamMember[]` |
| POST | `/admin/users` | `{ name, email, role }` |
| PATCH | `/admin/users/:id` | `{ role, permissions? }` |
| GET | `/admin/governance/guardrails` | `[{ id, label, hint, enabled }]` |
| PATCH | `/admin/governance/guardrails/:id` | `{ enabled }` |
| GET | `/admin/integrations` | `[{ id, name, status, statusLabel, canVerify, canConfigure }]` |
| POST | `/admin/integrations/:id/verify` | → `Integration` |
| GET | `/admin/billing` | `{ planName, seatsUsed, seatsTotal, renewalDate }` |
| POST | `/admin/billing/seats` | → `Billing` |
| GET | `/admin/billing/invoices` | Blob (PDF/ZIP) |

```ts
ConsultantWorkload = { id; name; title; avatarUrl; familiesAssigned; capacity; slaMinutes; slaTarget;
  silenceRate (0-1); active: boolean;
  status?: "overloaded_urgent"|"overloaded"|"near_limit"|"optimal" }   // si no viene, el front lo deriva de assigned/capacity

TeamMember = { id; name; avatarUrl; role: "consultor"|"admin"; roleLabel; scopeLabel|null; familiesAssigned|null }
```

### 7.4 Convenciones

- Fechas en **ISO 8601 UTC**; el front las formatea con `Intl` (`fmt.date`, `fmt.relative`).
- Porcentajes como **ratio 0–1** (`silenceRate: 0.88` → "88%").
- Minutos como número (`3.2` → "3,2 min").
- Imágenes (avatares, logos) como **URL absoluta**; si falta, se muestran iniciales.
- Errores: código HTTP + cuerpo `{ message }` o `{ detail }`.

---

## 8. Rutas, roles y navegación

Archivo: [`js/routes.js`](js/routes.js). Router por hash (`#/ruta`) — funciona en cualquier hosting estático sin reescrituras de URL.

| Ruta | Vista | Consultor | Admin | En sidebar |
|---|---|:-:|:-:|---|
| `#/inicio` | Inicio + Feed de Alertas | ✔ | | Inicio |
| `#/familias` | Familias | ✔ | ✔ | Familias |
| `#/alertas` | Listado de alertas (acepta `?consultant=<id>`) | ✔ | ✔ | Alertas |
| `#/alertas/:id` | Detalle (doble canal) | ✔ | ✔ | (marca "Alertas") |
| `#/historial` | Historial y registro silencioso | ✔ | ✔ | Historial |
| `#/plantillas` | Plantillas | ✔ | ✔ | Plantillas |
| `#/configuracion` | Reglas de autonomía | ✔ | | Configuración (pie) |
| `#/admin/resumen` | Resumen ejecutivo | | ✔ | Resumen Ejecutivo |
| `#/admin/usuarios` | Usuarios y roles | | ✔ | Usuarios y Roles |
| `#/admin/marca` | Imagen de marca | | ✔ | Imagen de Marca |
| `#/admin/gobernanza` | Guardrails IA | | ✔ | Gobernanza y Compliance |
| `#/admin/integraciones` | Integraciones + plan | | ✔ | Integraciones y Facturación |

- **Guardia de rol**: una ruta no permitida (o inexistente) redirige a la home del rol (`/inicio` o `/admin/resumen`).
- El admin ve también las vistas operativas (Familias, Alertas, Historial, Plantillas) en modo supervisión, como aparece en la maqueta de *Usuarios y Roles*.
- ⚠ La guardia del front es **solo UX**: el backend debe validar permisos en cada endpoint.

---

## 9. Pantallas: maqueta → vista → endpoints

### Consultor

| Maqueta | Vista | Qué hace |
|---|---|---|
| `profile_consultor/inicio.jpeg` | `views/consultor/inicio.js` + `_alert-feed.js` | 4 KPIs; chips de categoría **multi-selección** que filtran el feed; filas con *Correo 1-Clic* (envía y retira la fila), *Llamada Automatizada*, *Revisar* (→ detalle); *Aprobar Lote* (aprueba las alertas visibles tras confirmación) |
| `profile_consultor/familias.jpeg` | `views/consultor/familias.js` | 3 KPIs con punto de estado; buscador con debounce 300 ms; filtros *Todas / Requiere Aprobación / En Piloto Automático* con contadores; tarjetas con riesgo, datos, objetivo y enlaces *Abrir Plan Vivo* / *Ver Perfil Psicológico* (URLs del backend) |
| `profile_consultor/alertas.jpeg` | `views/consultor/alerta-detalle.js` | Cabecera con datos clave; **stepper de toques** (enviado / actual / pendiente); canal 1 email (Para, Asunto, cuerpo HTML **sanitizado**, tono, "Datos verificados"); canal 2 llamada (reproductor con onda, progreso, guion); *Editar Guion/Texto* hace editables asunto, cuerpo y guion y guarda con `PUT /draft`; *Posponer* con selector de fecha |
| `profile_consultor/historial.jpeg` | `views/consultor/historial.js` | 3 KPIs; filtros; acciones automáticas con avatar "Auto" y etiqueta *Silencioso*; aprobadas con avatar de familia y etiqueta *Aprobado*; *Ver Detalle*, *Revertir / Ajustar Regla* |
| `profile_consultor/configuracion.jpeg` | `views/consultor/configuracion.js` | Migas; secciones y reglas **dinámicas** con toggle y estado ON/OFF; estado de la integración MCP; *Guardar Reglas* |
| — (sin maqueta) | `views/consultor/plantillas.js` | Listado provisional de plantillas |

### Administrador

| Maqueta | Vista | Qué hace |
|---|---|---|
| `profile_admin/resumen_ejecutivo.jpeg` | `views/admin/resumen.js` | 4 KPIs; filtros de consultores; filas de carga con *Familias asignadas X / capacidad* (verde/rojo + icono de alerta), estado (*Sobrecargado – Reasignar urgente*, *Capacidad óptima*, *Cerca del límite*), SLA (resaltado en ámbar si supera el objetivo), tasa de silencio; *Gestionar Carga* / *Reasignar Carteras* (modal origen → destino → nº familias); *Revisar Alertas* (→ `#/alertas?consultant=id`); *Exportar Informe Compliance* (descarga) |
| `profile_admin/users_roles.jpeg` | `views/admin/usuarios.js` | Toggle *Auto-aceptar registros* con etiqueta `[OFF - Revisión Manual]`; cola de onboarding con selector de consultor, *Aceptar y Activar Plan* / *Rechazar*; equipo interno con *Editar Permisos*, *Reasignar Familias*, *Crear Usuario* (modal) |
| `profile_admin/imagen_marca.jpeg` | `views/admin/marca.js` | Ver §5.4. Subida de logo e isotipo, nombre, tenant, colores (texto hex + selector nativo), texto legal, perfil de voz; vista previa **Email** / **Notificación Móvil**; *Restaurar por Defectos*, *Guardar Borrador* (se activa al haber cambios), *Publicar Cambios de Marca* |
| `profile_admin/compliance.jpeg` (bloque superior) | `views/admin/gobernanza.js` | Guardrails de IA con toggle que se guarda al momento (revierte si falla) |
| `profile_admin/compliance.jpeg` (bloques inferiores) | `views/admin/integraciones.js` | Integraciones (estado, *Verificar conexión*, *Configurar API*); plan corporativo con barra de asientos usados, renovación, *Añadir Asiento*, *Descargar Facturas* |

---

## 10. Sistema de diseño (tokens y componentes)

**Tokens** ([`css/tokens.css`](css/tokens.css)): bloque BRAND (variable) + neutros, estados, tipografía (escala `--fs-*`), espaciado (`--sp-*`), radios, sombras y medidas de layout. Fuente por defecto: Inter (Google Fonts), sustituible por la de marca.

**Componentes** ([`js/ui/components.js`](js/ui/components.js) + [`css/components.css`](css/components.css)):

| Helper JS | Clase CSS | Uso en maquetas |
|---|---|---|
| — | `.btn--accent` / `--primary` / `--outline` / `--outline-accent` / `--ghost` / `--link` / `--block` | Todos los botones de las maquetas |
| `kpiCard()` | `.kpi` (+ `__icon--accent/warning/info/neutral`, `.kpi__dot`) | Tarjetas superiores de cada pantalla |
| `chipGroup()` + `bindChips()` | `.chip`, `.chips--solid` | Filtros (simple o multi) |
| `tag()` / `tags()` | `.tag--success/accent/info/warning/danger/outline/solid-accent` | Etiquetas y estados |
| `avatar()` / `familyAvatar()` / `autoAvatar()` | `.avatar` | Foto o iniciales; "Auto" del historial |
| `toggle()` | `.toggle` | Interruptores (`role="switch"`) |
| `breadcrumb()` | `.breadcrumb` | Migas |
| `mountAsync()` / `skeleton()` / `emptyState()` / `errorState()` | `.skeleton`, `.state` | Carga, vacío y error |
| `toast()` | `.toast` | Confirmaciones y errores de acciones |
| `openModal()` | `.modal` | Confirmaciones y formularios cortos (devuelve `FormData`) |
| `withLoading(btn, fn)` | `.is-loading` | Estado de carga en botones + toast de error |

Iconos: [`js/ui/icons.js`](js/ui/icons.js), SVG inline de trazo que heredan `currentColor` (se recolorean con la marca).

---

## 11. Seguridad, accesibilidad y responsive

**Seguridad**
- Todas las interpolaciones en plantillas pasan por `html\`\`` que **escapa automáticamente** (evita XSS con datos del backend). Para insertar HTML ya construido se usa `raw()` de forma explícita.
- El cuerpo del email generado por IA (`bodyHtml`) se filtra con `sanitizeHtml()` (lista blanca: `p, br, strong, b, em, i, u, ul, ol, li, a[href http/mailto], span`).
- Subidas: tipo (PNG/SVG) y tamaño (≤ 2 MB) validados en cliente; **el backend debe revalidar y sanear los SVG** (pueden contener scripts).
- Token en `localStorage` como solución provisional; si backend usa cookies `HttpOnly`, el cliente ya envía `credentials: "include"` y basta con no llamar a `setToken`.

**Accesibilidad**
- HTML semántico (`nav`, `main`, `header`, `section`, `article`), `aria-current` en nav, `aria-pressed` en chips, `role="switch"` en toggles, `role="progressbar"`, `aria-busy` durante cargas, `role="alert"` en errores, toasts con `aria-live`.
- Foco visible con el color de acento de la marca; modales cierran con `Esc`.
- Contraste de texto sobre colores de marca calculado automáticamente.
- `prefers-reduced-motion` desactiva animaciones.

**Responsive**
- ≥ 1280 px: layout de las maquetas.
- ≤ 1100 px: grids a una columna, editor de marca apilado, acciones de fila debajo.
- ≤ 900 px: sidebar como cajón (botón ☰ en la topbar).
- ≤ 640 px: stepper vertical, filas de carga/equipo en una columna. Sin scroll horizontal a 375 px.

---

## 12. Cómo añadir una vista nueva

1. Crear `js/views/<perfil>/mi-vista.js`:
   ```js
   import { miApi } from "../../api/endpoints.js";
   import { html } from "../../ui/dom.js";
   import { mountAsync, skeleton } from "../../ui/components.js";

   export default {
     title: "Mi vista",
     render(el, { params, query, navigate }) {
       el.innerHTML = html`<h1>Mi vista</h1><section data-slot="list"></section>`;
       mountAsync(el.querySelector('[data-slot="list"]'), miApi.list, (items) => items.map((i) => html`<p>${i.name}</p>`).join(""));
       return () => { /* limpieza opcional */ };
     },
   };
   ```
2. Añadir el endpoint en `js/api/endpoints.js` (y su mock en `mocks/index.js` + `mocks/data.js`).
3. Registrar la ruta en `js/routes.js` con `roles` y, si procede, `nav: { label, icon }`.

---

## 13. Checklist de integración con backend

- [ ] Acordar rutas y nombres de campo con la tabla de la §7 (ajustar `endpoints.js` si difieren).
- [ ] Definir formato real de la marca y adaptar `normalizeBrand()` si hace falta.
- [ ] Configurar `API_BASE_URL` y `USE_MOCKS: false` (en `config.js` o `window.__APP_CONFIG__`).
- [ ] CORS en backend para el origen del front (y `Access-Control-Allow-Credentials` si se usan cookies).
- [ ] Autenticación: pantalla de login / SSO (pendiente, ver `TODO(auth)` en `main.js`), y llamar a `setToken()` tras login.
- [ ] Servir audios de llamada (`call.audioUrl`) con CORS y `Content-Type` correcto.
- [ ] Descargas (`/admin/compliance/report`, `/admin/billing/invoices`) con `Content-Type` real (PDF/CSV/ZIP) para que el nombre de archivo tenga la extensión correcta.
- [ ] Revalidar en backend permisos por rol, subida de assets y saneado de SVG.
- [ ] Borrar `js/api/mocks/` cuando ya no se necesite.

---

## 14. Decisiones tomadas y puntos abiertos

**Decisiones**
- **Vanilla JS sin build**: cero dependencias, se despliega copiando la carpeta a cualquier hosting estático. Si más adelante se migra a un framework, `api/`, `brand.js`, `tokens.css` y `components.css` se reutilizan tal cual.
- **Router por hash** para no depender de reescrituras en el servidor.
- **"Gobernanza, Compliance y Facturación"** (una sola maqueta) se ha separado en dos entradas de menú, *Gobernanza y Compliance* e *Integraciones y Facturación*, porque así aparecen en la sidebar de la maqueta de Resumen Ejecutivo.
- El pie de la sidebar muestra **Configuración** (consultor), **Cerrar sesión** y, solo en mock, el conmutador de rol. En las maquetas "Configuración" aparecía duplicado arriba y abajo; se ha dejado una sola vez.
- Avatares: si el backend no da foto se muestran **iniciales** (las fotos de las maquetas son de ejemplo).
- La campana muestra el número de no leídas (en la maqueta del consultor es solo un punto).
- Textos de las maquetas con errores tipográficos ("Felechas/Acceso total", "Familias Assigned") se han normalizado ("Acceso total", "Familias asignadas").

**Pendiente de definir**
- Vista de **Plantillas** (no hay maqueta) y edición de plantillas.
- Qué aprueba exactamente **"Aprobar Lote"** en el Historial (hoy muestra un aviso).
- Destino de *Ver Detalle* del historial (hoy, modal simple), *Configurar API* de integraciones y permisos granulares en *Editar Permisos*.
- Fuente del texto de ejemplo de la **vista previa de marca** (hoy es estático; podría venir del backend como "borradores generados automáticamente").
- Login / gestión de sesión y pantalla de notificaciones.
- Internacionalización: textos en español dentro de las vistas; si se necesita multi-idioma, extraerlos a un diccionario.
