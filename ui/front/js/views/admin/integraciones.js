/**
 * ADMIN · INTEGRACIONES Y FACTURACIÓN  (maqueta: UI_mock/profile_admin/compliance.jpeg, bloques inferiores)
 * Endpoints: GET /admin/integrations, POST /admin/integrations/:id/verify,
 *            GET /admin/billing, POST /admin/billing/seats, GET /admin/billing/invoices
 */
import { adminApi } from "../../api/endpoints.js";
import { getBrand } from "../../brand.js";
import { html, raw, on, fmt, downloadBlob } from "../../ui/dom.js";
import { breadcrumb, mountAsync, skeleton, emptyState, withLoading, openModal, toast } from "../../ui/components.js";

const STATUS_TONE = { connected: "success", verified: "success", active: "success", error: "danger", pending: "warning", disconnected: "danger" };

function integrationRow(i) {
  const tone = STATUS_TONE[i.status] || "";
  return html`
    <div class="integration-item" data-id="${i.id}">
      <span>${i.name}</span>
      <span class="tag tag--${tone} tag--lg" style="border:2px solid currentColor">${i.statusLabel || i.status}</span>
      <span>${i.canVerify ? raw(`<button class="btn btn--link" data-action="verify">Revisar configuración</button>`) : ""}</span>
      <span>${i.canConfigure ? raw(`<button class="btn btn--outline" data-action="configure">Configurar API</button>`) : ""}</span>
    </div>`;
}

function billingHtml(b) {
  if(b.configured === false)return html`<p>${b.message || "Prototipo local sin facturación ni cargos. Las claves se configuran en el servidor."}</p>`;
  const pct = b.seatsTotal ? Math.round((b.seatsUsed / b.seatsTotal) * 100) : 0;
  return html`
    <div class="billing">
      <div class="billing__usage">
        <div class="row"><span><b>${b.seatsUsed} de ${b.seatsTotal}</b> Asientos de Consultor usados</span><span class="spacer"></span><span class="tabular">${pct}%</span></div>
        <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div class="progress__bar" style="width:${pct}%"></div></div>
        <span>Próxima renovación: ${fmt.date(b.renewalDate)}</span>
      </div>
      <div class="billing__actions">
        <button class="btn btn--accent" data-action="seat">Añadir Asiento</button>
        <button class="btn btn--outline" data-action="invoices">Descargar Facturas</button>
      </div>
    </div>`;
}

export default {
  title: "Integraciones y Facturación",
  render(el) {
    const appName = getBrand().appName;
    el.innerHTML = html`
      ${raw(breadcrumb([{ label: `${appName} Admin`, href: "#/admin/resumen" }, { label: "Integraciones y Facturación" }]))}
      <div class="page-header__text">
        <h1>Integraciones y Facturación</h1>
        <p class="lead">Supervisa las conexiones técnicas y el consumo de tu plan corporativo.</p>
      </div>
      <section class="card">
        <h3 style="margin-bottom:var(--sp-4);color:var(--c-text)">Integraciones Centralizadas</h3>
        <div class="integration-list" data-slot="integrations"></div>
      </section>
      <section class="card">
        <h3 style="margin-bottom:var(--sp-4);color:var(--c-text)" data-slot="plan-title">Plan Corporativo</h3>
        <div data-slot="billing"></div>
      </section>`;

    const loadIntegrations = () => mountAsync(el.querySelector('[data-slot="integrations"]'), adminApi.integrations,
      (list) => (list.length ? list.map(integrationRow).join("") : emptyState("Sin integraciones")), { skeleton: skeleton("line", 3) });
    const loadBilling = () => mountAsync(el.querySelector('[data-slot="billing"]'), adminApi.billing, (b) => {
      if (b.planName) el.querySelector('[data-slot="plan-title"]').textContent = b.planName;
      return billingHtml(b);
    }, { skeleton: skeleton("line", 3) });
    loadIntegrations();
    loadBilling();

    return on(el, "click", "[data-action]", async (e, btn) => {
      const id = btn.closest("[data-id]")?.dataset.id;
      switch (btn.dataset.action) {
        case "verify":
          await withLoading(btn, () => adminApi.verifyIntegration(id), { success: "Configuración revisada" }).catch(() => {});
          loadIntegrations();
          break;
        case "configure":
          toast("La configuración de APIs se definirá con backend");
          break;
        case "seat":
          if (await openModal({ title: "Añadir asiento", bodyHtml: "<p>Se añadirá un asiento de consultor a tu plan. Se reflejará en la próxima factura.</p>", confirmLabel: "Añadir" })) {
            await withLoading(btn, () => adminApi.addSeat(), { success: "Asiento añadido" }).catch(() => {});
            loadBilling();
          }
          break;
        case "invoices": {
          const blob = await withLoading(btn, () => adminApi.downloadInvoices()).catch(() => null);
          if (blob) downloadBlob(blob, `facturas${blob.type.includes("pdf") ? ".pdf" : blob.type.includes("zip") ? ".zip" : ".txt"}`);
          break;
        }
      }
    });
  },
};
