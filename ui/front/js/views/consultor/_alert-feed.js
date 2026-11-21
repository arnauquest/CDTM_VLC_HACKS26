/**
 * Feed de alertas reutilizado por Inicio y Alertas.
 * Pinta chips de categoría + lista + "Aprobar Lote" y gestiona sus acciones.
 */
import { consultorApi } from "../../api/endpoints.js";
import { html, raw, on } from "../../ui/dom.js";
import { icon } from "../../ui/icons.js";
import { chipGroup, bindChips, familyAvatar, tags, mountAsync, skeleton, emptyState, withLoading, openModal, toast } from "../../ui/components.js";

export function alertRow(a) {
  return html`
    <article class="list-row alert-row" data-id="${a.id}">
      ${raw(familyAvatar(a.family))}
      <div class="list-row__main">
        <span class="list-row__title">${a.family?.name}</span>
        <span class="list-row__subtitle">${a.title}</span>
        ${raw(tags(a.tags))}
      </div>
      <div class="list-row__actions">
        ${a.channels?.email !== false ? raw(html`<button class="btn btn--accent" data-action="email">${raw(icon("mail"))}Mensaje 1-Clic</button>`) : ""}
        ${a.channels?.call !== false ? raw(html`<button class="btn btn--outline btn--stacked" data-action="call">${raw(icon("phoneCall"))}<span>Llamada en navegador</span></button>`) : ""}
        <a class="btn btn--outline" href="#/alertas/${encodeURIComponent(a.id)}">Revisar</a>
      </div>
    </article>`;
}

/**
 * @param {HTMLElement} el contenedor
 * @param {{ title: string, navigate: Function, consultantId?: string }} opts  consultantId: solo admin (supervisión)
 */
export async function mountAlertFeed(el, { title, navigate, consultantId }) {
  let categories = [];
  let active = [];
  let current = [];
  let status="pending", disposed=false, signature="";

  el.innerHTML = html`
    <div data-slot="chips">${raw(skeleton("line", 1))}</div>
    <div class="section-header">
      <h2>${title}</h2>
      <div class="section-header__actions">
        <select class="select" data-status aria-label="Estado de las comunicaciones"><option value="pending">Pendientes de aprobación</option><option value="all">Todas, incluidas automáticas</option></select><button class="btn btn--accent" data-action="batch">Aprobar Lote</button>
      </div>
    </div>
    <div class="list" data-slot="list"></div>`;

  const chipsEl = el.querySelector('[data-slot="chips"]');
  const listEl = el.querySelector('[data-slot="list"]');

  const loadList = () =>
    mountAsync(listEl, () => consultorApi.alerts({ categories: active, consultantId, status }), (list) => {
      current = list;signature=JSON.stringify(list);
      return list.length ? list.map(alertRow).join("") : emptyState("No hay alertas pendientes", "Todo está bajo control.");
    }, { skeleton: skeleton("row", 4) });

  await mountAsync(chipsEl, () => consultorApi.alertCategories(), (cats) => {
    categories = cats;
    return chipGroup({ name: "categories", multi: true, active, items: categories.map((c) => ({ id: c.id, label: c.label })) });
  }, { skeleton: skeleton("line", 1), after: () => bindChips(chipsEl, "categories", (ids) => { active = ids; loadList(); }) });

  loadList();
  const selector=el.querySelector('[data-status]');selector.onchange=()=>{status=selector.value;loadList();};
  const timer=setInterval(async()=>{if(disposed||document.hidden)return;try{const list=await consultorApi.alerts({categories:active,consultantId,status});if(disposed)return;const next=JSON.stringify(list);if(next!==signature){signature=next;current=list;listEl.innerHTML=list.length?list.map(alertRow).join(""):emptyState("No hay comunicaciones en este filtro");}}catch{}},4000);

  const off = on(el, "click", "[data-action]", async (e, btn) => {
    const row = btn.closest("[data-id]");
    const id = row?.dataset.id;
    switch (btn.dataset.action) {
      case "email":
        try{await withLoading(btn, () => consultorApi.approveEmail(id), { success: "Mensaje disponible en la bandeja del cliente" });loadList();}catch{};
        break;
      case "call":
        try{await withLoading(btn, () => consultorApi.launchCall(id), { success: "Conversación de navegador preparada" });navigate(`/alertas/${id}`);}catch{};
        break;
      case "batch": {
        const eligible=current.filter(a=>a.canBatchApprove!==false);
        if (!eligible.length) return toast("No hay borradores de bajo riesgo para aprobar en lote");
        const ok = await openModal({
          title: "Aprobar lote",
          bodyHtml: `<p>Se aprobarán y enviarán <b>${eligible.length}</b> alertas de bajo riesgo visibles con sus borradores actuales.</p>`,
          confirmLabel: "Aprobar todas",
        });
        if (!ok) return;
        await withLoading(btn, () => consultorApi.approveBatch(eligible.map((a) => a.id)), { success: "Lote aprobado" }).catch(() => {});
        loadList();
        break;
      }
    }
  });

  return ()=>{disposed=true;clearInterval(timer);off();};
}
