/**
 * CONSULTOR · FAMILIAS  (maqueta: UI_mock/profile_consultor/familias.jpeg)
 * KPIs + buscador + filtro por estado + grid de tarjetas de familia.
 * Endpoints: GET /families/summary, GET /families?q=&status=
 */
import { consultorApi } from "../../api/endpoints.js";
import { html, raw, fmt } from "../../ui/dom.js";
import { icon } from "../../ui/icons.js";
import { kpiCard, chipGroup, bindChips, familyAvatar, tag, mountAsync, skeleton, emptyState } from "../../ui/components.js";

function familyCard(f) {
  return html`
    <article class="card family-card">
      <div class="family-card__head">
        ${raw(familyAvatar(f, "lg"))}
        <div class="family-card__body">
          <div class="family-card__name"><h4>${f.name}</h4>${f.risk ? raw(tag(`Riesgo: ${f.risk}`, "", "tag--lg")) : ""}</div>
          ${f.riskProfile ? raw(html`<p>Perfil de Riesgo: ${f.riskProfile}</p>`) : ""}
          <p>${(f.facts || []).join(" | ")}</p>
          ${f.goal ? raw(html`<p class="family-card__goal">${f.goal}</p>`) : ""}
        </div>
      </div>
      <div class="family-card__actions">
        <a class="btn btn--accent" href="${f.planUrl || "#"}" data-family="${f.id}" data-action="plan">Abrir Plan Vivo</a>
        <a class="btn btn--outline" href="${f.psychProfileUrl || "#"}" data-family="${f.id}" data-action="psych">Ver Perfil Psicológico</a>
      </div>
    </article>`;
}

export default {
  title: "Familias",
  async render(el) {
    let status = "needs_approval";
    let q = "";
    let summary = null;

    el.innerHTML = html`
      <section class="grid-kpis" data-slot="kpis"></section>
      <div class="toolbar">
        <label class="search">
          <span class="sr-only">Buscar por nombre</span>
          <input class="input" type="search" placeholder="Buscar por nombre..." data-slot="search" />
          ${raw(icon("search"))}
        </label>
        <div data-slot="chips"></div>
      </div>
      <h2>Familias</h2>
      <section class="family-grid" data-slot="list"></section>`;

    const listEl = el.querySelector('[data-slot="list"]');
    const chipsEl = el.querySelector('[data-slot="chips"]');

    const renderChips = () => {
      chipsEl.innerHTML = chipGroup({
        name: "status", solid: true, active: status,
        items: [
          { id: "all", label: "Todas", count: summary?.total },
          { id: "needs_approval", label: "Requiere Aprobación", count: summary?.needsApproval },
          { id: "autopilot", label: "En Piloto Automático", count: summary?.autopilot },
        ],
      });
      bindChips(chipsEl, "status", ([id]) => { status = id; loadList(); });
    };

    const loadList = () => mountAsync(listEl, () => consultorApi.families({ q, status }),
      (list) => (list.length ? list.map(familyCard).join("") : emptyState("Sin resultados", q ? `Ninguna familia coincide con “${q}”.` : "")),
      { skeleton: skeleton("card", 4) });

    renderChips();
    mountAsync(el.querySelector('[data-slot="kpis"]'), consultorApi.familiesSummary, (s) => {
      summary = s;
      renderChips();
      return [
        kpiCard({ icon: "family", tone: "accent", value: fmt.number(s.total), label: "Familias totales", dot: "success" }),
        kpiCard({ icon: "bell", tone: "warning", value: fmt.number(s.needsApproval), label: "Requieren aprobación", dot: "warning" }),
        kpiCard({ icon: "autopilot", tone: "accent", value: fmt.number(s.autopilot), label: "Piloto automático", dot: "success" }),
      ].join("");
    }, { skeleton: skeleton("kpi", 3) });
    loadList();

    // Búsqueda con debounce
    let t;
    el.querySelector('[data-slot="search"]').addEventListener("input", (e) => {
      clearTimeout(t);
      t = setTimeout(() => { q = e.target.value.trim(); loadList(); }, 300);
    });
    return () => clearTimeout(t);
  },
};
