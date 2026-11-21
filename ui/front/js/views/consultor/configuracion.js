/**
 * CONSULTOR · CONFIGURACIÓN > REGLAS DE AUTONOMÍA  (maqueta: UI_mock/profile_consultor/configuracion.jpeg)
 * Las secciones y reglas vienen del backend (no están hardcodeadas): así se
 * pueden añadir reglas nuevas sin tocar el front.
 * Endpoints: GET/PUT /consultant/settings/autonomy
 */
import { consultorApi } from "../../api/endpoints.js";
import { html, raw, on } from "../../ui/dom.js";
import { getBrand } from "../../brand.js";
import { breadcrumb, toggle, tag, mountAsync, skeleton, withLoading } from "../../ui/components.js";

const stateTag = (on) => (on ? tag("ON / Activado", "solid-accent") : tag("OFF / Desactivado", "", "tag--lg"));

const INTEGRATION_STATUS = {
  connected: { word: "Activa", tag: "Conectado", tone: "success" },
  error: { word: "Error", tag: "Desconectado", tone: "danger" },
  pending: { word: "Pendiente", tag: "Pendiente", tone: "warning" },
};

function render(s) {
  const integ = s.integration;
  const st = INTEGRATION_STATUS[integ?.status] || INTEGRATION_STATUS.pending;
  return html`
    ${s.sections.map((sec) => html`
      <section class="card settings-card">
        <h3>${sec.title}</h3>
        ${sec.rules.map((r) => html`
          <div class="setting">
            ${raw(toggle({ id: `rule-${r.id}`, name: r.id, checked: r.enabled, label: r.label }))}
            <div class="setting__text">
              <span class="setting__label">${r.label} ${r.example ? raw(html`<span class="muted" style="font-size:var(--fs-md)">${r.example}</span>`) : ""}</span>
              ${r.hint ? raw(html`<span class="setting__hint">${r.hint}</span>`) : ""}
            </div>
            <span class="setting__state" data-state-for="${r.id}">${raw(stateTag(r.enabled))}</span>
          </div>`)}
      </section>`)}
    ${integ ? raw(html`
      <section class="card settings-card">
        <h3>Estado de Integración</h3>
        <div class="integration-status">
          <div class="integration-status__text">
            <span>${integ.name}: <span class="text-accent">${st.word}</span> ${raw(html`<span class="tag tag--${st.tone} tag--lg"><span class="dot dot--sm dot--success"></span>${st.tag}</span>`)}</span>
            <span>${integ.description}</span>
          </div>
          <button class="btn btn--accent" data-action="save">Guardar Reglas de Autonomía</button>
        </div>
      </section>`) : raw(`<div><button class="btn btn--accent" data-action="save">Guardar Reglas de Autonomía</button></div>`)}`;
}

export default {
  title: "Configuración",
  render(el) {
    let settings = null;
    el.innerHTML = html`
      ${raw(breadcrumb([{ label: "Configuración", href: "#/configuracion" }, { label: "Reglas de Autonomía" }]))}
      <div class="page-header__text">
        <h1>Reglas de Autonomía y Silencio Inteligente</h1>
        <p class="lead" data-slot="lead">Define qué acciones ejecuta ${getBrand().appName} en segundo plano y cuáles requieren tu validación directa.</p>
      </div>
      <div class="stack" data-slot="body"></div>`;

    mountAsync(el.querySelector('[data-slot="body"]'), consultorApi.autonomy, (s) => { settings = s; return render(s); },
      { skeleton: skeleton("card", 3) });

    const offChange = on(el, "change", "input[role=switch]", (e, input) => {
      el.querySelector(`[data-state-for="${input.name}"]`).innerHTML = stateTag(input.checked);
      settings.sections.forEach((sec) => sec.rules.forEach((r) => { if (r.id === input.name) r.enabled = input.checked; }));
    });
    const offClick = on(el, "click", '[data-action="save"]', (e, btn) =>
      withLoading(btn, () => consultorApi.saveAutonomy(settings), { success: "Reglas guardadas" }).catch(() => {}));
    return () => { offChange(); offClick(); };
  },
};
