import { voiceApi, microphoneRecording } from '../../api/voice.js';
import { html, raw } from '../../ui/dom.js';

export function mountVoice(host, { onUpdate = () => {} } = {}) {
  let conversation = null; let recording = null; let busy = false; let disposed = false; let refreshing = false; let audioUrl;
  host.innerHTML = html`<article class="card client-section">
    <h3 class="client-section__title">Conversar con el asistente virtual</h3>
    <p class="call-request__text">Llamada en este navegador. Tu voz se transcribe y conserva para analizar la conversación; no conecta con un teléfono humano.</p>
    <label class="field"><span>Conversación preparada</span><select class="select" data-voice-packages><option value="">Buscando comunicaciones autorizadas…</option></select></label>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">
      <button class="btn btn--accent" data-voice="start">Iniciar conversación</button>
      <button class="btn btn--outline-accent" data-voice="record" disabled>Hablar</button>
      <button class="btn btn--outline-accent" data-voice="finish" disabled>Terminar</button>
    </div>
    <p data-voice-status role="status">Solo se muestran paquetes autorizados para tu familia.</p>
    <audio data-voice-audio controls style="width:100%" hidden></audio>
    <div data-voice-transcript style="max-height:220px;overflow:auto;margin:12px 0" aria-live="polite"></div>
    <form data-voice-form style="display:flex;gap:8px"><input class="input" name="text" aria-label="Respuesta escrita al asistente" placeholder="También puedes responder por escrito" maxlength="6000" disabled><button class="btn btn--accent" disabled>Enviar</button></form>
  </article>`;
  const select = host.querySelector('[data-voice-packages]');
  const status = host.querySelector('[data-voice-status]'); const player = host.querySelector('audio');
  const transcript = host.querySelector('[data-voice-transcript]'); const form = host.querySelector('form');
  const startButton = host.querySelector('[data-voice=start]'); const recordButton = host.querySelector('[data-voice=record]');
  const finishButton = host.querySelector('[data-voice=finish]');
  const say = value => { if (!disposed) status.textContent = value; };
  function controls() {
    const active = conversation?.state === 'active';
    startButton.disabled = busy || active || !select.value; select.disabled = busy || active;
    recordButton.disabled = busy || !active; recordButton.textContent = recording ? 'Terminar grabación' : 'Hablar';
    finishButton.disabled = busy || !active || Boolean(recording);
    form.querySelectorAll('input,button').forEach(element => { element.disabled = busy || !active || Boolean(recording); });
  }
  function show(value) {
    conversation = value;
    if(value?.state==='active')select.innerHTML=html`<option value="${value.communication_id}">Conversación actual · asistente virtual</option>`;
    transcript.innerHTML = (value?.turns || []).map(turn => html`<p><b>${turn.role === 'user' ? 'Tú' : 'Asistente virtual'}:</b> ${turn.text}</p>`).join('');
    transcript.scrollTop = transcript.scrollHeight; controls(); onUpdate();
  }
  async function play(audio, autoplay = true) {
    if (!audio?.audio_id || disposed) return;
    const blob = await voiceApi.audio(audio.audio_id); if (disposed) return;
    player.pause(); if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = URL.createObjectURL(blob);
    player.src = audioUrl; player.hidden = false;
    try { if(autoplay)await player.play(); } catch { say('Respuesta lista. Pulsa reproducir para escucharla.'); }
  }
  async function refresh() {
    if (disposed || busy || recording || refreshing || document.hidden) return;
    refreshing = true;
    try {
      if (conversation?.state === 'active') {
        const latest = await voiceApi.conversation(conversation.id);
        if (disposed || busy || recording) return;
        if (latest.version !== conversation.version || latest.state !== conversation.state || latest.turns.length !== conversation.turns.length) show(latest);
        if (latest.state === 'active') return;
        player.pause(); say('Conversación finalizada. El análisis y los seguimientos se procesarán ahora.');
      }
      const [communications, conversations] = await Promise.all([voiceApi.communications(), voiceApi.conversations()]);
      if (disposed || busy || recording) return;
      const active = conversations.findLast(item => item.state === 'active');
      if (active) { const resumed=conversation?.id!==active.id;show(active);say('Conversación abierta. Puedes continuar por voz o texto.');if(resumed)await play(active.turns.at(-1)?.audio,false);return; }
      const packages = communications.filter(item => item.state === 'delivered'); const selected = select.value;
      select.innerHTML = packages.length ? packages.map(item => html`<option value="${item.id}">${item.contact?.purpose || item.draft?.conversation_objectives?.[0] || 'Conversación preparada'}</option>`).join('') : '<option value="">No hay conversaciones autorizadas pendientes</option>';
      if (packages.some(item => item.id === selected)) select.value = selected;
      controls();
    } catch (error) { say(error.message); }
    finally { refreshing = false; }
  }
  async function send(input) {
    if (!conversation || busy || disposed) return;
    busy = true; controls(); say(input.audio_base64 ? 'Transcribiendo y preparando respuesta…' : 'Preparando respuesta…');
    try {
      const result = await voiceApi.turn(conversation.id, input); if (disposed) return;
      show(result.conversation); say(result.audio_error ? 'Respuesta recibida; audio no disponible. Puedes seguir por texto.' : 'Puedes responder cuando termine el audio.');
      await play(result.reply.audio);
    } catch (error) { say(error.message || 'No se pudo completar el turno.'); }
    finally { busy = false; if (!disposed) controls(); }
  }
  const click = async event => {
    const action = event.target.closest('[data-voice]')?.dataset.voice; if (!action || busy) return;
    if (action === 'record') {
      if (recording) { recording.stop(); return; }
      player.pause(); busy = true; controls(); say('Solicitando acceso al micrófono…');
      try {
        recording = await microphoneRecording(); if (disposed) { recording.cancel(); return; }
        busy = false; controls(); say('Grabando. Pulsa «Terminar grabación» al acabar (máximo un minuto).');
        const captured = await recording.result; recording = null; controls(); if (captured) await send(captured);
      } catch (error) { recording?.cancel(); recording = null; busy = false; say(error.message || 'No se pudo abrir el micrófono.'); controls(); }
      return;
    }
    busy = true; controls();
    try {
      if (action === 'start') {
        say('Abriendo la conversación autorizada…'); const result = await voiceApi.start(select.value); if (disposed) return;
        show(result); say(result.audio_error ? 'Conversación abierta. El audio no está disponible; usa texto.' : 'Conversación abierta con el asistente virtual.');
        await play(result.turns.at(-1)?.audio);
      } else if (action === 'finish') {
        player.pause(); const result = await voiceApi.finish(conversation.id); if (disposed) return;
        show(result); say('Conversación terminada. El análisis y los seguimientos se procesarán ahora.');
      }
    } catch (error) { say(error.message); }
    finally { busy = false; if (!disposed) { controls(); refresh(); } }
  };
  const submit = event => { event.preventDefault(); const input = form.elements.text; const text = input.value.trim(); if (text) { input.value = ''; send({ text }); } };
  host.addEventListener('click', click); form.addEventListener('submit', submit); select.addEventListener('change', controls);
  const timer = setInterval(refresh, 5000); refresh();
  window.addEventListener('client:conversation-updated', refresh);
  return { refresh, destroy() { disposed = true; clearInterval(timer); window.removeEventListener('client:conversation-updated', refresh); recording?.cancel(); player.pause(); if (audioUrl) URL.revokeObjectURL(audioUrl); host.removeEventListener('click', click); form.removeEventListener('submit', submit); } };
}
