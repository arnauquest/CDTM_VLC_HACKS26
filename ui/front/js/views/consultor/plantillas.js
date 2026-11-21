/**
 * CONSULTOR · PLANTILLAS
 * ⚠ No hay maqueta: vista provisional con el mismo lenguaje visual
 * (lista de filas). Endpoint: GET /templates
 */
import { consultorApi } from "../../api/endpoints.js";
import { html, raw, fmt } from "../../ui/dom.js";
import { icon } from "../../ui/icons.js";
import { tag, mountAsync, skeleton, emptyState } from "../../ui/components.js";

const CHANNEL = { email: { label: "Correo", icon: "mail" }, call: { label: "Llamada", icon: "phoneCall" } };

export default {
  title: "Plantillas",
  render(el) {
    el.innerHTML = html`
      <div class="page-header">
        <div class="page-header__text"><h1>Plantillas</h1><p class="lead muted">Mensajes y guiones base que la IA personaliza para cada familia.</p></div>
      </div>
      <section class="list" data-slot="list"></section>`;

    mountAsync(el.querySelector('[data-slot="list"]'), consultorApi.templates, (list) =>
      list.length
        ? list.map((t) => {
            const ch = CHANNEL[t.channel] || { label: t.channel, icon: "file" };
            return html`
              <article class="list-row">
                <span class="avatar avatar--sm">${raw(icon(ch.icon, { size: 20 }))}</span>
                <div class="list-row__main">
                  <span class="list-row__title">${t.name}</span>
                  <span class="muted">Actualizada ${fmt.date(t.updatedAt)} · usada ${fmt.number(t.usage)} veces</span>
                </div>
                <div class="list-row__actions">${raw(tag(ch.label))}<button class="btn btn--outline btn--sm" disabled title="Pendiente de definir">Editar</button></div>
              </article>`;
          }).join("")
        : emptyState("Aún no hay plantillas"),
    { skeleton: skeleton("row", 3) });
  },
};
