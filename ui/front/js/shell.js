/**
 * SHELL: sidebar + topbar. Se repinta solo cuando cambia la marca o la sesión;
 * el contenido de cada vista va dentro de #outlet.
 */
import { config } from "./config.js";
import { getBrand, renderLogo } from "./brand.js";
import { navFor, ROLES } from "./routes.js";
import { notificationsApi, sessionApi } from "./api/endpoints.js";
import { html, raw, $, $$ } from "./ui/dom.js";
import { icon } from "./ui/icons.js";
import { avatar } from "./ui/components.js";
import { setToken } from "./api/client.js";

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
      ${isAdmin ? raw(`<span class="role-pill">${brand.appName ? brand.appName.charAt(0).toUpperCase() + brand.appName.slice(1) : ""} Admin</span>`) : ""}
      <nav class="sidebar__nav">${main.map(navLink)}</nav>
      <div class="sidebar__footer">
        ${footer.map(navLink)}
        ${config.USE_MOCKS ? raw(html`
          <button class="nav-item" type="button" data-action="switch-role" title="Solo en modo mock">
            ${raw(icon("swap"))}<span>Ver como ${isAdmin ? "consultor" : "admin"}</span>
          </button>`) : ""}
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
        <button class="bell" type="button" aria-label="Notificaciones" data-action="notifications">
          ${raw(icon("bell"))}<span class="bell__badge" hidden></span>
        </button>
        ${raw(avatar(session.name, session.avatarUrl, "sm"))}
      </div>
    </header>`;
}

export function renderShell(root, session) {
  root.innerHTML = html`
    <div class="app" id="app">
      ${raw(sidebarHtml(session))}
      <div class="scrim" data-action="toggle-nav"></div>
      <div class="main">
        ${raw(topbarHtml(session))}
        <main class="content" id="outlet" tabindex="-1"></main>
      </div>
    </div>
    ${config.USE_MOCKS ? raw('<div class="mock-banner">MODO MOCK · datos de ejemplo</div>') : ""}`;

  const app = $("#app", root);
  app.addEventListener("click", async (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "toggle-nav") app.classList.toggle("is-nav-open");
    if (action === "switch-role") {
      const url = new URL(window.location.href);
      url.searchParams.set("role", session.role === ROLES.ADMIN ? ROLES.CONSULTOR : ROLES.ADMIN);
      url.hash = "";
      window.location.href = url.toString();
    }
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

/** Repinta solo las partes del shell que dependen de la marca (logo, tenant, pill admin). */
export function updateShellBrand(session) {
  const brand = getBrand();
  const brandEl = $(".sidebar__brand");
  if (brandEl) {
    brandEl.innerHTML = renderLogo(brand) + (session.role === ROLES.ADMIN ? `<span class="brand-suffix">admin</span>` : "");
  }
  const pill = $(".role-pill");
  if (pill) pill.textContent = `${brand.appName.charAt(0).toUpperCase()}${brand.appName.slice(1)} Admin`;
  const title = $(".topbar__title");
  if (title) title.textContent = brand.tenantName || session.tenant?.name || "";
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
    // En la maqueta de consultor es solo un punto; en admin muestra el número.
    if (unread) { badge.dataset.count = unread; badge.textContent = unread > 9 ? "9+" : unread; }
  } catch { badge.hidden = true; }
}
