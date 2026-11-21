/**
 * ADMIN · GOBERNANZA Y COMPLIANCE  (maqueta: UI_mock/profile_admin/compliance.jpeg, bloque superior)
 * Guardrails globales de IA. La lista viene del backend.
 * Endpoints: GET /admin/governance/guardrails, PATCH /admin/governance/guardrails/:id
 */
import { adminApi } from "../../api/endpoints.js";
import { getBrand } from "../../brand.js";
import { html, raw, on } from "../../ui/dom.js";
import { breadcrumb, toggle, mountAsync, skeleton, emptyState, toast } from "../../ui/components.js";

export default {
  title: "Gobernanza y Compliance",
  render(el) {
    const appName = getBrand().appName;
    el.innerHTML = html`
      ${raw(breadcrumb([{ label: `${appName} Admin`, href: "#/admin/resumen" }, { label: "Gobernanza y Compliance" }]))}
      <div class="page-header__text">
        <h1>Gobernanza y Compliance</h1>
        <p class="lead">Supervisa los estándares de cumplimiento que aplica la IA en todas las comunicaciones.</p>
      </div>
      <section class="card">
        <h3 style="margin-bottom:var(--sp-5);color:var(--c-text)">Guardrails Globales de IA y Cumplimiento</h3>
        <div class="guardrails" data-slot="list"></div>
      </section>
      <p class="muted">Integraciones y plan corporativo: <a href="#/admin/integraciones">Integraciones y Facturación</a>.</p>`;

    mountAsync(el.querySelector('[data-slot="list"]'), adminApi.guardrails, (list) =>
      list.length ? list.map((g) => html`
        <div class="setting">
          ${raw(toggle({ id: `g-${g.id}`, name: g.id, checked: g.enabled, label: g.label, disabled: g.readOnly || g.mutable === false || g.editable === false }))}
          <div class="setting__text"><span class="setting__label">${g.label}</span><span class="setting__hint">${g.hint}</span></div>
        </div>`).join("") : emptyState("Sin guardrails configurados"),
    { skeleton: skeleton("card", 1) });

    return on(el, "change", "input[role=switch]", async (e, input) => {
      input.disabled = true;
      try {
        await adminApi.setGuardrail(input.name, input.checked);
        toast(input.checked ? "Guardrail activado" : "Guardrail desactivado", "success");
      } catch (err) {
        input.checked = !input.checked;
        toast(err.message, "error");
      } finally {
        input.disabled = false;
      }
    });
  },
};
