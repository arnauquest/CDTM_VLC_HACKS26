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
        ${a.channels?.email !== false ? raw(html`<button class="btn btn--accent" data-action="email">${raw(icon("mail"))}Correo 1-Clic</button>`) : ""}
        ${a.channels?.call !== false ? raw(html`<button class="btn btn--outline btn--stacked" data-action="call">${raw(icon("phoneCall"))}<span>Llamada Automatizada</span></button>`) : ""}
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

  el.innerHTML = html`
    <div data-slot="chips">${raw(skeleton("line", 1))}</div>
    <div class="section-header">
      <h2>${title}</h2>
      <div class="section-header__actions">
        <button class="btn btn--accent" data-action="batch">Aprobar Lote</button>
      </div>
    </div>
    <div class="list" data-slot="list"></div>`;

  const chipsEl = el.querySelector('[data-slot="chips"]');
  const listEl = el.querySelector('[data-slot="list"]');

  const loadList = () =>
    mountAsync(listEl, () => consultorApi.alerts({ categories: active, consultantId }), (list) => {
      current = list;
      return list.length ? list.map(alertRow).join("") : emptyState("No hay alertas pendientes", "Todo está bajo control.");
    }, { skeleton: skeleton("row", 4) });

  await mountAsync(chipsEl, () => consultorApi.alertCategories(), (cats) => {
    categories = cats;
    return chipGroup({ name: "categories", multi: true, active, items: categories.map((c) => ({ id: c.id, label: c.label })) });
  }, { skeleton: skeleton("line", 1), after: () => bindChips(chipsEl, "categories", (ids) => { active = ids; loadList(); }) });

  loadList();

  const off = on(el, "click", "[data-action]", async (e, btn) => {
    const row = btn.closest("[data-id]");
    const id = row?.dataset.id;
    switch (btn.dataset.action) {
      case "email":
        await withLoading(btn, () => consultorApi.approveEmail(id), { success: "Correo enviado" }).catch(() => {});
        row?.remove();
        break;
      case "call":
        await withLoading(btn, () => consultorApi.launchCall(id), { success: "Llamada programada" }).catch(() => {});
        break;
      case "batch": {
        if (!current.length) return toast("No hay alertas que aprobar");
        const ok = await openModal({
          title: "Aprobar lote",
          bodyHtml: `<p>Se aprobarán y enviarán <b>${current.length}</b> alertas visibles con sus borradores actuales.</p>`,
          confirmLabel: "Aprobar todas",
        });
        if (!ok) return;
        await withLoading(btn, () => consultorApi.approveBatch(current.map((a) => a.id)), { success: "Lote aprobado" }).catch(() => {});
        loadList();
        break;
      }
    }
  });

  return off;
}
