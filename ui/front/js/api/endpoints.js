/**
 * CATÁLOGO DE ENDPOINTS
 * ---------------------------------------------------------------------------
 * Único punto de contacto entre las vistas y el backend. Si el backend cambia
 * una ruta o un nombre de campo, se ajusta AQUÍ (o en un adaptador aquí) y las
 * vistas no se tocan.
 *
 * Las rutas son una PROPUESTA de contrato: confirmarlas con backend. El shape
 * de cada respuesta está documentado en README.md (sección "Contrato de datos")
 * y reflejado en js/api/mocks/data.js.
 */
import { http } from "./client.js";

const enc = encodeURIComponent;

/* ======================== SESIÓN ======================== */
export const sessionApi = {
  /** Usuario actual -> { id, name, avatarUrl, role: "consultor"|"admin", tenant: { id, name } } */
  me: () => http.get("/me"),
  logout: () => http.post("/auth/logout"),
};

/* ======================== MARCA (white-label) ======================== */
export const brandApi = {
  /** Marca activa del tenant -> Brand (ver README) */
  get: () => http.get("/brand"),
  /** Guarda borrador (admin) */
  saveDraft: (brand) => http.put("/brand/draft", brand),
  /** Publica la marca (admin) -> Brand */
  publish: (brand) => http.post("/brand/publish", brand),
  /** Restaura valores por defecto (admin) -> Brand */
  reset: () => http.post("/brand/reset"),
  /** Sube logo o isotipo. kind: "logo" | "icon" -> { url } */
  uploadAsset: (kind, file) => {
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", file);
    return http.upload("/brand/assets", fd);
  },
  /** Perfiles de voz disponibles -> [{ id, label, status }] */
  voices: () => http.get("/brand/voices"),
};

/* ======================== NOTIFICACIONES ======================== */
export const notificationsApi = {
  /** -> { unread: number } */
  count: () => http.get("/notifications/count"),
};

/* ======================== CONSULTOR ======================== */
export const consultorApi = {
  /** KPIs de Inicio -> { familiesMonitored, activeAlerts, avgReviewMinutes, silentActions } */
  dashboardSummary: () => http.get("/consultant/dashboard"),

  /** Categorías de alerta -> [{ id, label }] */
  alertCategories: () => http.get("/alerts/categories"),

  /** Feed de alertas -> [AlertSummary]. categories: array de ids */
  alerts: ({ categories, status = "pending", consultantId } = {}) => http.get("/alerts", { query: { category: categories, status, consultant: consultantId } }),

  /** Detalle -> AlertDetail */
  alert: (id) => http.get(`/alerts/${enc(id)}`),
  /** Aprobación en lote -> { approved: number } */
  approveBatch: (ids) => http.post("/alerts/batch-approve", { ids }),
  /** Guarda edición del borrador de correo y/o guion */
  updateDraft: (id, draft) => http.put(`/alerts/${enc(id)}/draft`, draft),
  /** Envía el correo 1-clic */
  approveEmail: (id) => http.post(`/alerts/${enc(id)}/email/approve`),
  /** Lanza la llamada automatizada */
  launchCall: (id) => http.post(`/alerts/${enc(id)}/call/launch`),
  /** Pospone la alerta. until: ISO date */
  snooze: (id, until) => http.post(`/alerts/${enc(id)}/snooze`, { until }),

  /** KPIs de Familias -> { total, needsApproval, autopilot } */
  familiesSummary: () => http.get("/families/summary"),
  /** Familias -> [FamilySummary]. status: "all"|"needs_approval"|"autopilot" */
  families: ({ q, status } = {}) => http.get("/families", { query: { q, status } }),

  /** KPIs historial -> { total, silent, approved } */
  historySummary: () => http.get("/history/summary"),
  /** Historial -> [HistoryItem]. type: "all"|"silent"|"approved" */
  history: ({ type } = {}) => http.get("/history", { query: { type } }),
  /** Revertir acción / ajustar regla */
  revertHistory: (id) => http.post(`/history/${enc(id)}/revert`),

  /** Plantillas -> [Template] */
  templates: () => http.get("/templates"),

  /** Reglas de autonomía -> AutonomySettings */
  autonomy: () => http.get("/consultant/settings/autonomy"),
  saveAutonomy: (settings) => http.put("/consultant/settings/autonomy", settings),
};

/* ======================== ADMIN ======================== */
export const adminApi = {
  /** KPIs -> { activeFamilies, activeConsultants, slaMinutes, silenceRate } */
  summary: () => http.get("/admin/summary"),
  /** Carga por consultor -> [ConsultantWorkload]. filter: "all"|"overloaded"|"low_sla"|"inactive" */
  workload: ({ filter } = {}) => http.get("/admin/consultants/workload", { query: { filter } }),
  /** Reasignar carteras. payload: { fromConsultantId?, toConsultantId?, familyIds? } */
  reassign: (payload) => http.post("/admin/portfolios/reassign", payload),
  /** Exportar informe compliance -> Blob (PDF/CSV) */
  exportCompliance: () => http.get("/admin/compliance/report", { responseType: "blob" }),

  /** Onboarding: cola de familias pendientes -> [OnboardingRequest] */
  onboardingQueue: () => http.get("/admin/onboarding/queue"),
  onboardingSettings: () => http.get("/admin/onboarding/settings"),
  saveOnboardingSettings: (s) => http.put("/admin/onboarding/settings", s),
  acceptFamily: (id, consultantId) => http.post(`/admin/onboarding/${enc(id)}/accept`, { consultantId }),
  rejectFamily: (id) => http.post(`/admin/onboarding/${enc(id)}/reject`),

  /** Equipo interno -> [TeamMember] */
  team: () => http.get("/admin/users"),
  /** Crear usuario. payload: { name, email, role } */
  createUser: (payload) => http.post("/admin/users", payload),
  /** Editar permisos. payload: { role, permissions[] } */
  updatePermissions: (id, payload) => http.patch(`/admin/users/${enc(id)}`, payload),

  /** Guardrails IA -> [Guardrail] */
  guardrails: () => http.get("/admin/governance/guardrails"),
  setGuardrail: (id, enabled) => http.patch(`/admin/governance/guardrails/${enc(id)}`, { enabled }),

  /** Integraciones -> [Integration] */
  integrations: () => http.get("/admin/integrations"),
  verifyIntegration: (id) => http.post(`/admin/integrations/${enc(id)}/verify`),

  /** Plan corporativo -> Billing */
  billing: () => http.get("/admin/billing"),
  addSeat: () => http.post("/admin/billing/seats"),
  downloadInvoices: () => http.get("/admin/billing/invoices", { responseType: "blob" }),
};
