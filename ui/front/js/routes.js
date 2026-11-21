/**
 * MAPA DE RUTAS Y NAVEGACIÓN POR ROL
 * ---------------------------------------------------------------------------
 * Cada ruta:
 *   path   : patrón hash (#/ruta/:param)
 *   view   : import dinámico del módulo de vista (code-splitting nativo)
 *   roles  : roles que pueden acceder
 *   nav    : si existe, aparece en la sidebar { label, icon, group }
 *   navKey : ruta que se marca como activa en la sidebar (para sub-rutas)
 *
 * Grupos de nav: "main" (arriba) y "footer" (abajo, pegado al pie).
 *
 * Roles:
 *   consultor -> layout "panel"  (sidebar + topbar)
 *   admin     -> layout "panel"
 *   cliente   -> layout "client" (cabecera superior, sin sidebar). Es el
 *                usuario final: un miembro de una familia asesorada.
 */
export const ROLES = { CONSULTOR: "consultor", ADMIN: "admin", CLIENTE: "cliente" };
const C = ROLES.CONSULTOR;
const A = ROLES.ADMIN;
const F = ROLES.CLIENTE;

/** Layout de shell por rol (ver js/shell.js). */
export const LAYOUT_BY_ROLE = { [C]: "panel", [A]: "panel", [F]: "client" };

export const routes = [
  /* ----- ADMIN ----- */
  { path: "/admin/resumen", view: () => import("./views/admin/resumen.js"), roles: [A], nav: { label: "Resumen Ejecutivo", icon: "home" } },
  { path: "/admin/usuarios", view: () => import("./views/admin/usuarios.js"), roles: [A], nav: { label: "Usuarios y Roles", icon: "users" } },
  { path: "/admin/marca", view: () => import("./views/admin/marca.js"), roles: [A], nav: { label: "Imagen de Marca", icon: "image" } },
  { path: "/admin/gobernanza", view: () => import("./views/admin/gobernanza.js"), roles: [A], nav: { label: "Gobernanza y Compliance", icon: "shield" } },
  { path: "/admin/integraciones", view: () => import("./views/admin/integraciones.js"), roles: [A], nav: { label: "Integraciones y Facturación", icon: "plug" } },

  /* ----- CLIENTE / FAMILIA ----- */
  { path: "/mi-plan", view: () => import("./views/cliente/mi-plan.js"), roles: [F] },

  /* ----- CONSULTOR (el admin también puede verlas: supervisión) ----- */
  { path: "/inicio", view: () => import("./views/consultor/inicio.js"), roles: [C], nav: { label: "Inicio", icon: "home" } },
  { path: "/familias", view: () => import("./views/consultor/familias.js"), roles: [C, A], nav: { label: "Familias", icon: "users" } },
  { path: "/alertas", view: () => import("./views/consultor/alertas.js"), roles: [C, A], nav: { label: "Alertas", icon: "bell" } },
  { path: "/alertas/:id", view: () => import("./views/consultor/alerta-detalle.js"), roles: [C, A], navKey: "/alertas" },
  { path: "/historial", view: () => import("./views/consultor/historial.js"), roles: [C, A], nav: { label: "Historial", icon: "history" } },
  { path: "/plantillas", view: () => import("./views/consultor/plantillas.js"), roles: [C, A], nav: { label: "Plantillas", icon: "file" } },
  { path: "/configuracion", view: () => import("./views/consultor/configuracion.js"), roles: [C], nav: { label: "Configuración", icon: "settings", group: "footer" } },
];

/** Ruta de aterrizaje por rol. */
export const HOME_BY_ROLE = { [C]: "/inicio", [A]: "/admin/resumen", [F]: "/mi-plan" };

/** Orden de items de nav para cada rol (los admin primero en el perfil admin). */
export function navFor(role) {
  return routes.filter((r) => r.nav && r.roles.includes(role));
}
