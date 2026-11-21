/**
 * CONFIGURACIÓN GLOBAL DEL FRONT
 * ---------------------------------------------------------------------------
 * Único sitio donde se tocan URLs y flags de entorno.
 *
 * Se puede sobrescribir SIN tocar código definiendo `window.__APP_CONFIG__`
 * en un <script> antes de cargar js/main.js (ver index.html), o con query
 * params en desarrollo:
 *   ?mock=0            -> fuerza backend real
 *   ?mock=1            -> fuerza mocks
 *   ?role=admin        -> selecciona la sesión local de un admin
 *   ?role=consultor    -> selecciona la sesión local de un consultor
 */

const params = new URLSearchParams(window.location.search);
const overrides = window.__APP_CONFIG__ || {};

function readBool(name, fallback) {
  const v = params.get(name);
  if (v === null) return fallback;
  return v === "1" || v === "true";
}

export const config = {
  /** URL base del backend (sin barra final). */
  API_BASE_URL: overrides.API_BASE_URL ?? (window.location.port === "5173" ? "http://127.0.0.1:3000/api" : "/api"),

  /**
   * true  -> las llamadas se resuelven con js/api/mocks/*.js (no hay red).
   * false -> se llama al backend real en API_BASE_URL.
   * Mientras el backend no esté listo, dejar en true.
   */
  USE_MOCKS: readBool("mock", overrides.USE_MOCKS ?? false),

  /** Latencia simulada de los mocks (ms) para ver skeletons. */
  MOCK_LATENCY_MS: overrides.MOCK_LATENCY_MS ?? 350,

  /** Timeout de las peticiones reales (ms). */
  REQUEST_TIMEOUT_MS: overrides.REQUEST_TIMEOUT_MS ?? 120000,

  /** Clave de localStorage donde se guarda el token de sesión (Bearer). */
  AUTH_TOKEN_KEY: overrides.AUTH_TOKEN_KEY ?? `sherpas.token.${params.get("role") || "consultor"}.${params.get("family") || "michael-carter"}`,

  /** Clave de localStorage para cachear la marca y evitar parpadeo al cargar. */
  BRAND_CACHE_KEY: overrides.BRAND_CACHE_KEY ?? "sherpas.brand",

  /** Rol de la sesión local (también usado por los mocks). */
  DEMO_FAMILY: params.get("family") || "michael-carter",
  MOCK_ROLE: params.get("role") || overrides.MOCK_ROLE || "consultor",

  /**
   * Cada cuántos ms se piden mensajes nuevos del chat del cliente (polling).
   * Si backend ofrece WebSocket/SSE, sustituir en views/cliente/_chat.js.
   */
  CHAT_POLL_MS: overrides.CHAT_POLL_MS ?? 5000,

  /** Locale para formatear números, monedas y fechas. */
  LOCALE: overrides.LOCALE ?? "es-ES",
  CURRENCY: overrides.CURRENCY ?? "USD",
};
