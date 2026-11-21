/**
 * ROUTER HASH MINIMALISTA
 * ---------------------------------------------------------------------------
 * - Rutas tipo #/familias, #/alertas/123?foo=bar
 * - Guardia por rol: si la ruta no es del rol, redirige a su home.
 * - Contrato de una vista (js/views/**):
 *
 *     export default {
 *       title: "Familias",                       // opcional (no se usa en topbar)
 *       async render(el, ctx) { ...; return cleanup? }
 *     }
 *
 *   ctx = { params, query, session, navigate }
 *   Si render devuelve una función, se llama al salir de la vista.
 */
import { routes, HOME_BY_ROLE } from "./routes.js";
import { errorState } from "./ui/components.js";

let cleanup = null;
let renderToken = 0;

function compile(path) {
  const names = [];
  const regex = new RegExp("^" + path.replace(/:(\w+)/g, (_, n) => (names.push(n), "([^/]+)")) + "/?$");
  return { regex, names };
}
const compiled = routes.map((r) => ({ ...r, ...compile(r.path) }));

export function parseHash() {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [path, qs = ""] = raw.split("?");
  return { path, query: Object.fromEntries(new URLSearchParams(qs)) };
}

export function match(path) {
  for (const r of compiled) {
    const m = path.match(r.regex);
    if (m) return { route: r, params: Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

export function navigate(path) {
  if (window.location.hash === `#${path}`) handle();
  else window.location.hash = path;
}

let state = { outlet: null, session: null, onRoute: null };

async function handle() {
  const { outlet, session, onRoute } = state;
  const { path, query } = parseHash();
  const home = HOME_BY_ROLE[session.role] || "/inicio";
  const found = match(path);

  if (!found || !found.route.roles.includes(session.role)) {
    window.location.replace(`#${home}`);
    return;
  }

  const token = ++renderToken;
  try { cleanup?.(); } catch (e) { console.error(e); }
  cleanup = null;

  onRoute?.(found.route);
  outlet.innerHTML = "";
  outlet.scrollTo?.(0, 0);
  window.scrollTo(0, 0);

  try {
    const mod = await found.route.view();
    if (token !== renderToken) return; // el usuario navegó a otra parte mientras cargaba
    const view = mod.default;
    const result = await view.render(outlet, { params: found.params, query, session, navigate });
    if (token !== renderToken) { if (typeof result === "function") result(); return; }
    if (typeof result === "function") cleanup = result;
  } catch (err) {
    console.error(err);
    outlet.innerHTML = errorState(err);
  }
}

export function startRouter({ outlet, session, onRoute }) {
  state = { outlet, session, onRoute };
  window.addEventListener("hashchange", handle);
  handle();
}
