import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './store.mjs';
import { Engine, hash } from './engine.mjs';
import { handleFrontendAdvisor } from './frontend-advisor.mjs';

function setup() {
  const store = new Store({ mode: 'manual' }).init();
  const voice = { capabilities: () => ({ tts: false }), synthesize: async () => { throw new Error('audio not configured'); } };
  const engine = new Engine({ store, voice, ai: {} });
  const session = { id: 'local-advisor', role: 'advisor' };
  const family = store.getFamily('michael-carter');
  const event = store.put('events', { origin: 'client_message', scope: 'family', family_ids: [family.id], kind: 'life_change', summary: 'A client asks about savings.' });
  const communication = store.put('communications', { family_id: family.id, event_id: event.id, person_ids: [family.people[0].id],
    state: 'awaiting_review', content_version: 1, facts_hash: hash(family.facts),
    contact: { purpose: 'Clarify the savings question', reason: 'Client asked explicitly.', urgency: 'normal', requires_review: false, review_lane: 'batch', channel: 'text', review_reasons: [] },
    draft: { text: 'I am the advisor’s virtual assistant. What would you like to clarify?', voice_script: 'I am your advisor’s virtual assistant.',
      response_boundaries: ['Do not invent figures.'], permitted_fact_refs: ['source:fixture'], conversation_objectives: ['Clarify concern'] },
    assessment: { evidence_refs: ['source:fixture'], missing_information: ['Requested amount'] } });
  const call = (path, method = 'GET', input = {}, override = {}) => handleFrontendAdvisor({ path, method, input, session, store, engine, voice,
    url: new URL(`http://localhost${path}`), ...override });
  const version = c => ({ content_version: c.content_version, facts_hash: c.facts_hash });
  return { store, engine, session, communication, family, event, call, version };
}

test('advisor route authorization, actual metrics and family projections avoid invented values', async () => {
  const t = setup();
  try {
    assert.equal(await t.call('/api/unrelated'), null);
    await assert.rejects(t.call('/api/alerts', 'GET', {}, { session: { role: 'client', family_id: t.family.id } }), { status: 403 });
    const dashboard = (await t.call('/api/consultant/dashboard')).body;
    assert.equal(dashboard.familiesMonitored, 4); assert.equal(dashboard.activeAlerts, 1);
    assert.equal(dashboard.avgReviewMinutes, null); assert.equal(dashboard.silentActions, 0);
    const families = (await t.call('/api/ui/families')).body;
    assert.equal(families.length, 4); assert.ok(families.every(f => f.risk === null));
    const summary = (await t.call('/api/ui/families/summary')).body;
    assert.equal(summary.needsApproval, 1); assert.equal(summary.autopilot, 0);
  } finally { t.store.close(); }
});

test('alert detail uses real bundle and versioned edits preserve evidence, snapshot history, and invalidate approval', async () => {
  const t = setup();
  try {
    const detail = (await t.call(`/api/alerts/${t.communication.id}`)).body;
    assert.equal(detail.canBatchApprove, true); assert.deepEqual(detail.preparation.response_boundaries, ['Do not invent figures.']);
    assert.deepEqual(detail.evidenceRefs, ['source:fixture']); assert.equal(detail.call.durationSec, null);
    t.store.patch('communications', t.communication.id, { approval: { id: 'old' }, authorization_kind: 'advisor_approval' });
    const updated = (await t.call(`/api/alerts/${t.communication.id}/draft`, 'PUT', { ...t.version(t.communication),
      email: { subject: 'Savings follow-up', bodyHtml: '<p>What amount?</p><script>alert(1)</script><img src=x onerror=alert(1)>' }, call: { script: 'Which amount should we discuss?' } })).body;
    assert.equal(updated.content_version, 2); assert.equal(updated.canBatchApprove, false);
    assert.equal(updated.email.bodyHtml, '<p>What amount?</p>');
    const stored = t.store.get('communications', t.communication.id);
    assert.equal(stored.approval, null); assert.equal(stored.authorization_kind, null);
    assert.deepEqual(stored.draft.response_boundaries, ['Do not invent figures.']);
    assert.equal(t.store.get('communication_versions', `${stored.id}:1`).draft.text, t.communication.draft.text);
    assert.ok(t.store.list('audit_log').some(row => row.action === 'communication_draft_edited'));
    await assert.rejects(t.call(`/api/alerts/${stored.id}/email/approve`, 'POST', t.version(t.communication)), { status: 409 });
  } finally { t.store.close(); }
});

test('batch approval excludes individual review and reports per-item outcomes', async () => {
  const t = setup();
  try {
    const individual = t.store.put('communications', { ...t.communication, id: undefined, contact: { ...t.communication.contact, requires_review: true, review_lane: 'individual' } });
    const result = (await t.call('/api/alerts/batch-approve', 'POST', { items: [
      { id: t.communication.id, ...t.version(t.communication) }, { id: individual.id, ...t.version(individual) },
    ] })).body;
    assert.equal(result.approved, 1); assert.equal(result.results[1].ok, false);
    assert.equal(t.store.get('communications', individual.id).state, 'awaiting_review');
    assert.equal(t.store.get('communications', t.communication.id).state, 'delivered');
  } finally { t.store.close(); }
});

test('text approval and browser launch use the real engine without claiming external delivery', async () => {
  const t = setup();
  try {
    const email = (await t.call(`/api/alerts/${t.communication.id}/email/approve`, 'POST', t.version(t.communication))).body;
    assert.equal(email.delivery_kind, 'local_inbox'); assert.equal(email.external_email_sent, false);
    const c = t.store.get('communications', t.communication.id);
    const launched = (await t.call(`/api/alerts/${c.id}/call/launch`, 'POST', { ...t.version(c), audio: false })).body;
    assert.equal(launched.pstn, false); assert.equal(launched.conversation.state, 'active');
    assert.equal(t.store.get('communications', c.id).contact.channel, 'browser_voice');
    assert.equal(t.store.get('conversations', launched.conversationId).family_id, t.family.id);
    const all = (await t.call('/api/alerts?status=all', 'GET', {}, { path: '/api/alerts' })).body;
    assert.ok(all.some(row => row.id === c.id));
  } finally { t.store.close(); }
});

test('snooze invalidates current draft and schedules scoped reevaluation only once', async () => {
  const t = setup();
  try {
    const until = new Date(Date.parse(t.store.now()) + 86400000).toISOString();
    const result = (await t.call(`/api/alerts/${t.communication.id}/snooze`, 'POST', { ...t.version(t.communication), until })).body;
    assert.equal(result.followup.state, 'scheduled'); assert.equal(result.followup.family_id, t.family.id);
    assert.equal(t.store.get('communications', t.communication.id).state, 'superseded');
    await assert.rejects(t.call(`/api/alerts/${t.communication.id}/snooze`, 'POST', { ...t.version(t.communication), until }), { status: 409 });
    assert.equal(t.store.list('followups').length, 1);
    t.store.setClock(until); t.engine.runDue(); t.engine.runDue();
    const followup = t.store.get('followups', result.followup.id);
    assert.equal(t.store.list('jobs', { event_id: followup.evaluation_event_id }).length, 1);
  } finally { t.store.close(); }
});

test('autonomy saves actual versioned policy, history is immutable and templates are scoped packages', async () => {
  const t = setup();
  try {
    const settings = (await t.call('/api/consultant/settings/autonomy')).body;
    settings.sections[0].rules[0].enabled = true;
    const saved = (await t.call('/api/consultant/settings/autonomy', 'PUT', settings)).body;
    assert.equal(saved.mode, 'auto'); assert.equal(t.store.getPolicy().version, 2);
    await assert.rejects(t.call('/api/consultant/settings/autonomy', 'PUT', settings), { code: 'VERSION_CONFLICT' });
    const history = (await t.call('/api/history')).body;
    assert.ok(history.some(row => row.kind === 'silent')); assert.ok(history.some(row => row.kind === 'audit'));
    await assert.rejects(t.call(`/api/history/${encodeURIComponent(history[0].id)}/revert`, 'POST'), { status: 409 });
    const templates = (await t.call('/api/templates')).body;
    assert.equal(templates[0].reusable_across_families, false); assert.equal(templates[0].usage, 0);
  } finally { t.store.close(); }
});
