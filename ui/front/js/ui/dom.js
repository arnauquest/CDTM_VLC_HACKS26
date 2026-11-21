/**
 * Utilidades DOM y de formato. Sin dependencias.
 */
import { config } from "../config.js";

/** Escapa texto para insertarlo en HTML. Usar SIEMPRE con datos del backend. */
export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Tagged template que escapa automáticamente las interpolaciones.
 * Para insertar HTML ya construido (otro componente) envolverlo con raw().
 *   html`<p>${user.name}</p>`         -> escapado
 *   html`<div>${raw(kpiCard(...))}</div>` -> sin escapar
 * Los arrays se concatenan (útil para .map()).
 */
export function html(strings, ...values) {
  const out = strings.reduce((acc, str, i) => {
    if (i >= values.length) return acc + str;
    return acc + str + toHtml(values[i]);
  }, "");
  // Se marca como "seguro" para que al anidar html`` dentro de html`` no se re-escape.
  return new SafeHtml(out);
}
/** String ya escapado/construido por html``. Se comporta como string normal. */
class SafeHtml extends String {}
function toHtml(v) {
  if (v == null || v === false) return "";
  if (Array.isArray(v)) return v.map(toHtml).join("");
  if (v instanceof RawHtml) return String(v.value);
  if (v instanceof SafeHtml) return String(v);
  return escapeHtml(v);
}
class RawHtml { constructor(value) { this.value = value; } }
export const raw = (value) => new RawHtml(value ?? "");

/**
 * Sanitiza HTML enriquecido que venga del backend (p.ej. cuerpo del email
 * generado por IA). Lista blanca de etiquetas; elimina atributos salvo href
 * http(s)/mailto en <a>.
 */
const ALLOWED_TAGS = new Set(["P", "BR", "STRONG", "B", "EM", "I", "U", "UL", "OL", "LI", "A", "SPAN"]);
export function sanitizeHtml(input) {
  const doc = new DOMParser().parseFromString(`<div>${input ?? ""}</div>`, "text/html");
  const walk = (node) => {
    [...node.children].forEach((child) => {
      if (!ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(...(["SCRIPT", "STYLE", "IFRAME", "OBJECT"].includes(child.tagName) ? [] : child.childNodes));
        return walk(node);
      }
      [...child.attributes].forEach((attr) => {
        const keep = child.tagName === "A" && attr.name === "href" && /^(https?:|mailto:)/i.test(attr.value);
        if (!keep) child.removeAttribute(attr.name);
      });
      walk(child);
    });
  };
  const root = doc.body.firstElementChild;
  walk(root);
  return root.innerHTML;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Delegación de eventos: on(root, "click", "[data-action=x]", handler) */
export function on(root, event, selector, handler) {
  const listener = (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  };
  root.addEventListener(event, listener);
  return () => root.removeEventListener(event, listener);
}

export function initials(name = "") {
  const parts = name.replace(/[&()]/g, " ").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export const fmt = {
  number: (n) => (n == null ? "—" : new Intl.NumberFormat(config.LOCALE).format(n)),
  percent: (ratio) => (ratio == null ? "—" : `${Math.round(ratio * 100)}%`),
  minutes: (m) => (m == null ? "—" : `${new Intl.NumberFormat(config.LOCALE, { maximumFractionDigits: 1 }).format(m)} min`),
  /** Moneda compacta: 550000 -> "550 mil US$" / "$550K" según locale. */
  moneyCompact: (n) => (n == null ? "—" : new Intl.NumberFormat(config.LOCALE, { style: "currency", currency: config.CURRENCY, notation: "compact", maximumFractionDigits: 1 }).format(n)),
  money: (n) => (n == null ? "—" : new Intl.NumberFormat(config.LOCALE, { style: "currency", currency: config.CURRENCY, maximumFractionDigits: 0 }).format(n)),
  date: (iso) => (iso ? new Intl.DateTimeFormat(config.LOCALE, { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—"),
  relative: (iso) => {
    if (!iso) return "—";
    const diff = (new Date(iso).getTime() - Date.now()) / 1000;
    const rtf = new Intl.RelativeTimeFormat(config.LOCALE, { numeric: "auto" });
    const abs = Math.abs(diff);
    if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
    return rtf.format(Math.round(diff / 86400), "day");
  },
  duration: (sec) => {
    const s = Math.max(0, Math.round(sec || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  },
};

/** Descarga un Blob como archivo. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
