/**
 * CONSULTOR · DETALLE DE ALERTA  (maqueta: UI_mock/profile_consultor/alertas.jpeg)
 * "Estudio de Aprobación de Doble Canal": correo 1-clic + llamada IA con voz clonada.
 * Endpoints: GET /alerts/:id, PUT /alerts/:id/draft, POST /alerts/:id/email/approve,
 *            POST /alerts/:id/call/launch, POST /alerts/:id/snooze
 */
import { consultorApi } from "../../api/endpoints.js";
import { html, raw, on, sanitizeHtml, fmt } from "../../ui/dom.js";
import { icon } from "../../ui/icons.js";
import { tag, skeleton, errorState, withLoading, openModal, toast } from "../../ui/components.js";

function stepper(touchpoints = []) {
  const done = touchpoints.filter((t) => t.status !== "pending");
  const pending = touchpoints.filter((t) => t.status === "pending");
  const sub = { sent: "(Completado)", current: "(Actual)", pending: "(Pendiente)" };
  const step = (t, i, arr) => html`
    <div class="step step--${t.status}">
      <span class="step__icon">${t.status === "sent" ? raw(icon("check")) : ""}</span>
      <span>Paso ${t.step}: ${t.label}<span class="step__sub">${sub[t.status] || ""}</span></span>
    </div>
    ${i < arr.length - 1 ? raw(`<span class="step__arrow">${icon("arrowLong")}</span>`) : ""}`;
  return html`
    <div class="stepper" role="group" aria-label="Secuencia de toques">
      <div class="stepper__done">${done.map(step)}</div>
      ${pending.length ? raw(`<span class="step__arrow" style="color:var(--c-text-subtle)">${icon("arrowLong")}</span>`) : ""}
      ${pending.map(step)}
    </div>`;
}

/** Barras pseudo-aleatorias deterministas (mismo id -> misma onda). */
function waveBars(seed = "x", n = 64) {
  let h = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return Array.from({ length: n }, () => {
    h = (h * 1103515245 + 12345) >>> 0;
    const v = 15 + (h % 85);
    return `<span style="height:${v}%"></span>`;
  }).join("");
}

function emailCard(d) {
  const e = d.email || {};
  return html`
    <section class="card channel" aria-labelledby="ch1">
      <div class="channel__head">
        <h3 id="ch1">Canal 1: Mensaje Personalizado</h3>${raw(icon("mail"))}
      </div>
      <div class="channel__meta">Borrador generado por IA ${e.tone ? raw(tag(`Tono: ${e.tone}`, "success")) : ""}</div>
      <div class="email-envelope">
        <div class="email-envelope__row"><span class="email-envelope__key">Para:</span><span class="email-envelope__val">${e.to}</span>
          ${e.dataVerified ? raw(tag("Paquete aprobado ✓", "success")) : ""}</div>
        <div class="email-envelope__row"><span class="email-envelope__key">Asunto:</span><span class="email-envelope__val" data-edit="subject">${e.subject}</span></div>
      </div>
      <div class="email-body" data-edit="body">${raw(sanitizeHtml(e.bodyHtml))}</div>
      <div class="channel__footer">
        <button class="btn btn--accent btn--block" data-action="approve-email" ${!["prepared","awaiting_review"].includes(d.state) ? "disabled" : ""}><span>Aprobar mensaje</span>${raw(icon("send"))}</button>
      </div>
    </section>`;
}

function callCard(d) {
  const c = d.call || {};
  return html`
    <section class="card channel" aria-labelledby="ch2">
      <div class="channel__head">
        <h3 id="ch2">Canal 2: Conversación con asistente virtual</h3>${raw(icon("audio"))}
      </div>
      <div class="player" data-player>
        <div class="player__label">
          <button class="player__play" data-action="play" aria-label="Reproducir" ${c.audioUrl ? "" : "disabled title='Audio aún no generado'"}>${raw(icon("play"))}</button>
          <div>Play</div>
        </div>
        <div class="player__wave" aria-hidden="true">${raw(waveBars(d.id))}</div>
        <span class="player__time tabular" data-time>0:00 / ${fmt.duration(c.durationSec)}</span>
        <span class="player__caption">${c.voiceLabel || "Voz de ElevenLabs · asistente virtual"}</span>
        ${c.audioUrl ? raw(html`<audio preload="none" src="${c.audioUrl}"></audio>`) : ""}
      </div>
      <div class="textbox" data-edit="script">[Guion de voz]
${c.script}</div>
      <div class="channel__footer">
        <button class="btn btn--primary btn--block" data-action="launch-call" ${c.enabled === false ? "disabled" : ""}><span>Preparar llamada en navegador</span>${raw(icon("phoneCall"))}</button>
      </div>
    </section>`;
}

function bindPlayer(el) {
  const audio = el.querySelector("audio");
  const btn = el.querySelector('[data-action="play"]');
  if (!audio || !btn) return () => {};
  let disposed=false,objectUrl=null;const original=audio.getAttribute("src");audio.removeAttribute("src");
  if(original)consultorApi.audio(original).then(blob=>{if(disposed)return;objectUrl=URL.createObjectURL(blob);audio.src=objectUrl;}).catch(()=>{btn.disabled=true;});
  const bars = [...el.querySelectorAll(".player__wave span")];
  const time = el.querySelector("[data-time]");
  const update = () => {
    const ratio = audio.duration ? audio.currentTime / audio.duration : 0;
    bars.forEach((b, i) => b.classList.toggle("is-played", i / bars.length < ratio));
    time.textContent = `${fmt.duration(audio.currentTime)} / ${fmt.duration(audio.duration || 0)}`;
  };
  const toggle = () => (audio.paused ? audio.play() : audio.pause());
  const setIcon = () => { btn.innerHTML = icon(audio.paused ? "play" : "pause"); };
  btn.addEventListener("click", toggle);
  audio.addEventListener("timeupdate", update);
  audio.addEventListener("play", setIcon);
  audio.addEventListener("pause", setIcon);
  return () => {disposed=true;audio.pause();if(objectUrl)URL.revokeObjectURL(objectUrl);};
}

export default {
  title: "Detalle de alerta",
  async render(el, { params, navigate }) {
    el.innerHTML = skeleton("line", 1) + skeleton("kpi", 1) + `<div class="grid-2">${skeleton("card", 2)}</div>`;
    let d;
    try {
      d = await consultorApi.alert(params.id);
    } catch (err) {
      el.innerHTML = errorState(err);
      el.querySelector('[data-action="retry"]')?.addEventListener("click", () => this.render(el, { params, navigate }));
      return;
    }

    el.innerHTML = html`
      <div class="detail-topbar">
        <a class="btn btn--ghost" href="#/alertas">${raw(icon("arrowLeft"))}Volver a Alertas</a>
        <span class="spacer"></span>
        <button class="btn btn--ghost" data-action="edit">${raw(icon("pencil"))}<span>Editar Guion/Texto</span></button>
        <button class="btn btn--ghost" data-action="suggest">Sugerir cambios a la IA</button><button class="btn btn--ghost" data-action="reject">Rechazar</button><button class="btn btn--ghost" data-action="snooze">${raw(icon("clock"))}Posponer</button>
      </div>
      <header class="detail-head">
        <h1>Cliente: ${d.family?.name}</h1>
        <div class="tags">${(d.facts || []).map((f) => raw(tag(f, "outline", "tag--lg")))}</div>
      </header>
      ${raw(stepper(d.touchpoints))}
      <h2 class="detail-title">Estudio de Aprobación de Doble Canal</h2>
      <p class="muted">Estado: ${d.state || "borrador"}. Entrega local; no se envían correos externos ni se marca un teléfono.</p>
      <div class="grid-2">${raw(emailCard(d))}${raw(callCard(d))}</div>
      <section class="card"><h3>Por qué y cómo se ha preparado</h3><p>${d.decision?.reason || ""}</p><details><summary>Objetivos, preguntas previstas y límites</summary><pre style="white-space:pre-wrap;font-size:12px">${JSON.stringify(d.preparation || {},null,2)}</pre></details><a class="btn btn--outline" target="_blank" rel="noopener" href="/ops?family=${encodeURIComponent(d.family?.id || "")}">Ver decisiones del backend</a> <a class="btn btn--accent" target="_blank" rel="noopener" href="/app/?role=cliente&family=${encodeURIComponent(d.family?.id || "")}#/mi-plan">Abrir experiencia del cliente</a></section>`;

    const stopPlayer = bindPlayer(el.querySelector("[data-player]"));
    let editing = false;

    const off = on(el, "click", "[data-action]", async (e, btn) => {
      switch (btn.dataset.action) {
        case "reject":
          try{await withLoading(btn,()=>consultorApi.reject(d.id,"Rechazado por el asesor"),{success:"Borrador rechazado"});navigate("/alertas");}catch{};break;
        case "suggest": {
          const fd=await openModal({title:"Sugerir cambios a la IA",bodyHtml:'<label class="field"><span class="field__label">Qué debe cambiar</span><textarea class="input" name="instruction" required></textarea></label>',confirmLabel:"Preparar nueva versión"});
          if(fd)try{await withLoading(btn,()=>consultorApi.revise(d.id,fd.get("instruction")),{success:"Nueva preparación en curso"});navigate("/alertas");}catch{};break;
        }
        case "edit": {
          const fields = el.querySelectorAll("[data-edit]");
          if (!editing) {
            editing = true;
            fields.forEach((f) => f.setAttribute("contenteditable", "true"));
            btn.querySelector("span").textContent = "Guardar cambios";
            fields[0]?.focus();
          } else {
            const get = (k) => el.querySelector(`[data-edit="${k}"]`);
            const draft = {
              email: { subject: get("subject").textContent.trim(), bodyHtml: sanitizeHtml(get("body").innerHTML) },
              call: { script: get("script").textContent.replace(/^\[Guion de voz\]\s*/, "").trim() },
            };
            try { d=await withLoading(btn, () => consultorApi.updateDraft(d.id, draft), { success: "Borrador guardado" }); } catch { break; }
            editing = false;
            fields.forEach((f) => f.removeAttribute("contenteditable"));
            btn.querySelector("span").textContent = "Editar Guion/Texto";
          }
          break;
        }
        case "snooze": {
          const fd = await openModal({
            title: "Posponer alerta",
            bodyHtml: `<label class="field"><span class="field__label">Recordármelo el</span><input class="input" type="datetime-local" name="until" required /></label>`,
            confirmLabel: "Posponer",
          });
          if (!fd) return;
          await withLoading(btn, () => consultorApi.snooze(d.id, new Date(fd.get("until")).toISOString()), { success: "Alerta pospuesta" }).catch(() => {});
          navigate("/alertas");
          break;
        }
        case "approve-email":
          if (editing) return toast("Guarda los cambios antes de aprobar", "error");
          await withLoading(btn, () => consultorApi.approveEmail(d.id), { success: "Mensaje disponible en la bandeja del cliente" }).catch(() => {});
          break;
        case "launch-call":
          if (editing) return toast("Guarda los cambios antes de lanzar la llamada", "error");
          try{await withLoading(btn, () => consultorApi.launchCall(d.id), { success: "Conversación de navegador preparada" });stopPlayer();off();await this.render(el,{params,navigate});}catch{};
          break;
      }
    });

    return () => { off(); stopPlayer(); };
  },
};
