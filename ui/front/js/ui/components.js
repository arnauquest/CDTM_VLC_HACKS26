/**
 * COMPONENTES DE PRESENTACIÓN
 * Funciones puras que reciben datos y devuelven strings HTML (con escape).
 * Más helpers imperativos: toast(), confirmDialog(), withLoading(), mountAsync().
 */
import { html, raw, escapeHtml, initials } from "./dom.js";
import { icon } from "./icons.js";

/* ---------------- KPI ---------------- */
/**
 * @param {{ icon:string, tone?:"accent"|"warning"|"info"|"neutral", value?:any, label:string, labelHtml?:string, dot?:"success"|"warning"|"info"|"danger" }} p
 */
export function kpiCard(p) {
  return html`
    <article class="kpi ${p.value == null ? "kpi--inline" : ""}">
      <div class="kpi__icon kpi__icon--${p.tone || "neutral"}">${raw(icon(p.icon))}</div>
      <div class="kpi__body">
        ${p.value != null ? raw(`<span class="kpi__value tabular">${escapeHtml(p.value)}</span>`) : ""}
        <span class="kpi__label">${p.labelHtml ? raw(p.labelHtml) : p.label}</span>
      </div>
      ${p.dot ? raw(`<span class="kpi__dot dot dot--${p.dot}" aria-hidden="true"></span>`) : ""}
    </article>`;
}

/* ---------------- CHIPS DE FILTRO ---------------- */
/**
 * @param {{ items:{id:string,label:string,count?:number,tone?:string}[], active:string|string[], name:string, solid?:boolean, multi?:boolean }} p
 */
export function chipGroup(p) {
  const active = new Set([].concat(p.active ?? []));
  return html`
    <div class="chips ${p.solid ? "chips--solid" : ""}" role="group" data-chips="${p.name}" data-multi="${p.multi ? "1" : "0"}">
      ${p.items.map((it) => html`
        <button type="button" class="chip ${active.has(it.id) ? "is-active" : ""} ${it.tone ? `chip--${it.tone}` : ""}"
          data-chip="${it.id}" aria-pressed="${active.has(it.id)}">
          ${it.label}
          ${it.count != null ? raw(`<span class="chip__count tabular">${escapeHtml(it.count)}</span>`) : ""}
        </button>`)}
    </div>`;
}

/* ---------------- TAG ---------------- */
export function tag(label, tone = "", extra = "") {
  return html`<span class="tag ${tone ? `tag--${tone}` : ""} ${extra}">${label}</span>`;
}
export function tags(list = [], tone = "") {
  if (!list.length) return "";
  return `<div class="tags">${list.map((t) => tag(t, tone)).join("")}</div>`;
}

/* ---------------- AVATAR ---------------- */
/** Avatar de una persona: foto si hay url, si no iniciales. */
export function avatar(name, url, size = "") {
  return html`
    <span class="avatar ${size ? `avatar--${size}` : ""}" title="${name}">
      ${url ? raw(`<img src="${escapeHtml(url)}" alt="" loading="lazy" />`) : initials(name)}
    </span>`;
}
/** Avatar de familia: usa la primera foto o iniciales del nombre. */
export function familyAvatar(family, size = "") {
  return avatar(family?.name || "", family?.avatarUrls?.[0] || family?.avatarUrl, size);
}
/** Avatar "Auto" para acciones automáticas del historial. */
export function autoAvatar(label = "Auto") {
  return html`<span class="avatar avatar--auto">${raw(icon("zap"))}<span class="avatar__badge">${label}</span></span>`;
}

/* ---------------- TOGGLE ---------------- */
export function toggle({ id, checked, label, name, disabled }) {
  return html`
    <label class="toggle">
      <input type="checkbox" role="switch" id="${id}" name="${name || id}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} aria-label="${label || ""}" />
      <span class="toggle__track"></span>
    </label>`;
}

/* ---------------- BREADCRUMB ---------------- */
export function breadcrumb(items) {
  return html`
    <nav class="breadcrumb" aria-label="Migas de pan">
      ${items.map((it, i) => html`
        ${i > 0 ? raw(icon("chevronRight")) : ""}
        ${it.href ? raw(`<a href="${escapeHtml(it.href)}">${escapeHtml(it.label)}</a>`) : raw(`<span aria-current="page">${escapeHtml(it.label)}</span>`)}`)}
    </nav>`;
}

/* ---------------- ESTADOS ---------------- */
export function skeleton(kind = "row", count = 3) {
  return Array.from({ length: count }, () => `<div class="skeleton skeleton--${kind}" aria-hidden="true"></div>`).join("");
}
export function emptyState(title = "No hay nada por aquí", text = "") {
  return html`<div class="state">${raw(icon("inbox"))}<p class="state__title">${title}</p>${text ? raw(`<p>${escapeHtml(text)}</p>`) : ""}</div>`;
}
export function errorState(err, retryAction = "retry") {
  return html`
    <div class="state state--error" role="alert">
      ${raw(icon("warning"))}
      <p class="state__title">No se pudieron cargar los datos</p>
      <p>${err?.message || "Error desconocido"}</p>
      <button class="btn btn--outline btn--sm" data-action="${retryAction}">Reintentar</button>
    </div>`;
}

/**
 * Carga asíncrona con skeleton + error + reintento.
 * @param {HTMLElement} el      contenedor
 * @param {() => Promise<any>} load
 * @param {(data:any) => string} render  devuelve HTML
 * @param {{ skeleton?: string, after?: (data:any, el:HTMLElement) => void }} [opts]
 */
export async function mountAsync(el, load, render, opts = {}) {
  if (!el) return;
  el.setAttribute("aria-busy", "true");
  el.innerHTML = opts.skeleton ?? skeleton("row", 3);
  try {
    const data = await load();
    if (!el.isConnected) return;
    el.innerHTML = render(data);
    opts.after?.(data, el);
    return data;
  } catch (err) {
    console.error(err);
    if (!el.isConnected) return;
    el.innerHTML = errorState(err);
    el.querySelector('[data-action="retry"]')?.addEventListener("click", () => mountAsync(el, load, render, opts), { once: true });
  } finally {
    el.removeAttribute("aria-busy");
  }
}

/* ---------------- TOAST ---------------- */
export function toast(message, type = "info", ms = 3200) {
  let host = document.querySelector(".toasts");
  if (!host) {
    host = document.createElement("div");
    host.className = "toasts";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/* ---------------- BOTÓN CON LOADING ---------------- */
/** Ejecuta fn mostrando estado de carga en el botón y toast de error si falla. */
export async function withLoading(button, fn, { success } = {}) {
  if (button?.classList.contains("is-loading")) return;
  button?.classList.add("is-loading");
  button?.setAttribute("aria-busy", "true");
  try {
    const result = await fn();
    if (success) toast(success, "success");
    return result;
  } catch (err) {
    console.error(err);
    toast(err?.message || "Ha ocurrido un error", "error");
    throw err;
  } finally {
    button?.classList.remove("is-loading");
    button?.removeAttribute("aria-busy");
  }
}

/* ---------------- MODAL ---------------- */
/**
 * Modal genérico. bodyHtml puede incluir un <form>. Resuelve con FormData
 * (si hay form) o true al confirmar; con null al cancelar.
 */
export function openModal({ title, bodyHtml = "", confirmLabel = "Confirmar", cancelLabel = "Cancelar", tone = "accent" }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = html`
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h3 id="modal-title">${title}</h3>
        <form class="stack" id="modal-form">${raw(bodyHtml)}
          <div class="modal__footer">
            <button type="button" class="btn btn--ghost" data-close>${cancelLabel}</button>
            <button type="submit" class="btn btn--${tone}">${confirmLabel}</button>
          </div>
        </form>
      </div>`;
    const close = (val) => { backdrop.remove(); document.removeEventListener("keydown", onKey); resolve(val); };
    const onKey = (e) => e.key === "Escape" && close(null);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop || e.target.closest("[data-close]")) close(null); });
    backdrop.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      close([...fd.keys()].length ? fd : true);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(backdrop);
    (backdrop.querySelector("input,select,textarea") || backdrop.querySelector('[type="submit"]')).focus();
  });
}

/** Conecta un grupo de chips: llama onChange(activeIds[]) al pulsar. */
export function bindChips(root, name, onChange) {
  const group = root.querySelector(`[data-chips="${name}"]`);
  if (!group) return;
  const multi = group.dataset.multi === "1";
  group.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-chip]");
    if (!chip) return;
    if (multi) {
      chip.classList.toggle("is-active");
    } else {
      group.querySelectorAll("[data-chip]").forEach((c) => c.classList.toggle("is-active", c === chip));
    }
    group.querySelectorAll("[data-chip]").forEach((c) => c.setAttribute("aria-pressed", c.classList.contains("is-active")));
    onChange([...group.querySelectorAll(".chip.is-active")].map((c) => c.dataset.chip));
  });
}
