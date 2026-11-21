const fail = (message, status = 422) => Object.assign(new Error(message), { status });
const text = (value, max = 3000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const activeStates = new Set(['delivered', 'completed']);
const sections = ['updateData', 'askInfo', 'callRequest'];
const fields = [
  { id: 'income', label: 'Ingresos: importe anual USD, persona y fecha', type: 'text' },
  { id: 'properties', label: 'Propiedades: cambio, valor USD y fecha', type: 'text' },
  { id: 'debts', label: 'Deudas: saldo USD, interés y fecha', type: 'text' },
  { id: 'other', label: 'Otra información o petición', type: 'text' },
];
const pick = (value, keys) => Object.fromEntries(keys.filter(k => value?.[k] !== undefined).map(k => [k, value[k]]));
const message = (turn, conversation, index) => ({
  id: index === 0 && turn.role === 'assistant' ? `opening:${conversation.communication_id}` : turn.id,
  author: turn.role === 'user' ? 'client' : 'assistant', text: turn.text,
  createdAt: turn.created_at || conversation.started_at, conversationId: conversation.id,
  audioId: turn.audio?.audio_id || null, status: 'received',
});
function messagesFor(store, familyId) {
  const conversations = store.list('conversations', { family_id: familyId });
  const rows = [...store.list('client_messages', { family_id: familyId }).map(row => pick(row, ['id', 'author', 'text', 'createdAt', 'event_id', 'status']))];
  for (const conversation of conversations) (conversation.turns || []).forEach((turn, index) => rows.push(message(turn, conversation, index)));
  for (const communication of store.list('communications', { family_id: familyId })) {
    if (activeStates.has(communication.state) && !conversations.some(c => c.communication_id === communication.id)) {
      rows.push({ id: `opening:${communication.id}`, author: 'assistant', text: communication.contact?.channel === 'text' ? communication.draft.text : communication.draft.voice_script || communication.draft.text,
        createdAt: communication.delivered_at || communication.created_at, communicationId: communication.id, status: 'delivered' });
    }
  }
  // Stable sort preserves the original turn order when the demo clock is frozen.
  return rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}
function planFor(family, store) {
  const facts = family.facts; const year = new Date(store.now()).getUTCFullYear();
  const sum = (rows, key) => (rows || []).reduce((total, row) => total + (Number.isFinite(row[key]) ? row[key] : 0), 0);
  const incomes = (facts.incomes || []).filter(row => (!row.starts || row.starts <= year) && (!row.ends || row.ends >= year));
  const cards = [
    { id: 'effective-finances', type: 'list', title: 'Datos efectivos · USD', items: [
      { label: 'Cuentas', value: sum(facts.accounts, 'balance'), format: 'money' },
      { label: 'Otros activos', value: sum(facts.other_assets, 'value'), format: 'money' },
      { label: 'Deudas', value: sum(facts.liabilities, 'balance'), format: 'money' },
      { label: 'Ingresos anuales vigentes', value: sum(incomes, 'yearly'), format: 'money' },
    ] },
    { id: 'goals', type: 'list', title: 'Objetivos registrados', items: (facts.goals || []).map(goal => ({ label: `${goal.name}${goal.start_year ? ` · ${goal.start_year}` : ''}`, value: goal.amount, format: 'money' })) },
    { id: 'household', type: 'list', title: 'Mi familia', items: family.people.map(person => ({ label: `${person.name || person.first_name}${person.age != null ? ` · ${person.age} años` : ''}` })) },
  ];
  const original = family.source?.financial?.projections?.yearly || [];
  const source = store.list('source_documents', { family_id: family.id }).find(item => item.source_path.endsWith('financial-health.json'));
  const stale = family.projection_status === 'stale';
  if (original.length) {
    const sample = [...new Set([0, Math.floor(original.length / 2), original.length - 1])].map(index => original[index]);
    cards.push({ id: 'original-projection', type: 'list', title: stale ? 'Proyección original · pendiente de recálculo' : 'Proyección original · solo lectura',
      items: [{ label: stale ? 'Los cambios posteriores no están recalculados.' : 'Escenario del documento original; no es una garantía.' },
        ...sample.map(row => ({ label: `Patrimonio proyectado ${row.year} (USD nominales)`, value: row.net_worth, format: 'money' }))] });
  }
  return { family_id: family.id, version: family.version, currency: 'USD', cards, projection_status: family.projection_status,
    original_projection: { read_only: true, stale, source_id: source?.id || null, source_sha256: source?.sha256 || null, imported_at: source?.imported_at || null, yearly: original } };
}
function callSlots(store, timezone) {
  const now = new Date(store.now());
  return [1, 2, 3].map(offset => {
    const date = new Date(now); date.setUTCDate(date.getUTCDate() + offset); date.setUTCHours(15, 0, 0, 0);
    return { id: date.toISOString(), start: date.toISOString(), demo: true,
      label: `Preferencia demo · ${new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(date)} (${timezone})` };
  });
}

export async function handleFrontendClient({ path, method, input = {}, session, store, engine, url }) {
  const pathname = (Array.isArray(path) ? `/${path.join('/')}` : path).replace(/^\/api(?=\/)/, '');
  if (!pathname.startsWith('/client/')) return null;
  if (session?.role !== 'client' || !session.family_id) throw fail('Se requiere una sesión de cliente de una familia.', 403);
  const family = store.getFamily(session.family_id);
  if (input.family_id && input.family_id !== family.id) throw fail('Familia fuera de tu sesión.', 403);
  const personId = input.person_id || session.person_id || family.people[0]?.id;
  if (!family.people.some(person => person.id === personId)) throw fail('Persona fuera de tu familia.', 403);
  const prefsId = `client-view:${family.id}:${personId}`;
  const contact = family.relationship.preferences[personId] || {};
  const reply = (body, status = 200) => ({ body, status });
  const event = (summary, kind, payload = {}) => engine.createEvent({ origin: 'client_form', scope: 'family', family_ids: [family.id],
    summary, kind, payload: { ...payload, person_id: personId }, dedupe_key: text(input.request_id, 120) || undefined }, { ...session, family_id: family.id });

  if (pathname === '/client/plan' && method === 'GET') return reply(planFor(family, store));
  if (pathname === '/client/financial-updates/fields' && method === 'GET') return reply(fields);
  if (pathname === '/client/financial-updates' && method === 'POST') {
    const submitted = Object.fromEntries(fields.map(field => [field.id, text(input[field.id])]).filter(([, value]) => value));
    if (!Object.keys(submitted).length) throw fail('Añade información antes de enviar.');
    const created = event(Object.entries(submitted).map(([key, value]) => `${fields.find(field => field.id === key).label}: ${value}`).join('\n'), 'client_update', { submitted_fields: submitted });
    return reply({ ok: true, event_id: created.id, status: 'queued', message: 'Información recibida para analizar; los hechos aún no se han modificado.' }, 202);
  }
  if (pathname === '/client/advisor' && method === 'GET') return reply({ id: 'local-demo-advisor', name: 'Asesor local', avatarUrl: null, title: 'Asistente virtual; sin conexión telefónica humana' });
  if (pathname === '/client/quick-topics' && method === 'GET') return reply([
    { id: 'understand-plan', label: 'Quiero entender mejor mi plan', icon: 'help' },
    { id: 'update-preferences', label: 'Prefiero explicaciones breves', icon: 'pencil' },
  ]);
  if (pathname === '/client/chat/messages' && method === 'GET') {
    const rows = messagesFor(store, family.id); const after = url?.searchParams?.get('after'); const index = after ? rows.findIndex(row => row.id === after) : -1;
    return reply(index >= 0 ? rows.slice(index + 1) : rows);
  }
  if (pathname === '/client/chat/messages' && method === 'POST') {
    const value = text(input.text, 6000); if (!value) throw fail('Escribe un mensaje.');
    let conversation = store.list('conversations', { family_id: family.id }).findLast(c => c.state === 'active' && c.person_id === personId);
    if (!conversation) {
      const prepared = store.list('communications', { family_id: family.id }).findLast(c => c.state === 'delivered' && c.person_ids.includes(personId));
      if (prepared) conversation = await engine.startConversation(prepared.id, { person_id: personId, audio: false });
    }
    if (conversation) {
      const result = await engine.turn(conversation.id, { text: value, audio: false, request_id: text(input.request_id, 120) || undefined });
      const turns = result.conversation.turns; const turn = turns.at(-2);
      return reply(message(turn, result.conversation, turns.length - 2));
    }
    const created = event(value, 'client_message', { topic_id: text(input.topicId, 80) });
    const saved = store.put('client_messages', { family_id: family.id, person_id: personId, author: 'client', text: value,
      createdAt: store.now(), event_id: created.id, status: 'queued', dedupe_key: `client-message:${created.id}` });
    return reply(pick(saved, ['id', 'author', 'text', 'createdAt', 'event_id', 'status']), 202);
  }
  if (pathname === '/client/chat/finish' && method === 'POST') {
    let conversation;
    if (input.conversation_id) {
      conversation = store.get('conversations', input.conversation_id);
      if (!conversation) throw fail('Conversación no encontrada.', 404);
      if (conversation.family_id !== family.id) throw fail('Conversación fuera de tu familia.', 403);
    } else {
      conversation = store.list('conversations', { family_id: family.id }).findLast(item => item.state === 'active' && item.person_id === personId);
    }
    if (!conversation) return reply({ ok: true, state: 'no_active_conversation', analysis_state: null,
      message: 'No hay una conversación activa. Las peticiones recibidas siguen en su cola de análisis.' });
    const completed = await engine.finish(conversation.id);
    return reply({ ok: true, conversation_id: completed.id, state: completed.state, analysis_state: completed.analysis_state,
      message: completed.analysis_state === 'completed' ? 'Conversación y análisis completados.' : 'Conversación finalizada. El análisis y los seguimientos se procesarán ahora.' });
  }
  if (pathname === '/client/call-slots' && method === 'GET') return reply(callSlots(store, contact.timezone || 'America/Chicago'));
  if (pathname === '/client/call-requests' && method === 'POST') {
    if (input.asap === true) { const created = event('El cliente solicita hablar con su asesor lo antes posible. Registrar petición; no prometer conexión o disponibilidad humana.', 'human_contact_request'); return reply({ ok: true, event_id: created.id, status: 'queued', message: 'Solicitud recibida; no hay una llamada humana confirmada.' }, 202); }
    const slot = callSlots(store, contact.timezone || 'America/Chicago').find(item => item.id === input.slotId);
    if (!slot) throw fail('Selecciona una fecha demo vigente.');
    const followup = engine.schedule(family.id, { person_ids: [personId], purpose: 'Revisar la solicitud explícita de llamada del cliente en su fecha preferida; confirmar disponibilidad humana si corresponde.', due_at: slot.start,
      timezone: contact.timezone || 'America/Chicago', cancel_conditions: ['El cliente cancela la petición', 'La consulta ya está resuelta'], timing_basis: 'Fecha elegida explícitamente por el cliente en la demo',
      dedupe_key: `client-call:${family.id}:${personId}:${slot.start}` }, { origin: 'client_request' });
    return reply({ ok: true, followup_id: followup.id, status: 'scheduled_evaluation', due_at: followup.due_at, message: 'Seguimiento programado en la demo; no confirma disponibilidad de un asesor humano.' }, 202);
  }
  if (pathname === '/client/preferences' && method === 'GET') return reply({ sections: { updateData: true, askInfo: true, callRequest: true, ...store.get('ui_preferences', prefsId)?.sections }, person_id: personId, contact: pick(contact, ['language', 'timezone', 'channel', 'frequency', 'explanation_style']) });
  if (pathname === '/client/preferences' && method === 'PUT') {
    if (input.sections && (typeof input.sections !== 'object' || Object.entries(input.sections).some(([key, value]) => !sections.includes(key) || typeof value !== 'boolean'))) throw fail('Preferencias de vista inválidas.');
    const contactInput = input.contact || {};
    const allowed = new Set(['language', 'timezone', 'channel', 'frequency', 'explanation_style']);
    if (Object.entries(contactInput).some(([key, value]) => !allowed.has(key) || typeof value !== 'string' || value.length > 200)) throw fail('Preferencias de contacto inválidas.');
    if (contactInput.timezone) try { new Intl.DateTimeFormat('en', { timeZone: contactInput.timezone }); } catch { throw fail('Zona horaria inválida.'); }
    store.transaction(() => {
      store.put('ui_preferences', { id: prefsId, family_id: family.id, person_id: personId, sections: { ...store.get('ui_preferences', prefsId)?.sections, ...input.sections } });
      const changed = Object.fromEntries(Object.entries(contactInput).filter(([key, value]) => value !== contact[key]));
      if (Object.keys(changed).length) store.updateFamily(family.id, { expectedVersion: family.version, preferenceChanges: [{ person_id: personId, preferences: changed, explicit_request: true }] }, session.id);
    });
    return reply({ sections: { updateData: true, askInfo: true, callRequest: true, ...store.get('ui_preferences', prefsId).sections }, person_id: personId,
      contact: pick(store.getFamily(family.id).relationship.preferences[personId] || {}, [...allowed]) });
  }
  return null;
}
export default handleFrontendClient;
