/**
 * ADMIN · RESUMEN EJECUTIVO  (maqueta: UI_mock/profile_admin/resumen_ejecutivo.jpeg)
 * KPIs globales + filtros + Balanceo de Carga por Consultor.
 * Endpoints: GET /admin/summary, GET /admin/consultants/workload?filter=,
 *            POST /admin/portfolios/reassign, GET /admin/compliance/report
 */
import { adminApi } from "../../api/endpoints.js";
import { html, raw, on, fmt, escapeHtml, downloadBlob } from "../../ui/dom.js";
import { icon } from "../../ui/icons.js";
import { kpiCard, chipGroup, bindChips, avatar, tag, mountAsync, skeleton, emptyState, withLoading, openModal } from "../../ui/components.js";

/**
 * Estado de carga -> etiqueta. Si el backend manda `status` se usa; si no,
 * se deriva de familiesAssigned/capacity.
 */
const WORKLOAD_STATUS = {
  not_measured: {label:"Capacidad no medida",tone:"",over:false},
  overloaded_urgent: { label: "Sobrecargado - Reasignar urgente", tone: "danger", over: true, alert: true },
  overloaded: { label: "Sobrecargado", tone: "danger", over: true },
  near_limit: { label: "Cerca del límite", tone: "", over: false },
  optimal: { label: "Capacidad óptima", tone: "success", over: false },
};
function deriveStatus(c) {
  if (c.status && WORKLOAD_STATUS[c.status]) return WORKLOAD_STATUS[c.status];
  if (!c.capacity) return WORKLOAD_STATUS.not_measured;
  const r = c.familiesAssigned / c.capacity;
  if (r > 1.05) return WORKLOAD_STATUS.overloaded_urgent;
  if (r > 1) return WORKLOAD_STATUS.overloaded;
  if (r >= 0.95) return WORKLOAD_STATUS.near_limit;
  return WORKLOAD_STATUS.optimal;
}

function workloadRow(c) {
  const st = deriveStatus(c);
  const slaBad = c.slaTarget != null && c.slaMinutes > c.slaTarget;
  return html`
    <article class="list-row workload-row" data-id="${c.id}">
      <div class="workload-row__who">
        ${raw(avatar(c.name, c.avatarUrl))}
        <div><div class="list-row__title">${c.name}</div><div class="list-row__subtitle">${c.title}</div></div>
      </div>
      <div class="workload-row__metric">
        <span class="k">Familias asignadas</span>
        <span class="v tabular"><span class="${st.over ? "v--over" : "v--ok"}">${fmt.number(c.familiesAssigned)}</span> <small>/ ${fmt.number(c.capacity)}</small>
          ${st.alert ? raw(`<span class="text-danger" style="vertical-align:middle">${icon("alertCircle", { size: 26 })}</span>`) : ""}</span>
        <span>${raw(tag(st.label, st.tone))}</span>
      </div>
      <div class="workload-row__metric workload-row__metric--plain">
        <span class="k">Target SLA</span>
        <span class="v tabular"><span class="${slaBad ? "v--warn-pill" : ""}">${fmt.minutes(c.slaMinutes)}</span></span>
      </div>
      <div class="workload-row__metric">
        <span class="k">Tasa Silencio</span>
        <span class="v tabular">${fmt.percent(c.silenceRate)}</span>
      </div>
      <div class="list-row__actions">
        <button class="btn btn--accent" data-action="manage">Gestionar Carga</button>
        <a class="btn btn--outline" href="#/alertas?consultant=${encodeURIComponent(c.id)}">Revisar Alertas</a>
      </div>
    </article>`;
}

export default {
  title: "Resumen Ejecutivo",
  render(el) {
    let filter = "all";
    let consultants = [];

    el.innerHTML = html`
      <section class="grid-kpis" data-slot="kpis"></section>
      <div data-slot="chips">${raw(chipGroup({
        name: "filter", active: filter,
        items: [
          { id: "all", label: "Todos los Consultores" },
          { id: "overloaded", label: "Sobrecargados", tone: "warning" },
          { id: "low_sla", label: "Bajo SLA" },
          { id: "inactive", label: "Inactivos" },
        ],
      }))}</div>
      <div class="section-header">
        <h2>Balanceo de Carga por Consultor</h2>
        <div class="section-header__actions">
          <button class="btn btn--accent" data-action="reassign">Reasignar Carteras</button>
          <button class="btn btn--primary" data-action="export">Exportar Informe Compliance</button>
        </div>
      </div>
      <section class="list" data-slot="list"></section>`;

    mountAsync(el.querySelector('[data-slot="kpis"]'), adminApi.summary, (s) => [
      kpiCard({ icon: "family", tone: "accent", value: fmt.number(s.activeFamilies), label: "Familias Activas", dot: "success" }),
      kpiCard({ icon: "userCog", tone: "info", value: fmt.number(s.activeConsultants), label: "Consultores Activos", dot: "info" }),
      kpiCard({ icon: "clock", tone: "accent", value: "SLA", labelHtml: `Respuesta: <b>${escapeHtml(fmt.minutes(s.slaMinutes))}</b>`, dot: "success" }),
      kpiCard({ icon: "history", tone: "warning", value: fmt.percent(s.silenceRate), labelHtml: `Tasa Silencio Inteligente: <b>${escapeHtml(fmt.percent(s.silenceRate))}</b>`, dot: "warning" }),
    ].join(""), { skeleton: skeleton("kpi", 4) });

    const listEl = el.querySelector('[data-slot="list"]');
    const loadList = () => mountAsync(listEl, () => adminApi.workload({ filter }), (list) => {
      consultants = list;
      return list.length ? list.map(workloadRow).join("") : emptyState("Ningún consultor en este filtro");
    }, { skeleton: skeleton("row", 4) });
    bindChips(el, "filter", ([id]) => { filter = id; loadList(); });
    loadList();

    const reassignModal = (fromId) => openModal({
      title: "Reasignar cartera",
      confirmLabel: "Reasignar",
      bodyHtml: html`
        <label class="field"><span class="field__label">Desde</span>
          <select class="select" name="from" required>${consultants.map((c) => raw(html`<option value="${c.id}" ${c.id === fromId ? "selected" : ""}>${c.name} (${c.familiesAssigned}/${c.capacity})</option>`))}</select></label>
        <label class="field"><span class="field__label">Hacia</span>
          <select class="select" name="to" required>${consultants.map((c) => raw(html`<option value="${c.id}">${c.name} (${c.familiesAssigned}/${c.capacity})</option>`))}</select></label>
        <label class="field"><span class="field__label">Nº de familias</span><input class="input" type="number" name="count" min="1" value="10" required /></label>`,
    });

    return on(el, "click", "[data-action]", async (e, btn) => {
      const id = btn.closest("[data-id]")?.dataset.id;
      switch (btn.dataset.action) {
        case "manage":
        case "reassign": {
          const fd = await reassignModal(id);
          if (!fd) return;
          await withLoading(btn, () => adminApi.reassign({ fromConsultantId: fd.get("from"), toConsultantId: fd.get("to"), count: Number(fd.get("count")) }), { success: "Cartera reasignada" }).catch(() => {});
          loadList();
          break;
        }
        case "export": {
          const blob = await withLoading(btn, () => adminApi.exportCompliance()).catch(() => null);
          if (blob) downloadBlob(blob, `informe-compliance-${new Date().toISOString().slice(0, 10)}${blob.type.includes("pdf") ? ".pdf" : ".csv"}`);
          break;
        }
      }
    });
  },
};
