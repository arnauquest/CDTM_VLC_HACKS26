import { hash } from './engine.mjs';

const fail = (message, status = 422) => Object.assign(new Error(message), { status, code: 'advisor_ui_error' });
const pendingStates = new Set(['prepared', 'awaiting_review']);
const labels = { law_change: 'Cambio normativo', market_drop: 'Mercado', life_change: 'Cambio personal', big_decision: 'Decisión o consulta', silent: 'Evaluación automática sin contacto' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const htmlText = value => String(value ?? '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<!--[^]*?-->/g, '')
  .replace(/<(?:br\b[^>]*|\/p\s*|\/div\s*)>/gi, '\n').replace(/<[^>]*>/g, '')
  .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' }[entity]))
  .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => { const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code); return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; }).trim();
const toHtml = text => String(text || '').split(/\n\s*\n/).map(part => `<p>${esc(part).replace(/\n/g, '<br>')}</p>`).join('');
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const familyLabel = family => ({ id: family.id, name: family.name, avatarUrls: [] });
const safeConversation = conversation => JSON.parse(JSON.stringify(conversation, (key, value) => key === 'path' ? undefined : value));

function category(event) {
  const kind = String(event?.kind || '').toLowerCase();
  if (/law|tax|regulat|legal/.test(kind)) return 'law_change';
  if (/market|invest|rate/.test(kind)) return 'market_drop';
  if (/life|birth|income|debt|client_update|financial/.test(kind)) return 'life_change';
  return 'big_decision';
}

export function familyFacts(family, now = new Date().toISOString()) {
  const year=new Date(now).getUTCFullYear();
  const facts = family.facts || {}, lines = [];
  const amountLines = (rows, key, label, suffix = '') => {
    for (const row of (rows || []).slice(0, 3)) if (Number.isFinite(row[key])) lines.push(`${label} ${row.name || ''}: ${money(row[key])}${suffix}`.trim());
  };
  amountLines((facts.incomes||[]).filter(r=>(!r.starts||r.starts<=year)&&(!r.ends||r.ends>=year)), 'yearly', 'Ingreso vigente', '/año');
  amountLines(facts.accounts, 'balance', 'Cuenta');
  amountLines(facts.liabilities, 'balance', 'Deuda');
  return lines.slice(0, 7);
}

export function alertSummary(communication, store) {
  const family = store.getFamily(communication.family_id), event = store.get('events', communication.event_id);
  const kind = category(event), actionable = pendingStates.has(communication.state);
  return { id: communication.id, family: familyLabel(family),
    title: communication.contact?.purpose || event?.summary || 'Comunicación preparada', categories: [kind],
    tags: [labels[kind], communication.state === 'awaiting_review' ? 'Revisión pendiente' : communication.state],
    impact: communication.contact?.urgency === 'urgent' ? 'high' : communication.contact?.urgency === 'low' ? 'low' : 'medium',
    impactBasis: 'Urgencia declarada por el analista; no es un impacto financiero calculado.',
    channels: { email: actionable && Boolean(communication.draft?.text), call: actionable && Boolean(communication.draft?.voice_script) },
    state: communication.state, content_version: communication.content_version, facts_hash: communication.facts_hash,
    requires_review: communication.contact?.requires_review || false, review_reasons: communication.contact?.review_reasons || [],
    requiresReview: communication.state === 'awaiting_review', reviewLane: communication.contact?.review_lane || 'none',
    canBatchApprove: actionable && !communication.stale && communication.facts_hash === hash(family.facts) && !communication.contact?.requires_review && communication.contact?.review_lane !== 'individual',
    recommended_channel: communication.contact?.channel, createdAt: communication.created_at,
    delivery_kind: communication.delivery_kind || 'local_inbox', stale: Boolean(communication.stale),
  };
}

export function alertDetail(communication, store, voice) {
  const family = store.getFamily(communication.family_id), draft = communication.draft || {};
  const conversations = store.list('conversations', { communication_id: communication.id });
  const latest = conversations.at(-1), audio = latest?.turns?.find(turn => turn.role === 'assistant' && turn.audio?.audio_id)?.audio;
  const isDelivered = ['delivered', 'completed'].includes(communication.state), pending = pendingStates.has(communication.state);
  return { ...alertSummary(communication, store), facts: familyFacts(family,store.now()),
    touchpoints: [
      { step: 1, label: 'Evento recibido', status: 'sent' },
      { step: 2, label: 'Paquete preparado', status: 'sent' },
      { step: 3, label: isDelivered ? 'Disponible en bandeja local' : 'Revisión y canal', status: isDelivered ? 'sent' : 'current' },
      { step: 4, label: latest?.state === 'completed' ? 'Conversación completada' : 'Conversación en navegador', status: latest?.state === 'completed' ? 'sent' : latest ? 'current' : 'pending' },
    ],
    email: { to: communication.person_ids.map(id => family.people.find(person => person.id === id)?.name || id).join(', '),
      subject: draft.subject || communication.contact?.purpose || 'Seguimiento de tu asesor', tone: null,
      dataVerified: Boolean(communication.approval && !communication.stale && communication.facts_hash === hash(family.facts)),
      bodyHtml: toHtml(draft.text), channel: 'text', deliveryLabel: 'Bandeja local; no se envía correo externo' },
    call: { enabled: (pending || communication.state === 'delivered') && Boolean(draft.voice_script),
      audioUrl: audio ? `/api/audio/${audio.audio_id}` : null, durationSec: null,
      voiceLabel: voice?.capabilities?.().tts ? 'Voz de ElevenLabs en navegador; sin llamada telefónica' : 'Conversación en navegador; audio no configurado',
      script: draft.voice_script || '', channel: 'browser_voice', pstn: false },
    preparation: { ...draft, permitted_fact_refs: draft.permitted_fact_refs || [], conversation_objectives: draft.conversation_objectives || [],
      anticipated_questions_and_answers: draft.anticipated_questions_and_answers || [], conversation_branches: draft.conversation_branches || [],
      questions_to_ask: draft.questions_to_ask || [], response_boundaries: draft.response_boundaries || [],
      escalation_conditions: draft.escalation_conditions || [], handoff_response: draft.handoff_response || '' },
    evidence_refs: communication.assessment?.evidence_refs || [], missing_information: communication.assessment?.missing_information || [],
    conversationId: latest?.id || null, contact: communication.contact, authorization: communication.authorization_kind || null,
    reasoning: communication.contact?.reason || '', assessment: communication.assessment || null, draft,
    decision: communication.contact, evidenceRefs: communication.assessment?.evidence_refs || [],
  };
}

function checkedCommunication(store, id, input, { versionRequired = true, pendingOnly = false } = {}) {
  const communication = store.get('communications', id);
  if (!communication) throw fail('Comunicación no encontrada', 404);
  if (pendingOnly && !pendingStates.has(communication.state)) throw fail('Esta comunicación ya no es un borrador pendiente', 409);
  if (versionRequired && (input?.content_version !== communication.content_version || input?.facts_hash !== communication.facts_hash)) throw fail('El paquete ha cambiado; vuelve a abrirlo antes de actuar', 409);
  if (versionRequired && hash(store.getFamily(communication.family_id).facts) !== communication.facts_hash) throw fail('Los hechos han cambiado; solicita una nueva preparación', 409);
  return communication;
}

function historyRows(store) {
  const rows = [];
  for (const approval of store.list('approvals')) {
    const communication = store.get('communications', approval.communication_id);
    rows.push({ id: `approval:${approval.id}`, kind: 'approved', status: 'approved', title: 'Paquete aprobado por asesor',
      subtitle: communication?.contact?.purpose || 'Aprobación registrada', tags: [approval.channel || communication?.contact?.channel || ''],
      family: communication ? familyLabel(store.getFamily(communication.family_id)) : null, createdAt: approval.approved_at || approval.created_at,
      source_type: 'approvals', source_id: approval.id, canRevert: false });
  }
  for (const trace of store.list('traces')) {
    if (trace.status !== 'completed' || !['relevance', 'contact_decision', 'delivery'].includes(trace.stage)) continue;
    const communication = trace.data?.communication_id ? store.get('communications', trace.data.communication_id) : null;
    if (trace.stage === 'delivery' && (trace.data?.authorization || communication?.authorization_kind) !== 'policy_auto') continue;
    if (trace.stage === 'relevance' && trace.data?.route !== 'discard') continue;
    if (trace.stage === 'contact_decision' && trace.data?.decision !== 'none') continue;
    rows.push({ id: `trace:${trace.id}`, kind: 'silent', status: 'silent', title: trace.stage === 'delivery' ? 'Entrega automática en bandeja local' : 'Evaluación sin nuevo contacto',
      subtitle: trace.message || trace.stage, tags: [trace.stage], family: trace.family_id ? familyLabel(store.getFamily(trace.family_id)) : null,
      createdAt: trace.created_at, source_type: 'traces', source_id: trace.id, canRevert: false });
  }
  for (const audit of store.list('audit_log')) rows.push({ id: `audit:${audit.id}`, kind: 'audit', status: 'logged', title: audit.action || 'Cambio registrado',
    subtitle: `Actor: ${audit.actor || 'sistema'}${audit.before_version !== undefined ? ` · versión ${audit.before_version} → ${audit.after_version}` : ''}`,
    tags: ['Auditoría local'], family: audit.family_id ? familyLabel(store.getFamily(audit.family_id)) : null,
    createdAt: audit.created_at, source_type: 'audit_log', source_id: audit.id, canRevert: false });
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function autonomy(store) {
  const policy = store.getPolicy();
  return { mode: policy.mode, version: policy.version, expected_version: policy.version,
    sections: [{ id: 'autonomy', title: 'Autonomía de comunicaciones', rules: [{ id: 'automatic_delivery',
      label: 'Permitir entrega automática de paquetes rutinarios', enabled: policy.mode === 'auto',
      hint: 'Desactivado: todas las comunicaciones requieren aprobación. Los casos que necesitan revisión siguen bloqueados en modo automático.' }] }],
    integration: { name: 'Datos locales de familias', status: 'connected', description: `${store.listFamilies().length} familias importadas en SQLite local. No implica una conexión MCP activa.` } };
}

export async function handleFrontendAdvisor({ path, method, input = {}, session, store, engine, voice, url }) {
  const route = ('/' + (Array.isArray(path) ? path.join('/') : String(path || ''))).replace(/^\/+/, '/').replace(/^\/api(?=\/)/, '');
  const known = /^\/(consultant\/(dashboard|settings\/autonomy)|alerts(?:\/|$)|ui\/families(?:\/|$)|history(?:\/|$)|templates$)/.test(route);
  if (!known) return null;
  if (!session || !['advisor', 'admin'].includes(session.role)) throw fail('Acceso de asesor requerido', 403);
  const query = url instanceof URL ? url.searchParams : new URL(String(url || 'http://localhost')).searchParams;
  const response = body => ({ body });
  if (route === '/consultant/dashboard' && method === 'GET') {
    const approvals = store.list('approvals');
    const jobs = store.list('jobs');
    const waits = approvals.flatMap(approval => { const c = store.get('communications', approval.communication_id); const elapsed = Date.parse(approval.approved_at) - Date.parse(c?.created_at); return Number.isFinite(elapsed) && elapsed >= 0 ? [elapsed / 60000] : []; });
    return response({ familiesMonitored: store.listFamilies().length, activeAlerts: store.list('communications').filter(c => pendingStates.has(c.state)).length,
      avgReviewMinutes: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length * 10) / 10 : null,
      silentActions: historyRows(store).filter(item => item.kind === 'silent').length, reviewSampleCount: waits.length,
      pendingJobs: jobs.filter(job => ['queued', 'leased'].includes(job.status)).length, failedJobs: jobs.filter(job => job.status === 'failed').length });
  }
  if (route === '/alerts/categories' && method === 'GET') return response(Object.entries(labels).map(([id, label]) => ({ id, label })));
  if (route === '/alerts' && method === 'GET') {
    const categories = query.getAll('category').flatMap(item => item.split(','));
    const state = query.get('status') || 'pending';
    return response(store.list('communications').filter(c => state === 'all' || (state === 'pending' ? pendingStates.has(c.state) : c.state === state))
      .map(c => alertSummary(c, store)).filter(c => !categories.length || c.categories.some(item => categories.includes(item))).reverse());
  }
  if (route === '/alerts/batch-approve' && method === 'POST') {
    if (!Array.isArray(input.items) || input.items.length > 100) throw fail('Envía items con id, content_version y facts_hash');
    const results = [];
    for (const item of input.items) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string') { results.push({ id: null, ok: false, error: 'Elemento de aprobación inválido', status: 422 }); continue; }
      try { const c = checkedCommunication(store, item.id, item, { pendingOnly: true });
        if (c.contact?.requires_review || c.contact?.review_lane === 'individual') throw fail('Este paquete necesita revisión individual', 409);
        const updated = await engine.approve(c.id, item, session);
        results.push({ id: c.id, ok: true, state: updated.state, delivery_kind: 'local_inbox' });
      } catch (error) { results.push({ id: item.id, ok: false, error: error.message, status: error.status || 422 }); }
    }
    return response({ approved: results.filter(item => item.ok).length, results, external_email_sent: false });
  }
  const alert = route.match(/^\/alerts\/([^/]+)(?:\/(.*))?$/);
  if (alert) {
    const id = decodeURIComponent(alert[1]), action = alert[2];
    if (!action && method === 'GET') return response(alertDetail(checkedCommunication(store, id, input, { versionRequired: false }), store, voice));
    if (action === 'draft' && method === 'PUT') {
      let updated;
      store.transaction(() => {
        const c = checkedCommunication(store, id, input, { pendingOnly: true });
        const draft = { ...c.draft };
        const fields = [input.email?.bodyHtml, input.email?.subject, input.call?.script].filter(value => value !== undefined);
        if (!fields.length || fields.some(value => typeof value !== 'string')) throw fail('Incluye texto o guion válido para editar');
        if (input.email?.bodyHtml !== undefined) draft.text = htmlText(input.email.bodyHtml);
        if (input.email?.subject !== undefined) draft.subject = htmlText(input.email.subject);
        if (input.call?.script !== undefined) draft.voice_script = String(input.call.script).trim();
        if ([draft.text, draft.subject || '', draft.voice_script].some(value => typeof value !== 'string' || value.length > 20000)) throw fail('Texto del borrador inválido o demasiado largo');
        if (!draft.text && !draft.voice_script) throw fail('El paquete necesita texto o guion');
        const snapshot = store.put('communication_versions', { id: `${id}:${c.content_version}`, communication_id: id, family_id: c.family_id,
          content_version: c.content_version, draft: c.draft, contact: c.contact, facts_hash: c.facts_hash, approval: c.approval || null });
        updated = store.patch('communications', id, { draft, content_version: c.content_version + 1, approval: null,
          authorization_kind: null, state: 'awaiting_review', contact: { ...c.contact, requires_review: true, review_lane: 'individual',
            review_reasons: [...new Set([...(c.contact?.review_reasons || []), 'Borrador editado por asesor; revisar el paquete completo'])] } });
        store.put('audit_log', { actor: session.id || session.role, action: 'communication_draft_edited', target_id: id, family_id: c.family_id,
          before_version: c.content_version, after_version: updated.content_version, before_hash: hash(c.draft), after_hash: hash(draft), previous_content_ref: snapshot.id });
      });
      return response(alertDetail(updated, store, voice));
    }
    if (action === 'email/approve' && method === 'POST') {
      const c = checkedCommunication(store, id, input);
      const updated = await engine.approve(c.id, { ...input, channel: 'text' }, session);
      return response({ approved: true, state: updated.state, delivery_kind: 'local_inbox', external_email_sent: false,
        message: 'Disponible en la bandeja local del cliente. No se ha enviado correo externo.', alert: alertDetail(updated, store, voice) });
    }
    if (action === 'call/launch' && method === 'POST') {
      const c = checkedCommunication(store, id, input);
      const approved = await engine.approve(c.id, { ...input, channel: 'browser_voice' }, session);
      const conversation = await engine.startConversation(approved.id, { audio: input.audio !== false });
      const audio = conversation.turns.find(turn => turn.audio?.audio_id)?.audio;
      return response({ launched: true, delivery_kind: 'browser_voice', pstn: false, conversationId: conversation.id,
        conversation: safeConversation(conversation), audioUrl: audio ? `/api/audio/${audio.audio_id}` : null,
        message: 'Conversación abierta en el navegador. No se ha realizado una llamada telefónica.', alert: alertDetail(store.get('communications', id), store, voice) });
    }
    if (action === 'snooze' && method === 'POST') {
      if (typeof input.until !== 'string' || !Number.isFinite(Date.parse(input.until)) || Date.parse(input.until) <= Date.parse(store.now())) throw fail('Elige una fecha futura válida');
      try { new Intl.DateTimeFormat('en', { timeZone: input.timezone || 'Europe/Madrid' }); } catch { throw fail('Zona horaria inválida'); }
      let followup;
      store.transaction(() => {
        const c = checkedCommunication(store, id, input, { pendingOnly: true });
        followup = engine.schedule(c.family_id, { person_ids: c.person_ids, purpose: `Reevaluar comunicación pospuesta: ${c.contact?.purpose || 'seguimiento'}`,
          due_at: input.until, timezone: input.timezone || 'Europe/Madrid', timing_basis: 'Fecha seleccionada explícitamente por el asesor',
          cancel_conditions: ['El asunto ya está resuelto', 'El cliente rechaza el seguimiento'], dedupe_key: `snooze:${id}:${new Date(input.until).toISOString()}` }, { event_id: c.event_id, communication_id: id });
        store.patch('communications', id, { state: 'superseded', snoozed_until: followup.due_at, approval: null, authorization_kind: null });
        store.put('audit_log', { actor: session.id || session.role, action: 'communication_snoozed', target_id: id, family_id: c.family_id, followup_id: followup.id, due_at: followup.due_at });
      });
      return response({ snoozed: true, followup, message: 'Se reevaluará el propósito en la fecha elegida; no se enviará automáticamente el borrador actual.' });
    }
  }
  if (route === '/ui/families' || route === '/ui/families/summary') {
    if (method !== 'GET') throw fail('Método no permitido', 405);
    const policy = store.getPolicy(), communications = store.list('communications');
    const all = store.listFamilies().map(f => {
      const needs = communications.some(c => c.family_id === f.id && pendingStates.has(c.state));
      return { ...familyLabel(f), risk: null, riskProfile: null, status: needs ? 'needs_approval' : policy.mode === 'auto' ? 'autopilot' : 'manual',
        facts: familyFacts(f,store.now()), goal: (f.facts?.goals || []).map(goal => goal.name).filter(Boolean).join(' · '),
        planUrl: `/app/?role=cliente&family=${encodeURIComponent(f.id)}#/mi-plan`, psychProfileUrl: `/ops?family=${encodeURIComponent(f.id)}`,
        projection_status: f.projection_status, version: f.version, relationship_summary: f.relationship?.summary || '' };
    });
    if (route.endsWith('/summary')) return response({ total: all.length, needsApproval: all.filter(f => f.status === 'needs_approval').length, autopilot: all.filter(f => f.status === 'autopilot').length });
    const q = (query.get('q') || '').toLowerCase(), status = query.get('status') || 'all';
    return response(all.filter(f => (!q || f.name.toLowerCase().includes(q)) && (status === 'all' || f.status === status)));
  }
  if ((route === '/history' || route === '/history/summary') && method === 'GET') {
    const rows = historyRows(store);
    if (route.endsWith('/summary')) return response({ total: rows.length, silent: rows.filter(r => r.kind === 'silent').length, approved: rows.filter(r => r.kind === 'approved').length, audit: rows.filter(r => r.kind === 'audit').length });
    const type = query.get('type') || 'all';
    return response(rows.filter(row => type === 'all' || row.kind === type).slice(0, 500));
  }
  if (/^\/history\/[^/]+\/revert$/.test(route) && method === 'POST') throw fail('El historial es inmutable. Cambia la política o prepara una corrección; no se puede deshacer una entrega ya realizada.', 409);
  if (route === '/templates' && method === 'GET') return response(store.list('communications').filter(c => c.draft).map(c => ({ id: c.id,
    name: `${store.getFamily(c.family_id).name}: ${c.contact?.purpose || 'Paquete preparado'}`, channel: c.contact?.channel === 'text' ? 'email' : 'call',
    updatedAt: c.updated_at || c.created_at, usage: store.list('conversations', { communication_id: c.id }).length,
    family_id: c.family_id, kind: 'family_prepared_package', reusable_across_families: false, delivery_kind: 'local_inbox' })).reverse());
  if (route === '/consultant/settings/autonomy') {
    if (method === 'GET') return response(autonomy(store));
    if (method === 'PUT') {
      const rules = (input.sections || []).flatMap(section => section.rules || []);
      const rule = rules.find(item => item.id === 'automatic_delivery');
      const mode = rule ? (rule.enabled === true ? 'auto' : rule.enabled === false ? 'manual' : null) : input.mode;
      if (!['auto', 'manual'].includes(mode)) throw fail('Indica el modo auto/manual o automatic_delivery');
      if (rules.some(item => item.id !== 'automatic_delivery')) throw fail('La regla solicitada no está implementada');
      await engine.setMode(mode, input.expected_version ?? input.version);
      return response(autonomy(store));
    }
  }
  throw fail('Ruta de asesor o método no disponible', 404);
}

export default handleFrontendAdvisor;
