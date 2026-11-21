/**
 * ROUTER DE MOCKS (SOLO DESARROLLO)
 * Empareja "MÉTODO /ruta/:param" con un handler que devuelve datos de data.js.
 * Si una ruta no está mockeada lanza un 404 para detectarlo enseguida.
 */
import { config } from "../../config.js";
import { ApiError } from "../client.js";
import * as db from "./data.js";

const clone = (x) => (x === undefined ? x : structuredClone(x));

const routes = [
  ["GET /me", () => db.users[config.MOCK_ROLE] || db.users.consultor],
  ["POST /auth/logout", () => null],

  ["GET /brand", () => db.brand],
  ["PUT /brand/draft", ({ body }) => ({ ...db.brand, ...body })],
  ["POST /brand/publish", ({ body }) => Object.assign(db.brand, body)],
  ["POST /brand/reset", () => db.brand],
  ["POST /brand/assets", ({ formData }) => ({ url: URL.createObjectURL(formData.get("file")) })],
  ["GET /brand/voices", () => db.voices],

  ["GET /notifications/count", () => ({ unread: { admin: db.adminSummary.unreadNotifications, cliente: 1 }[config.MOCK_ROLE] ?? 3 })],

  ["GET /consultant/dashboard", () => db.consultantDashboard],
  ["GET /alerts/categories", () => db.alertCategories],
  ["GET /alerts", ({ query }) => {
    const cats = [].concat(query?.category || []);
    return cats.length ? db.alerts.filter((a) => a.categories.some((c) => cats.includes(c))) : db.alerts;
  }],
  ["POST /alerts/batch-approve", ({ body }) => ({ approved: body.ids.length })],
  ["GET /alerts/:id", ({ params }) => ({ ...db.alertDetail, id: params.id, family: db.alerts.find((a) => a.id === params.id)?.family || db.alertDetail.family })],
  ["PUT /alerts/:id/draft", ({ body }) => body],
  ["POST /alerts/:id/email/approve", () => ({ ok: true })],
  ["POST /alerts/:id/call/launch", () => ({ ok: true })],
  ["POST /alerts/:id/snooze", () => ({ ok: true })],

  ["GET /families/summary", () => db.familiesSummary],
  ["GET /families", ({ query }) => {
    let list = db.families;
    if (query?.status && query.status !== "all") list = list.filter((f) => f.status === query.status);
    if (query?.q) list = list.filter((f) => f.name.toLowerCase().includes(String(query.q).toLowerCase()));
    return list;
  }],

  ["GET /history/summary", () => db.historySummary],
  ["GET /history", ({ query }) => (!query?.type || query.type === "all" ? db.history : db.history.filter((h) => h.kind === query.type))],
  ["POST /history/:id/revert", () => ({ ok: true })],

  ["GET /templates", () => db.templates],
  ["GET /consultant/settings/autonomy", () => db.autonomy],
  ["PUT /consultant/settings/autonomy", ({ body }) => body],

  ["GET /client/plan", () => db.clientPlan],
  ["GET /client/financial-updates/fields", () => db.clientUpdateFields],
  ["POST /client/financial-updates", () => ({ ok: true })],
  ["GET /client/advisor", () => db.clientAdvisor],
  ["GET /client/quick-topics", () => db.clientQuickTopics],
  ["GET /client/chat/messages", ({ query }) => {
    const i = query?.after ? db.clientMessages.findIndex((m) => m.id === query.after) : -1;
    return db.clientMessages.slice(i + 1);
  }],
  ["POST /client/chat/messages", ({ body }) => {
    const msg = { id: `m-${Date.now()}`, author: "client", text: body.text, createdAt: new Date().toISOString() };
    db.clientMessages.push(msg);
    // Simula respuesta del asesor para poder ver el polling funcionando.
    setTimeout(() => db.clientMessages.push({ id: `m-${Date.now()}-r`, author: "advisor", text: "¡Recibido! Lo reviso y te respondo en breve.", createdAt: new Date().toISOString() }), 2500);
    return msg;
  }],
  ["GET /client/call-slots", () => db.clientCallSlots],
  ["POST /client/call-requests", ({ body }) => ({ ok: true, ...body })],
  ["GET /client/preferences", () => db.clientPreferences],
  ["PUT /client/preferences", ({ body }) => Object.assign(db.clientPreferences, body)],

  ["GET /admin/summary", () => db.adminSummary],
  ["GET /admin/consultants/workload", ({ query }) => {
    const f = query?.filter;
    if (f === "overloaded") return db.workload.filter((c) => c.familiesAssigned > c.capacity);
    if (f === "low_sla") return db.workload.filter((c) => c.slaMinutes > c.slaTarget);
    if (f === "inactive") return db.workload.filter((c) => !c.active);
    return db.workload;
  }],
  ["POST /admin/portfolios/reassign", () => ({ ok: true })],
  ["GET /admin/compliance/report", () => new Blob(["informe,compliance\nmock,1\n"], { type: "text/csv" })],

  ["GET /admin/onboarding/queue", () => db.onboardingQueue],
  ["GET /admin/onboarding/settings", () => db.onboardingSettings],
  ["PUT /admin/onboarding/settings", ({ body }) => Object.assign(db.onboardingSettings, body)],
  ["POST /admin/onboarding/:id/accept", () => ({ ok: true })],
  ["POST /admin/onboarding/:id/reject", () => ({ ok: true })],

  ["GET /admin/users", () => db.team],
  ["POST /admin/users", ({ body }) => ({ id: "new", ...body })],
  ["PATCH /admin/users/:id", ({ body }) => body],

  ["GET /admin/governance/guardrails", () => db.guardrails],
  ["PATCH /admin/governance/guardrails/:id", ({ params, body }) => ({ id: params.id, ...body })],
  ["GET /admin/integrations", () => db.integrations],
  ["POST /admin/integrations/:id/verify", ({ params }) => db.integrations.find((i) => i.id === params.id)],
  ["GET /admin/billing", () => db.billing],
  ["POST /admin/billing/seats", () => ({ ...db.billing, seatsTotal: db.billing.seatsTotal + 1 })],
  ["GET /admin/billing/invoices", () => new Blob(["facturas mock"], { type: "text/plain" })],
].map(([key, handler]) => {
  const [method, pattern] = key.split(" ");
  const names = [];
  const regex = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), "([^/]+)")) + "$");
  return { method, regex, names, handler };
});

export function resolveMock(method, path, options = {}) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = path.match(r.regex);
    if (!m) continue;
    const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    const result = r.handler({ params, query: options.query, body: options.body, formData: options.formData });
    return result instanceof Blob ? result : clone(result);
  }
  throw new ApiError(404, `Mock no definido para ${method} ${path}`);
}
