/**
 * CONSULTOR · HISTORIAL Y REGISTRO SILENCIOSO  (maqueta: UI_mock/profile_consultor/historial.jpeg)
 * Endpoints: GET /history/summary, GET /history?type=, POST /history/:id/revert
 */
import { consultorApi } from "../../api/endpoints.js";
import { html, raw, on, fmt } from "../../ui/dom.js";
import { kpiCard, chipGroup, bindChips, familyAvatar, autoAvatar, tag, tags, mountAsync, skeleton, emptyState, withLoading, openModal, toast } from "../../ui/components.js";

const STATUS_TAG = {
  silent: () => tag("Silencioso", "success", "tag--lg"),
  approved: () => tag("Aprobado", "info", "tag--lg"),
};

function historyRow(h) {
  const isAuto = h.kind === "silent";
  return html`
    <article class="list-row" data-id="${h.id}">
      ${raw(isAuto ? autoAvatar() : familyAvatar(h.family))}
      <div class="list-row__main">
        <span class="list-row__title">${h.title}</span>
        <span class="list-row__subtitle">${h.subtitle}</span>
        ${raw(isAuto ? tags(h.tags) : `<div class="tags">${STATUS_TAG.approved()}</div>`)}
      </div>
      <div class="list-row__actions">
        ${isAuto ? raw(STATUS_TAG.silent()) : ""}
        <button class="btn btn--outline" data-action="detail">Ver Detalle</button>
        <button class="btn btn--outline-accent" data-action="revert">Revertir / Ajustar Regla</button>
      </div>
    </article>`;
}

export default {
  title: "Historial",
  async render(el) {
    let type = "silent";
    let summary = null;
    let items = [];

    el.innerHTML = html`
      <h1>Historial y Registro Silencioso</h1>
      <section class="grid-kpis" data-slot="kpis"></section>
      <div class="section-header">
        <div data-slot="chips"></div>
        <div class="section-header__actions"><button class="btn btn--accent" data-action="batch">Aprobar Lote</button></div>
      </div>
      <section class="list" data-slot="list"></section>`;

    const chipsEl = el.querySelector('[data-slot="chips"]');
    const listEl = el.querySelector('[data-slot="list"]');
    const label = (txt, n) => (n == null ? txt : `${txt} (${n})`);

    const renderChips = () => {
      chipsEl.innerHTML = chipGroup({
        name: "type", active: type,
        items: [
          { id: "all", label: label("Todas", summary?.total) },
          { id: "silent", label: label("Automáticas Silenciosas", summary?.silent) },
          { id: "approved", label: label("Aprobadas por Asesor", summary?.approved) },
        ],
      });
      bindChips(chipsEl, "type", ([id]) => { type = id; loadList(); });
    };

    const loadList = () => mountAsync(listEl, () => consultorApi.history({ type }), (list) => {
      items = list;
      return list.length ? list.map(historyRow).join("") : emptyState("Sin acciones registradas");
    }, { skeleton: skeleton("row", 4) });

    renderChips();
    mountAsync(el.querySelector('[data-slot="kpis"]'), consultorApi.historySummary, (s) => {
      summary = s;
      renderChips();
      return [
        kpiCard({ icon: "thumbsUp", tone: "neutral", value: fmt.number(s.total), label: "Total acciones" }),
        kpiCard({ icon: "zap", tone: "accent", value: fmt.number(s.silent), label: "Automáticas silenciosas", dot: "success" }),
        kpiCard({ icon: "userCheck", tone: "info", value: fmt.number(s.approved), label: "Aprobadas por asesor", dot: "info" }),
      ].join("");
    }, { skeleton: skeleton("kpi", 3) });
    loadList();

    return on(el, "click", "[data-action]", async (e, btn) => {
      const id = btn.closest("[data-id]")?.dataset.id;
      const item = items.find((i) => i.id === id);
      switch (btn.dataset.action) {
        case "detail":
          // TODO: definir con backend si hay vista de detalle propia o modal.
          openModal({ title: item.title, bodyHtml: `<p>${item.subtitle}</p><p class="muted">${fmt.date(item.createdAt)}</p>`, confirmLabel: "Cerrar", cancelLabel: "Volver" });
          break;
        case "revert": {
          const ok = await openModal({ title: "Revertir acción", bodyHtml: "<p>Se revertirá la acción y podrás ajustar la regla que la originó.</p>", confirmLabel: "Revertir", tone: "primary" });
          if (ok) await withLoading(btn, () => consultorApi.revertHistory(id), { success: "Acción revertida" }).catch(() => {});
          break;
        }
        case "batch":
          toast("Pendiente de definir con backend qué aprueba el lote en el historial");
          break;
      }
    });
  },
};
