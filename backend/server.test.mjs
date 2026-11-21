import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApplication } from './server.mjs';
import { Store } from './store.mjs';
import { hash } from './engine.mjs';

const FAMILY = 'michael-carter';
const OTHER = 'samantha-lewis';
const PERSON = 'michael-carter:michael';
async function fixture(t, { mode = 'auto', env: extraEnv = {} } = {}) {
  const store = new Store({ mode }).init();
  const env = { APP_PORT: '3000', TEST_API_KEY: 'private-fixture-api-key', TEST_TOKEN: 'private-fixture-token', ...extraEnv };
  const calls = [];
  const ai = { capabilities: () => ({ configured: false, diagnostic: env.TEST_API_KEY }),
    assess: async () => { throw new Error('Worker must stay disabled'); } };
  const voice = { capabilities: () => ({ tts: true, stt: true, conversation: true }),
    synthesize: async () => { throw new Error('Audio disabled in HTTP fixture'); },
    transcribe: async () => { throw new Error(`Fixture failure ${env.TEST_TOKEN}`); },
    reply: async input => { calls.push(input); return { text: 'I can note your request for your advisor.', handoff_requested: true, credential: 'fixture', model: 'fixture' }; } };
  const app = createApplication({ store, ai, voice, env, startWorker: false });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function request(path, { token, method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(`${base}${path}`, { method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await response.text(); let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, headers: response.headers, data, text };
  }
  async function session(role, family_id) {
    const result = await request('/api/session', { method: 'POST', body: { role, family_id } });
    assert.equal(result.status, 200); return result.data.token;
  }
  function communication({ id = 'communication-fixture', family_id = FAMILY, state = 'prepared', requires_review = false } = {}) {
    const family = store.getFamily(family_id);
    return store.put('communications', { id, family_id, person_ids: [family.people[0].id], state,
      contact: { channel: 'browser_voice', requires_review, review_reasons: requires_review ? ['Fixture review'] : [] },
      draft: { text: 'I am your advisor’s virtual assistant.', voice_script: 'I am your advisor’s virtual assistant.', response_boundaries: ['Prepared scope only.'] },
      content_version: 1, facts_hash: hash(family.facts), policy_version: store.getPolicy().version });
  }
  return { ...app, env, calls, request, session, communication };
}

test('health, demo bootstrap, bearer/cookie sessions and errors never expose configured secrets', async t => {
  const fx = await fixture(t);
  const health = await fx.request('/api/health');
  assert.equal(health.status, 200); assert.equal(health.data.local_demo, true);
  assert.equal(health.data.providers.agents.diagnostic, '[redacted]');
  assert.doesNotMatch(health.text, /private-fixture/);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  const families = await fx.request('/api/demo/families');
  assert.equal(families.data.length, 4); assert.deepEqual(Object.keys(families.data[0]).sort(), ['id', 'name']);
  assert.equal((await fx.request('/api/families')).status, 401);
  assert.equal((await fx.request('/api/session', { method: 'POST', body: { role: 'root' } })).status, 422);
  const login = await fx.request('/api/session', { method: 'POST', body: { role: 'advisor' } });
  assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const current = await fx.request('/api/session', { headers: { Cookie: login.headers.get('set-cookie').split(';')[0] } });
  assert.equal(current.data.role, 'advisor'); assert.equal(current.data.token, undefined);
  const failed = await fx.request('/api/transcribe', { token: login.data.token, method: 'POST', body: {} });
  assert.equal(failed.status, 500); assert.doesNotMatch(failed.text, /private-fixture/); assert.match(failed.text, /redacted/);
});

test('client reads and writes remain inside the authenticated family', async t => {
  const fx = await fixture(t); const token = await fx.session('client', FAMILY);
  fx.communication({ state: 'delivered' }); const other = fx.communication({ id: 'other-communication', family_id: OTHER, state: 'delivered' });
  fx.store.put('conversations', { id: 'other-conversation', family_id: OTHER, state: 'active', turns: [] });
  fx.store.put('followups', { id: 'other-followup', family_id: OTHER, state: 'scheduled' });
  const families = await fx.request('/api/families', { token }); assert.deepEqual(families.data.map(f => f.id), [FAMILY]);
  for (const path of [`/api/families/${OTHER}`, `/api/communications/${other.id}`, '/api/conversations/other-conversation', '/api/overview', '/api/events', '/api/jobs', '/api/traces'])
    assert.equal((await fx.request(path, { token })).status, 403, path);
  assert.equal((await fx.request(`/api/families/${OTHER}/information`, { token, method: 'POST', body: { summary: 'Cross-family write' } })).status, 403);
  assert.equal((await fx.request('/api/followups/other-followup/cancel', { token, method: 'POST', body: {} })).status, 403);
  assert.equal((await fx.request(`/api/families/${FAMILY}/facts`, { token, method: 'PATCH', body: {} })).status, 403);
  const event = await fx.request(`/api/families/${FAMILY}/information`, { token, method: 'POST', body: { summary: 'Client asks for a review', family_id: OTHER, origin: 'advisor_input' }, headers: { 'Idempotency-Key': 'client-fixture-1' } });
  assert.equal(event.status, 202); assert.deepEqual(event.data.family_ids, [FAMILY]); assert.equal(event.data.origin, 'client_form');
  const duplicate = await fx.request(`/api/families/${FAMILY}/information`, { token, method: 'POST', body: { summary: 'Repeated request' }, headers: { 'Idempotency-Key': 'client-fixture-1' } });
  assert.equal(duplicate.data.id, event.data.id); assert.equal(fx.store.list('jobs').length, 1); assert.equal(fx.engine.running, 0);
});

test('pending and rejected communications are hidden in lists, direct GET and family detail', async t => {
  const fx = await fixture(t, { mode: 'manual' });
  const client = await fx.session('client', FAMILY); const advisor = await fx.session('advisor');
  for (const state of ['prepared', 'awaiting_review', 'rejected', 'cancelled', 'superseded']) fx.communication({ id: `draft-${state}`, state });
  fx.communication({ id: 'visible-completed', state: 'completed' });
  const list = await fx.request('/api/communications', { token: client }); assert.deepEqual(list.data.map(c => c.id), ['visible-completed']);
  const detail = await fx.request(`/api/families/${FAMILY}`, { token: client }); assert.deepEqual(detail.data.communications.map(c => c.id), ['visible-completed']);
  for (const state of ['prepared', 'awaiting_review', 'rejected', 'cancelled', 'superseded']) {
    assert.equal((await fx.request(`/api/communications/draft-${state}`, { token: client })).status, 404);
    assert.equal((await fx.request(`/api/communications/draft-${state}`, { token: advisor })).status, 200);
  }
  const start = await fx.request('/api/communications/draft-awaiting_review/start', { token: client, method: 'POST', body: { audio: false } });
  assert.equal(start.status, 409); assert.equal(fx.store.list('conversations').length, 0);
});

test('manual approvals bind content/facts, enforce advisor role and reject stale versions', async t => {
  const fx = await fixture(t, { mode: 'manual' }); const c = fx.communication(); await fx.engine.deliver(c.id);
  const client = await fx.session('client', FAMILY); const advisor = await fx.session('advisor');
  const approval = { content_version: c.content_version, facts_hash: c.facts_hash };
  assert.equal((await fx.request(`/api/communications/${c.id}/approve`, { token: client, method: 'POST', body: approval })).status, 403);
  assert.equal((await fx.request(`/api/communications/${c.id}/approve`, { token: advisor, method: 'POST', body: { ...approval, content_version: 0 } })).status, 409);
  assert.equal(fx.store.list('approvals').length, 0);
  const approved = await fx.request(`/api/communications/${c.id}/approve`, { token: advisor, method: 'POST', body: approval });
  assert.equal(approved.status, 200); assert.equal(approved.data.authorization_kind, 'advisor_approval'); assert.equal(approved.data.state, 'delivered');
  assert.equal(fx.store.list('approvals').length, 1);
  assert.equal((await fx.request(`/api/communications/${c.id}`, { token: client })).status, 200);
  assert.equal((await fx.request('/api/policy', { token: client, method: 'PATCH', body: { mode: 'auto', expected_version: 1 } })).status, 403);
  assert.equal((await fx.request('/api/policy', { token: advisor, method: 'PATCH', body: { mode: 'auto', expected_version: 0 } })).status, 409);
  assert.equal(fx.store.getPolicy().version, 1);
});

test('auto/manual switches recheck delivery while preserving content-required reviews and rejections', async t => {
  const fx = await fixture(t); const advisor = await fx.session('advisor'); const client = await fx.session('client', FAMILY);
  const routine = fx.communication(); const reviewed = fx.communication({ id: 'requires-review', requires_review: true });
  const rejected = fx.communication({ id: 'rejected', state: 'rejected' });
  await fx.engine.deliver(routine.id); await fx.engine.deliver(reviewed.id);
  assert.equal(fx.store.get('communications', routine.id).authorization_kind, 'policy_auto');
  let policy = await fx.request('/api/policy', { token: advisor, method: 'PATCH', body: { mode: 'manual', expected_version: 1 } });
  assert.deepEqual(policy.data, { mode: 'manual', version: 2 });
  assert.equal(fx.store.get('communications', routine.id).state, 'awaiting_review');
  assert.equal((await fx.request(`/api/communications/${routine.id}/start`, { token: client, method: 'POST', body: { audio: false } })).status, 409);
  policy = await fx.request('/api/policy', { token: advisor, method: 'PATCH', body: { mode: 'auto', expected_version: 2 } });
  assert.deepEqual(policy.data, { mode: 'auto', version: 3 });
  assert.equal(fx.store.get('communications', routine.id).state, 'delivered');
  assert.equal(fx.store.get('communications', routine.id).policy_version, 3);
  assert.equal(fx.store.get('communications', reviewed.id).state, 'awaiting_review');
  assert.equal(fx.store.get('communications', rejected.id).state, 'rejected');
});

test('origin validation rejects foreign browsers before actions and permits configured local origins', async t => {
  const fx = await fixture(t); const advisor = await fx.session('advisor');
  const denied = await fx.request('/api/policy', { token: advisor, method: 'PATCH', headers: { Origin: 'https://evil.example' }, body: { mode: 'manual', expected_version: 1 } });
  assert.equal(denied.status, 403); assert.equal(fx.store.getPolicy().version, 1); assert.equal(denied.headers.get('access-control-allow-origin'), null);
  assert.equal((await fx.request('/api/session', { method: 'POST', headers: { Origin: 'null' }, body: { role: 'admin' } })).status, 403);
  const allowed = await fx.request('/api/health', { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal((await fx.request('/api/policy', { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000' } })).status, 204);
  assert.equal((await fx.request('/api/policy', { token: advisor, method: 'DELETE', body: { mode: 'manual', expected_version: 1 } })).status, 405);
  assert.equal((await fx.request('/not-api/policy', { token: advisor })).status, 404);
  assert.equal((await fx.request('/api/session', { method: 'POST', body: '{invalid-json' })).status, 400);
  assert.equal((await fx.request('/api/session', { method: 'POST', body: 'null' })).status, 400);
});

test('HTTP conversation loop persists actual turns, deduplicates requests and queues post-analysis', async t => {
  const fx = await fixture(t); const client = await fx.session('client', FAMILY); const c = fx.communication(); await fx.engine.deliver(c.id);
  const started = await fx.request(`/api/communications/${c.id}/start`, { token: client, method: 'POST', body: { audio: false, person_id: PERSON } });
  assert.equal(started.status, 200); assert.equal(started.data.authorization, 'policy_auto');
  const id = started.data.id;
  const duplicateStart = await fx.request(`/api/communications/${c.id}/start`, { token: client, method: 'POST', body: { audio: false } });
  assert.equal(duplicateStart.data.id, id);
  const args = { token: client, method: 'POST', body: { text: 'I want to talk to my advisor.', audio: false }, headers: { 'Idempotency-Key': 'turn-fixture-1' } };
  const turn = await fx.request(`/api/conversations/${id}/turns`, args); assert.equal(turn.status, 200); assert.equal(turn.data.conversation.turns.length, 3);
  assert.equal(turn.data.conversation.handoff_requested, true); assert.equal(fx.calls[0].family.id, FAMILY);
  assert.equal(fx.calls[0].userText, args.body.text);
  assert.equal((await fx.request(`/api/conversations/${id}/turns`, args)).data.reply.id, turn.data.reply.id); assert.equal(fx.calls.length, 1);
  assert.equal((await fx.request(`/api/conversations/${id}/check-in`, { token: client, method: 'POST', body: { value: 'I feel informed.' } })).status, 200);
  const done = await fx.request(`/api/conversations/${id}/finish`, { token: client, method: 'POST', body: {} });
  assert.equal(done.data.state, 'completed'); assert.equal(done.data.analysis_state, 'pending');
  await fx.request(`/api/conversations/${id}/finish`, { token: client, method: 'POST', body: {} });
  assert.equal(fx.store.list('jobs').filter(j => j.stage === 'post_analysis').length, 1);
  assert.equal((await fx.request(`/api/conversations/${id}/turns`, args)).status, 409);
});

test('application close is idempotent, supports a callback and works before listen', async () => {
  const store = new Store().init(); let closed = 0; const original = store.close.bind(store);
  store.close = () => { closed++; original(); };
  const app = createApplication({ store, env: {}, ai: { capabilities: () => ({}) }, voice: { capabilities: () => ({}) }, startWorker: false });
  let callbacks = 0;
  const first = app.close(error => { assert.equal(error, undefined); callbacks++; });
  assert.equal(app.close(), first); await first; await Promise.resolve();
  assert.equal(closed, 1); assert.equal(callbacks, 1);
});

test('batch approval accepts routine drafts and leaves sensitive drafts for individual review', async t => {
  const fx = await fixture(t, { mode: 'manual' }); const advisor = await fx.session('advisor');
  const routine = fx.communication({ id: 'batch-routine' });
  const sensitive = fx.communication({ id: 'batch-sensitive', requires_review: true });
  await fx.engine.deliver(routine.id); await fx.engine.deliver(sensitive.id);
  const result = await fx.request('/api/communications/approve-batch', { token: advisor, method: 'POST', body: {
    items: [routine, sensitive].map(c => ({ id: c.id, content_version: c.content_version, facts_hash: c.facts_hash }))
  }});
  assert.equal(result.status, 200); assert.equal(result.data[0].ok, true); assert.equal(result.data[1].ok, false);
  assert.equal(result.data[1].status, 409); assert.equal(fx.store.get('communications', sensitive.id).state, 'awaiting_review');
  assert.equal(fx.store.list('approvals').length, 1);
});
