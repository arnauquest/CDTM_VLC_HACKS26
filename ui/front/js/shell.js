/**
 * SHELL: estructura fija alrededor de las vistas. El contenido de cada vista
 * va dentro de #outlet. Hay dos layouts:
 *   - "panel"  (consultor y admin): sidebar + topbar.
 *   - "client" (cliente/familia):   cabecera superior oscura, sin sidebar.
 * Se repinta solo cuando cambia la marca o la sesión.
 */
import { config } from "./config.js";
import { getBrand, renderLogo } from "./brand.js";
import { navFor, ROLES, LAYOUT_BY_ROLE } from "./routes.js";
import { notificationsApi, sessionApi } from "./api/endpoints.js";
import { html, raw, $, $$ } from "./ui/dom.js";
import { icon } from "./ui/icons.js";
import { avatar } from "./ui/components.js";
import { setToken } from "./api/client.js";

const capitalize = (s = "") => s.charAt(0).toUpperCase() + s.slice(1);

/* ======================== LAYOUT PANEL (consultor / admin) ======================== */

function navLink(r) {
  return html`
    <a class="nav-item" href="#${r.path}" data-nav="${r.path}">
      ${raw(icon(r.nav.icon))}<span>${r.nav.label}</span>
    </a>`;
}

function sidebarHtml(session) {
  const brand = getBrand();
  const isAdmin = session.role === ROLES.ADMIN;
  const items = navFor(session.role);
  const main = items.filter((r) => r.nav.group !== "footer");
  const footer = items.filter((r) => r.nav.group === "footer");

  return html`
    <aside class="sidebar" id="sidebar" aria-label="Navegación principal">
      <a class="sidebar__brand" href="#/" aria-label="${brand.appName} - inicio">
        ${raw(renderLogo(brand))}
        ${isAdmin ? raw(`<span class="brand-suffix">admin</span>`) : ""}
      </a>
      ${isAdmin ? raw(html`<span class="role-pill">${capitalize(brand.appName)} Admin</span>`) : ""}
      <nav class="sidebar__nav">${main.map(navLink)}</nav>
      <div class="sidebar__footer">
        ${footer.map(navLink)}
        <button class="nav-item" type="button" data-action="logout">${raw(icon("logout"))}<span>Cerrar sesión</span></button>
      </div>
    </aside>`;
}

function topbarHtml(session) {
  const brand = getBrand();
  return html`
    <header class="topbar">
      <button class="bell topbar__menu" type="button" data-action="toggle-nav" aria-label="Abrir menú" aria-controls="sidebar">${raw(icon("menu"))}</button>
      <span class="topbar__title">${brand.tenantName || session.tenant?.name || ""}</span>
      <div class="topbar__actions">
        ${raw(bellHtml())}
        ${raw(avatar(session.name, session.avatarUrl, "sm"))}
      </div>
    </header>`;
}

function panelLayout(session) {
  return html`
    <div class="app" id="app">
      ${raw(sidebarHtml(session))}
      <div class="scrim" data-action="toggle-nav"></div>
      <div class="main">
        ${raw(topbarHtml(session))}
        <main class="content" id="outlet" tabindex="-1"></main>
      </div>
    </div>`;
}

/* ======================== LAYOUT CLIENTE (familia) ======================== */

function clientHeaderInner(session) {
  const brand = getBrand();
  const firstName = (session.name || "").split(" ")[0];
  return html`
    <a class="client-header__brand" href="#/" aria-label="${brand.appName} - inicio">
      ${raw(renderLogo(brand, { variant: "inverse" }))}
    </a>
    <span class="client-header__area">Área de Cliente: Familia</span>
    <div class="client-header__actions">
      <span class="client-header__hello">Hola ${firstName}</span>
      <div class="client-header__user">
        ${raw(avatar(session.name, session.avatarUrl, "sm"))}
        <div class="client-header__who">
          <span class="client-header__name">${session.name}</span>
          ${session.family?.name ? raw(html`<span class="client-header__family">${session.family.name}</span>`) : ""}
        </div>
      </div>
      ${raw(bellHtml())}
      <button class="bell" type="button" data-action="logout" aria-label="Cerrar sesión" title="Cerrar sesión">${raw(icon("logout"))}</button>
    </div>`;
}

function clientLayout(session) {
  return html`
    <div class="client-app" id="app">
      <header class="client-header">${raw(clientHeaderInner(session))}</header>
      <main class="client-content" id="outlet" tabindex="-1"></main>
    </div>`;
}

/* ======================== COMÚN ======================== */

function bellHtml() {
  return html`
    <button class="bell" type="button" aria-label="Notificaciones" data-action="notifications">
      ${raw(icon("bell"))}<span class="bell__badge" hidden></span>
    </button>`;
}

/** Solo en modo mock: banner con conmutador de rol para revisar los 3 perfiles. */
function mockBanner(session) {
  const roles = [ROLES.CONSULTOR, ROLES.ADMIN, ROLES.CLIENTE];
  return html`
    <div class="mock-banner">MODO MOCK · ver como:
      ${roles.map((r) => (r === session.role
        ? raw(html`<b>${r}</b>`)
        : raw(html`<button type="button" data-switch-role="${r}">${r}</button>`)))}
    </div>`;
}

export function renderShell(root, session) {
  const layout = LAYOUT_BY_ROLE[session.role] || "panel";
  root.innerHTML = (layout === "client" ? clientLayout(session) : panelLayout(session))
    + (config.USE_MOCKS ? mockBanner(session) : "");

  root.addEventListener("click", async (e) => {
    const switchTo = e.target.closest("[data-switch-role]")?.dataset.switchRole;
    if (switchTo) {
      const url = new URL(window.location.href);
      url.searchParams.set("role", switchTo);
      url.hash = "";
      window.location.href = url.toString();
      return;
    }
    const app = $("#app", root);
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "toggle-nav") app.classList.toggle("is-nav-open");
    if (action === "logout") {
      try { await sessionApi.logout(); } catch { /* ignore */ }
      setToken(null);
      window.dispatchEvent(new CustomEvent("auth:expired"));
    }
    if (e.target.closest(".nav-item[href]")) app.classList.remove("is-nav-open");
  });

  refreshNotifications();
  return $("#outlet", root);
}

/** Repinta solo las partes del shell que dependen de la marca. */
export function updateShellBrand(session) {
  const brand = getBrand();
  const brandEl = $(".sidebar__brand");
  if (brandEl) {
    brandEl.innerHTML = renderLogo(brand) + (session.role === ROLES.ADMIN ? `<span class="brand-suffix">admin</span>` : "");
  }
  const pill = $(".role-pill");
  if (pill) pill.textContent = `${capitalize(brand.appName)} Admin`;
  const title = $(".topbar__title");
  if (title) title.textContent = brand.tenantName || session.tenant?.name || "";
  const clientBrand = $(".client-header__brand");
  if (clientBrand) clientBrand.innerHTML = renderLogo(brand, { variant: "inverse" });
}

/** Marca como activo el item de nav correspondiente a la ruta. */
export function setActiveNav(route) {
  const key = route.navKey || route.path;
  $$(".nav-item[data-nav]").forEach((a) => {
    const active = a.dataset.nav === key;
    a.classList.toggle("is-active", active);
    if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}

export async function refreshNotifications() {
  const badge = $(".bell__badge");
  if (!badge) return;
  try {
    const { unread } = await notificationsApi.count();
    badge.hidden = !unread;
    if (unread) { badge.dataset.count = unread; badge.textContent = unread > 9 ? "9+" : unread; }
  } catch { badge.hidden = true; }
}
