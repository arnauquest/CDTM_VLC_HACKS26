/**
 * IMAGEN DE MARCA (WHITE-LABEL)
 * ---------------------------------------------------------------------------
 * Toda la identidad visual es variable y llega del backend (GET /brand).
 * Este módulo:
 *   1. Aplica la marca cacheada en localStorage al arrancar (sin parpadeo).
 *   2. Pide la marca al backend y la aplica (sobrescribe CSS vars, logo,
 *      favicon, título y fuente).
 *   3. Expone renderLogo() para pintar el logo allí donde haga falta.
 *   4. Emite el evento "brand:change" para que la UI se repinte.
 *
 * Si el formato de marca del backend cambia, solo hay que adaptar
 * normalizeBrand(): el resto de la app trabaja con el objeto normalizado.
 */
import { config } from "./config.js";
import { brandApi } from "./api/endpoints.js";
import { escapeHtml } from "./ui/dom.js";

/** Valores por defecto si el backend no responde. */
export const DEFAULT_BRAND = Object.freeze({
  appName: "sherpas",
  tenantName: "",
  logoUrl: null,
  logoInverseUrl: null,
  iconUrl: null,
  colors: { primary: "#0F2942", accent: "#10B981" },
  fontFamily: null,
  fontUrl: null,
  legalFooter: "",
  voiceProfileId: null,
  integrationActive: false,
});

let current = structuredClone(DEFAULT_BRAND);

/** Adaptador: acepta variantes de nombres de campo (snake_case, anidados...). */
export function normalizeBrand(raw = {}) {
  const colors = raw.colors || {};
  return {
    appName: raw.appName ?? raw.app_name ?? raw.name ?? DEFAULT_BRAND.appName,
    tenantName: raw.tenantName ?? raw.tenant_name ?? DEFAULT_BRAND.tenantName,
    logoUrl: raw.logoUrl ?? raw.logo_url ?? null,
    logoInverseUrl: raw.logoInverseUrl ?? raw.logo_inverse_url ?? null,
    iconUrl: raw.iconUrl ?? raw.icon_url ?? null,
    colors: {
      primary: colors.primary ?? raw.primaryColor ?? raw.primary_color ?? DEFAULT_BRAND.colors.primary,
      accent: colors.accent ?? raw.accentColor ?? raw.accent_color ?? DEFAULT_BRAND.colors.accent,
    },
    fontFamily: raw.fontFamily ?? raw.font_family ?? null,
    fontUrl: raw.fontUrl ?? raw.font_url ?? null,
    legalFooter: raw.legalFooter ?? raw.legal_footer ?? "",
    voiceProfileId: raw.voiceProfileId ?? raw.voice_profile_id ?? null,
    integrationActive: Boolean(raw.integrationActive ?? raw.integration_active ?? false),
  };
}

/** Devuelve #000 o #fff según el contraste con el color dado (WCAG luminance). */
export function contrastColor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#ffffff";
  const lum = [rgb.r, rgb.g, rgb.b]
    .map((v) => v / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
  return L > 0.45 ? "#0f1b2a" : "#ffffff";
}

export function isHexColor(v) { return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v || "").trim()); }

function hexToRgb(hex) {
  if (!isHexColor(hex)) return null;
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function setFavicon(url) {
  let link = document.querySelector('link[rel="icon"]');
  if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
  link.href = url || "assets/brand/favicon.svg";
}

function loadFont(url) {
  const id = "brand-font";
  document.getElementById(id)?.remove();
  if (!url) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = url;
  document.head.appendChild(link);
}

/** Aplica la marca a toda la app vía CSS custom properties. */
export function applyBrand(rawBrand) {
  current = normalizeBrand(rawBrand);
  const root = document.documentElement.style;
  const { primary, accent } = current.colors;
  if (isHexColor(primary)) {
    root.setProperty("--brand-primary", primary);
    root.setProperty("--brand-primary-contrast", contrastColor(primary));
  }
  if (isHexColor(accent)) {
    root.setProperty("--brand-accent", accent);
    root.setProperty("--brand-accent-contrast", contrastColor(accent));
  }
  if (current.fontFamily) {
    root.setProperty("--brand-font-family", `"${current.fontFamily}", system-ui, sans-serif`);
    root.setProperty("--brand-wordmark-font", `"${current.fontFamily}", system-ui, sans-serif`);
  } else {
    root.removeProperty("--brand-font-family");
    root.removeProperty("--brand-wordmark-font");
  }
  loadFont(current.fontUrl);
  setFavicon(current.iconUrl);
  document.title = current.tenantName ? `${current.appName} · ${current.tenantName}` : current.appName;

  try { localStorage.setItem(config.BRAND_CACHE_KEY, JSON.stringify(current)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent("brand:change", { detail: current }));
  return current;
}

export function getBrand() { return current; }

/** 1) aplica cache 2) pide al backend. No lanza: si falla, se queda la cache/default. */
export async function initBrand() {
  try {
    const cached = localStorage.getItem(config.BRAND_CACHE_KEY);
    if (cached) applyBrand(JSON.parse(cached));
  } catch { /* ignore */ }
  try {
    applyBrand(await brandApi.get());
  } catch (err) {
    console.warn("[brand] No se pudo cargar la marca del backend, uso fallback.", err);
    let hasCache = false;
    try { hasCache = Boolean(localStorage.getItem(config.BRAND_CACHE_KEY)); } catch { /* ignore */ }
    if (!hasCache) applyBrand(DEFAULT_BRAND);
  }
  return current;
}

/**
 * HTML del logo: <img> si hay logoUrl, si no wordmark de texto con appName.
 * @param {object} [brand] por defecto la marca activa
 * variant: "logo" (fondo claro) | "inverse" (fondo oscuro, p.ej. cabecera del
 * área de cliente; usa logoInverseUrl y si no hay, logoUrl) | "icon".
 * @param {{ size?: "sm"|"md", variant?: "logo"|"inverse"|"icon" }} [opts]
 */
export function renderLogo(brand = current, { size = "md", variant = "logo" } = {}) {
  const url = variant === "icon" ? brand.iconUrl || brand.logoUrl
    : variant === "inverse" ? brand.logoInverseUrl || brand.logoUrl
    : brand.logoUrl;
  if (url) {
    return `<img class="brand-logo ${size === "sm" ? "brand-logo--sm" : ""}" src="${escapeHtml(url)}" alt="${escapeHtml(brand.appName)}" />`;
  }
  return `<span class="wordmark wordmark--${size}">${escapeHtml(brand.appName)}</span>`;
}
