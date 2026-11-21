/**
 * CLIENTE · MI PLAN + CENTRO DE CONTACTO  (maqueta: UI_mock/profile_client/UI_cliente.jpeg)
 * ---------------------------------------------------------------------------
 * Columna izquierda  · "Mi Plan y Datos Financieros"
 *   - Tarjetas del plan (genéricas, las decide el backend) -> _plan-cards.js
 *   - "Añadir Información / Actualizar Datos": formulario con campos del backend
 * Columna derecha    · "Centro de Contacto con mi Asesor"
 *   - "Pedir información o consejos": asesor + atajos (abren el chat con la pregunta)
 *   - "Chat de Asesoría en Vivo": abre la ventana de chat -> _chat.js
 *   - "Solicitar llamada con <asesor>": lo antes posible o en un hueco concreto
 *
 * Los interruptores de cada sección las muestran/ocultan y se guardan como
 * preferencia del cliente (GET/PUT /client/preferences).
 *
 * Endpoints: GET /client/plan, GET /client/financial-updates/fields,
 *   POST /client/financial-updates, GET /client/advisor, GET /client/quick-topics,
 *   GET|POST /client/chat/messages, GET /client/call-slots, POST /client/call-requests,
 *   GET|PUT /client/preferences
 */
import { clienteApi } from "../../api/endpoints.js";
import { html, raw, on } from "../../ui/dom.js";
import { icon } from "../../ui/icons.js";
import { avatar, toggle, mountAsync, skeleton, emptyState, withLoading, toast } from "../../ui/components.js";
import { planCard } from "./_plan-cards.js";
import { mountChat } from "./_chat.js";
import { mountVoice } from "./_voice.js";

const firstName = (name = "") => name.split(" ")[0];

/** Cabecera de sección/tarjeta con interruptor de mostrar/ocultar. */
function sectionToggle(id, title, checked, tag = "h3") {
  return html`
    <div class="client-section__head">
      ${raw(`<${tag} class="client-section__title" id="sec-${id}">`)}${title}${raw(`</${tag}>`)}
      ${raw(toggle({ id: `toggle-${id}`, name: id, checked, label: `Mostrar ${title}` }))}
    </div>`;
}

function updateForm(fields) {
  if (!fields.length) return emptyState("No hay datos que actualizar ahora mismo");
  return html`
    <form class="card update-form" data-form="update">
      <h4 class="update-form__title">- Añadir info</h4>
      <div class="update-form__fields">
        ${fields.map((f) => html`
          <label class="field">
            <span class="sr-only">${f.label}</span>
            <input class="input" name="${f.id}" type="${f.type || "text"}" placeholder="${f.placeholder || f.label}" autocomplete="off" />
          </label>`)}
      </div>
      <button type="submit" class="btn btn--accent btn--wide">${raw(icon("plus"))}Guardar y Actualizar</button>
    </form>`;
}

function askInfoBody(advisor, topics) {
  return html`
    <div class="advisor">
      ${raw(avatar(advisor.name, advisor.avatarUrl))}
      <span>Asesor: <b>${advisor.name}</b></span>
    </div>
    <div class="quick-topics">
      ${topics.map((t) => html`
        <button class="btn btn--outline-accent quick-topic" data-topic="${t.id}" data-label="${t.label}">
          ${raw(icon(t.icon === "pencil" ? "pencil" : "help"))}<span>${t.label}</span>
        </button>`)}
    </div>`;
}

function callBody(slots) {
  return html`
    <p class="call-request__text">Elige una fecha de seguimiento en la demo. No representa disponibilidad humana confirmada.</p>
    <div class="call-request__grid">
      <label class="call-request__slot">
        <span class="call-request__cal" aria-hidden="true">${raw(icon("calendar"))}</span>
        <span class="sr-only">Horario preferido</span>
        <select class="select" name="slot" data-slot-select>
          ${slots.length
            ? slots.map((s) => raw(html`<option value="${s.id}">${s.label}</option>`))
            : raw(`<option value="">Sin huecos disponibles</option>`)}
        </select>
      </label>
      <button class="btn btn--outline-accent" data-action="call-asap">Solicitar llamada</button>
      <button class="btn btn--accent" data-action="call-slot" ${slots.length ? "" : "disabled"}>Programar seguimiento</button>
    </div>`;
}

export default {
  title: "Mi Plan",
  async render(el) {
    // Preferencias primero (deciden qué secciones están abiertas). Si fallan, todo abierto.
    let prefs = { sections: { updateData: true, askInfo: true, callRequest: true } };
    try { prefs = await clienteApi.preferences(); } catch { /* default */ }
    const isOn = (id) => prefs.sections?.[id] !== false;

    let advisor = { name: "tu asesor" };

    el.innerHTML = html`
      <div class="client-grid">
        <section class="client-col" aria-labelledby="h-plan">
          <h1 id="h-plan">Mi Plan y Datos Financieros</h1>
          <div class="plan-grid" data-slot="plan"></div>

          <div class="client-section" data-section="updateData">
            ${raw(sectionToggle("updateData", "Añadir Información / Actualizar Datos", isOn("updateData"), "h2"))}
            <div class="client-section__body" data-slot="update" ${isOn("updateData") ? "" : "hidden"}></div>
          </div>
        </section>

        <div class="client-divider" aria-hidden="true"></div>

        <section class="client-col" aria-labelledby="h-contact">
          <h1 id="h-contact">Centro de Contacto con mi Asesor</h1>

          <article class="card client-section" data-section="askInfo">
            ${raw(sectionToggle("askInfo", "Pedir información o consejos", isOn("askInfo")))}
            <div class="client-section__body" data-slot="ask" ${isOn("askInfo") ? "" : "hidden"}></div>
          </article>

          <article class="card live-chat">
            <div class="live-chat__text">
              <h3 class="client-section__title">Chat con el asistente virtual</h3>
              <button class="btn btn--accent" data-action="open-chat">Abrir chat</button>
            </div>
            <span class="live-chat__icon">${raw(icon("chat"))}</span>
          </article>

          <div data-slot="voice"></div>

          <article class="card client-section" data-section="callRequest">
            <div data-slot="call-head">${raw(sectionToggle("callRequest", "Solicitar llamada con tu asesor", isOn("callRequest")))}</div>
            <div class="client-section__body" data-slot="call" ${isOn("callRequest") ? "" : "hidden"}></div>
          </article>
        </section>
      </div>
      <div data-slot="chat-host"></div>`;

    // --- Columna izquierda
    mountAsync(el.querySelector('[data-slot="plan"]'), clienteApi.plan,
      (plan) => (plan.cards?.length ? plan.cards.map(planCard).join("") : emptyState("Tu plan se está preparando")),
      { skeleton: skeleton("card", 4) });
    mountAsync(el.querySelector('[data-slot="update"]'), clienteApi.updateFields, updateForm, { skeleton: skeleton("card", 1) });
    let disposed = false;
    // The worker applies submitted facts asynchronously; refresh effective cards
    // without replacing the form or interrupting a live conversation.
    const planTimer = setInterval(async () => {
      if (document.hidden || disposed) return;
      try {
        const plan = await clienteApi.plan();
        if (!disposed) el.querySelector('[data-slot="plan"]').innerHTML = plan.cards?.length ? plan.cards.map(planCard).join("") : emptyState("Tu plan se está preparando");
      } catch { /* Retain the last verified plan while a request is unavailable. */ }
    }, 5000);

    // --- Columna derecha
    const chatHost = el.querySelector('[data-slot="chat-host"]');
    let chat = null;
    const voicePanel = mountVoice(el.querySelector('[data-slot="voice"]'), { onUpdate: () => chat?.refresh() });

    mountAsync(el.querySelector('[data-slot="ask"]'), () => Promise.all([clienteApi.advisor(), clienteApi.quickTopics()]),
      ([adv, topics]) => {
        advisor = adv;
        // Ahora que conocemos al asesor, personalizamos títulos y el chat.
        el.querySelector("#sec-callRequest").textContent = `Solicitar llamada con ${firstName(adv.name)}`;
        chat = mountChat(chatHost, { advisor: adv, startOpen: false });
        return askInfoBody(adv, topics);
      }, { skeleton: skeleton("line", 3) });

    mountAsync(el.querySelector('[data-slot="call"]'), clienteApi.callSlots, callBody, { skeleton: skeleton("line", 2) });

    // --- Interacciones
    const offs = [
      on(el, "change", ".client-section__head input[role=switch]", async (e, input) => {
        const body = input.closest("[data-section]").querySelector(".client-section__body");
        body.hidden = !input.checked;
        prefs.sections = { ...prefs.sections, [input.name]: input.checked };
        try { await clienteApi.savePreferences(prefs); } catch { toast("No se pudo guardar la preferencia de vista", "error"); }
      }),

      on(el, "submit", '[data-form="update"]', async (e, form) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        if (!Object.values(data).some((v) => String(v).trim())) return toast("Rellena al menos un campo", "error");
        const ok = await withLoading(form.querySelector("[type=submit]"), () => clienteApi.submitUpdate(data),
          { success: "Información recibida para analizar; actualización pendiente" }).then(() => true).catch(() => false);
        if (ok) form.reset();
      }),

      on(el, "click", "[data-topic]", (e, btn) => {
        if (!chat) return;
        chat.send(btn.dataset.label, btn.dataset.topic);
      }),

      on(el, "click", "[data-action]", async (e, btn) => {
        switch (btn.dataset.action) {
          case "open-chat":
            chat ? chat.open() : toast("El chat aún se está cargando");
            break;
          case "call-asap":
            await withLoading(btn, () => clienteApi.requestCall({ asap: true }),
              { success: "Petición recibida. No hay una llamada humana confirmada." }).catch(() => {});
            break;
          case "call-slot": {
            const select = el.querySelector("[data-slot-select]");
            const label = select.selectedOptions[0]?.textContent;
            await withLoading(btn, () => clienteApi.requestCall({ slotId: select.value }),
              { success: `Seguimiento demo programado: ${label}` }).catch(() => {});
            break;
          }
        }
      }),
    ];

    return () => { disposed = true; clearInterval(planTimer); offs.forEach((off) => off()); chat?.destroy(); voicePanel.destroy(); };
  },
};
