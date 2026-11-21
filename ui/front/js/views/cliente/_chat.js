/**
 * CHAT CLIENTE ↔ ASESOR (ventana flotante tipo "messenger")
 * ---------------------------------------------------------------------------
 * - Carga el historial (GET /client/chat/messages) y hace POLLING cada
 *   config.CHAT_POLL_MS pidiendo solo los mensajes posteriores al último id
 *   (?after=<id>). Solo pregunta con la ventana abierta y la pestaña visible.
 * - Envío optimista: el mensaje aparece al instante y se marca si falla.
 * - Si el backend ofrece WebSocket/SSE, sustituir startPolling() por la
 *   suscripción; el resto (render, envío) no cambia.
 *
 * Uso:
 *   const chat = mountChat(hostEl, { advisor });
 *   chat.open(); chat.send("texto", topicId); chat.destroy();
 */
import { config } from "../../config.js";
import { clienteApi } from "../../api/endpoints.js";
import { html, raw, fmt } from "../../ui/dom.js";
import { icon } from "../../ui/icons.js";
import { toast } from "../../ui/components.js";

export function mountChat(host, { advisor, startOpen = false } = {}) {
  const messages = new Map(); // id -> msg (evita duplicados entre polling y envío)
  let lastId = null;
  let timer = null;
  let state = startOpen ? "open" : "closed"; // open | minimized | closed

  const el = document.createElement("section");
  el.className = "chat";
  el.setAttribute("aria-label", "Chat con tu asesor");
  el.innerHTML = html`
    <header class="chat__head">
      <span class="chat__title">Chat con ${advisor?.name || "tu asesor"}</span>
      <button class="chat__icon-btn" data-chat="minimize" aria-label="Minimizar">${raw(icon("minus"))}</button>
      <button class="chat__icon-btn" data-chat="close" aria-label="Cerrar">${raw(icon("x"))}</button>
    </header>
    <div class="chat__body">
      <ol class="chat__list" aria-live="polite"></ol>
      <form class="chat__form">
        <label class="sr-only" for="chat-input">Escribe tu mensaje</label>
        <textarea id="chat-input" class="chat__input" rows="2" placeholder="Escribe tu mensaje..." maxlength="2000"></textarea>
        <button class="chat__send" type="submit" aria-label="Enviar">${raw(icon("send"))}</button>
      </form>
    </div>`;
  host.appendChild(el);

  const list = el.querySelector(".chat__list");
  const input = el.querySelector(".chat__input");

  function bubble(m) {
    const mine = m.author === "client";
    return html`
      <li class="chat__msg ${mine ? "chat__msg--me" : ""} ${m.failed ? "is-failed" : ""}" data-id="${m.id}">
        <span class="chat__author">${mine ? "Tú" : "Asesor"}</span>
        <p class="chat__bubble">${m.text}</p>
        <time class="chat__time" datetime="${m.createdAt}">${m.failed ? "No enviado" : fmt.relative(m.createdAt)}</time>
      </li>`;
  }
  function renderList() {
    const all = [...messages.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    list.innerHTML = all.length ? all.map(bubble).join("") : `<li class="chat__empty">Escribe a tu asesor cuando quieras.</li>`;
    list.scrollTop = list.scrollHeight;
  }
  function ingest(batch = []) {
    batch.forEach((m) => { messages.set(m.id, m); lastId = m.id; });
    if (batch.length) renderList();
  }

  async function poll() {
    if (state !== "open" || document.hidden) return;
    try { ingest(await clienteApi.messages({ after: lastId })); } catch { /* reintenta en el siguiente tick */ }
  }
  function startPolling() { stopPolling(); timer = setInterval(poll, config.CHAT_POLL_MS); }
  function stopPolling() { clearInterval(timer); timer = null; }

  function setState(next) {
    state = next;
    el.dataset.state = next;
    if (next === "open") { poll(); startPolling(); input.focus({ preventScroll: true }); }
    else stopPolling();
  }

  async function send(text, topicId) {
    const clean = (text || "").trim();
    if (!clean) return;
    const tempId = `tmp-${Date.now()}`;
    messages.set(tempId, { id: tempId, author: "client", text: clean, createdAt: new Date().toISOString() });
    renderList();
    try {
      const saved = await clienteApi.sendMessage({ text: clean, topicId });
      messages.delete(tempId);
      ingest([saved]);
    } catch (err) {
      messages.set(tempId, { ...messages.get(tempId), failed: true });
      renderList();
      toast(err.message || "No se pudo enviar el mensaje", "error");
    }
  }

  el.addEventListener("click", (e) => {
    const a = e.target.closest("[data-chat]")?.dataset.chat;
    if (a === "minimize") setState(state === "minimized" ? "open" : "minimized");
    if (a === "close") setState("closed");
    if (e.target.closest(".chat__head") && !a && state === "minimized") setState("open");
  });
  el.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = "";
    send(text);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); el.querySelector("form").requestSubmit(); }
  });

  // Carga inicial del historial
  clienteApi.messages().then(ingest).catch(() => { list.innerHTML = `<li class="chat__empty">No se pudo cargar la conversación.</li>`; });
  renderList();
  setState(state);

  return {
    open: () => setState("open"),
    send: async (text, topicId) => { setState("open"); await send(text, topicId); },
    destroy: () => { stopPolling(); el.remove(); },
  };
}
