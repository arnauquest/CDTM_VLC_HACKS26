/**
 * CLIENTE HTTP
 * ---------------------------------------------------------------------------
 * Envoltorio fino sobre fetch:
 *  - Prefija API_BASE_URL.
 *  - Añade `Authorization: Bearer <token>` si existe token.
 *  - Serializa JSON / FormData y parsea la respuesta.
 *  - Normaliza errores en ApiError { status, message, details }.
 *  - Si config.USE_MOCKS === true, NO hace red: resuelve con js/api/mocks.
 *
 * Las vistas NUNCA llaman a esto directamente: usan js/api/endpoints.js.
 */
import { config } from "../config.js";

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export function getToken() {
  try { return localStorage.getItem(config.AUTH_TOKEN_KEY); } catch { return null; }
}
export function setToken(token) {
  try {
    if (token) localStorage.setItem(config.AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(config.AUTH_TOKEN_KEY);
  } catch { /* storage no disponible */ }
}

function buildUrl(path, query) {
  const url = new URL(config.API_BASE_URL + path, window.location.origin);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
      else url.searchParams.set(k, v);
    });
  }
  return url.toString();
}

let mockModulePromise = null;
async function mockRequest(method, path, options) {
  // Import dinámico: en producción (USE_MOCKS=false) los mocks ni se descargan.
  mockModulePromise ??= import("./mocks/index.js");
  const { resolveMock } = await mockModulePromise;
  await new Promise((r) => setTimeout(r, config.MOCK_LATENCY_MS));
  return resolveMock(method, path, options);
}

/**
 * @param {"GET"|"POST"|"PUT"|"PATCH"|"DELETE"} method
 * @param {string} path  Ruta relativa a API_BASE_URL, p.ej. "/alerts/123"
 * @param {{ query?: object, body?: any, formData?: FormData, responseType?: "json"|"blob"|"text", signal?: AbortSignal }} [options]
 */
export async function request(method, path, options = {}) {
  if (config.USE_MOCKS) return mockRequest(method, path, options);

  const headers = { Accept: "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let body;
  if (options.formData) {
    body = options.formData; // el navegador pone el Content-Type multipart
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.REQUEST_TIMEOUT_MS);
  if (options.signal) options.signal.addEventListener("abort", () => controller.abort());

  let res;
  try {
    res = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body,
      signal: controller.signal,
      credentials: "include",
    });
  } catch (err) {
    throw new ApiError(0, err.name === "AbortError" ? "La petición ha tardado demasiado" : "No se pudo conectar con el servidor", err);
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 401) {
    setToken(null);
    window.dispatchEvent(new CustomEvent("auth:expired"));
  }

  if (!res.ok) {
    let details = null;
    try { details = await res.json(); } catch { /* sin cuerpo JSON */ }
    const message = details?.message || details?.detail || `Error ${res.status}`;
    throw new ApiError(res.status, message, details);
  }

  if (res.status === 204) return null;
  const type = options.responseType || "json";
  if (type === "blob") return res.blob();
  if (type === "text") return res.text();
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

export const http = {
  get: (path, opts) => request("GET", path, opts),
  post: (path, body, opts = {}) => request("POST", path, { ...opts, body }),
  put: (path, body, opts = {}) => request("PUT", path, { ...opts, body }),
  patch: (path, body, opts = {}) => request("PATCH", path, { ...opts, body }),
  del: (path, opts) => request("DELETE", path, opts),
  upload: (path, formData, opts = {}) => request("POST", path, { ...opts, formData }),
};
