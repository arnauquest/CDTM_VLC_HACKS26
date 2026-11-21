/**
 * CONSULTOR · INICIO  (maqueta: UI_mock/profile_consultor/inicio.jpeg)
 * KPIs + filtros por categoría + Feed de Alertas.
 * Endpoints: GET /consultant/dashboard, GET /alerts/categories, GET /alerts
 */
import { consultorApi } from "../../api/endpoints.js";
import { html, fmt, escapeHtml } from "../../ui/dom.js";
import { kpiCard, mountAsync, skeleton } from "../../ui/components.js";
import { mountAlertFeed } from "./_alert-feed.js";

export default {
  title: "Inicio",
  async render(el, { navigate }) {
    el.innerHTML = html`
      <section class="grid-kpis" data-slot="kpis" aria-label="Indicadores"></section>
      <section class="stack" data-slot="feed"></section>`;

    mountAsync(el.querySelector('[data-slot="kpis"]'), consultorApi.dashboardSummary, (s) => [
      kpiCard({ icon: "family", tone: "accent", value: fmt.number(s.familiesMonitored), label: "Familias monitoreadas" }),
      kpiCard({ icon: "bell", tone: "warning", value: fmt.number(s.activeAlerts), label: "Alertas activas" }),
      kpiCard({ icon: "clock", tone: "neutral", labelHtml: `Tiempo de revisión: <b>${escapeHtml(fmt.minutes(s.avgReviewMinutes))}</b>` }),
      kpiCard({ icon: "history", tone: "neutral", value: fmt.number(s.silentActions), label: "Acciones automáticas silenciosas (Sin impacto)" }),
    ].join(""), { skeleton: skeleton("kpi", 4) });

    return mountAlertFeed(el.querySelector('[data-slot="feed"]'), { title: "Feed de Alertas", navigate });
  },
};
