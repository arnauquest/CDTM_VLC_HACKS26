import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApplication } from './server.mjs';
import { Store } from './store.mjs';
import { hash } from './engine.mjs';

const FAMILY = 'michael-carter', OTHER = 'samantha-lewis';
async function fixture(t, mode = 'auto') {
  const store = new Store({ mode }).init();
  const env = { APP_PORT: '3000', TEST_API_KEY: 'frontend-http-private-secret' };
  const replies = [];
  const ai = { capabilities: () => ({ configured: false }), assess: async () => { throw new Error('HTTP test worker must remain stopped'); } };
  const voice = { capabilities: () => ({ tts: false, stt: false, conversation: true }),
    synthesize: async () => { throw new Error('No speech provider in HTTP tests'); },
    reply: async input => { replies.push(input); return { text: 'Your request is noted within this prepared conversation.', credential: 'fixture', model: 'fixture', handoff_requested: false }; } };
  const app = createApplication({ store, ai, voice, env, startWorker: false });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function request(path, { method = 'GET', token, body, headers = {}, redirect = 'manual' } = {}) {
    const response = await fetch(base + path, { method, redirect, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text(); let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, headers: response.headers, text, data };
  }
  async function login(role, family_id) {
    const response = await request('/api/session', { method: 'POST', body: { role, family_id } });
    assert.equal(response.status, 200); return { token: response.data.token, cookie: response.headers.get('set-cookie').split(';')[0] };
  }
  function communication({ family_id = FAMILY, state = 'awaiting_review', text = 'Prepared local follow-up', requires_review = false } = {}) {
    const family = store.getFamily(family_id);
    const event = store.put('events', { origin: 'client_message', scope: 'family', family_ids: [family_id], kind: 'request', summary: 'Client requested clarification.' });
    return store.put('communications', { family_id, event_id: event.id, state, person_ids: [family.people[0].id], content_version: 1,
      facts_hash: hash(family.facts), policy_version: store.getPolicy().version,
      contact: { purpose: 'Clarify the client request', reason: 'Explicit request', urgency: 'normal', requires_review,
        review_lane: requires_review ? 'individual' : 'batch', review_reasons: [], channel: 'text' },
      draft: { text, voice_script: text, response_boundaries: ['Prepared scope only'], permitted_fact_refs: [] },
      assessment: { evidence_refs: [event.id], missing_information: [] } });
  }
  return { ...app, env, request, login, communication, replies };
}

test('frontend HTML, JS and public brand are served while encoded traversal is blocked', async t => {
  const fx = await fixture(t);
  const root = await fx.request('/'); assert.equal(root.status, 302); assert.equal(root.headers.get('location'), '/app/');
  const page = await fx.request('/app/'); assert.equal(page.status, 200); assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(page.text, /js\/main\.js/);
  const config = await fx.request('/app/js/config.js'); assert.equal(config.status, 200); assert.match(config.headers.get('content-type'), /javascript/);
  assert.match(config.text, /USE_MOCKS[^\n]*false/);
  const brand = await fx.request('/api/brand'); assert.equal(brand.status, 200); assert.equal(brand.data.appName, 'sherpas');
  assert.doesNotMatch(brand.text, /frontend-http-private-secret/);
  for (const path of ['/app/..%2f..%2fbackend%2fpublic%2fops.html', '/app/%2fetc%2fpasswd', '/app/.env', '/app/does-not-exist.js']) {
    const result = await fx.request(path); assert.equal(result.status, 404, path); assert.match(result.headers.get('content-type'), /json/);
  }
  assert.equal((await fx.request('/api/brand/publish', { method: 'POST', body: {} })).status, 401);
});

test('real HTTP bootstrap maps frontend roles, cookie sessions, family identity and logout', async t => {
  const fx = await fixture(t);
  assert.equal((await fx.request('/api/me')).status, 401);
  for (const [backendRole, frontendRole] of [['advisor', 'consultor'], ['admin', 'admin'], ['client', 'cliente']]) {
    const session = await fx.login(backendRole, backendRole === 'client' ? FAMILY : undefined);
    const me = await fx.request('/api/me', { headers: { Cookie: session.cookie } });
    assert.equal(me.status, 200); assert.equal(me.data.role, frontendRole); assert.equal(me.data.local_demo, true);
    if (backendRole === 'client') assert.equal(me.data.family.id, FAMILY);
    else assert.equal(me.data.family, undefined);
    const logout = await fx.request('/api/auth/logout', { token: session.token, method: 'POST', body: {} });
    assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await fx.request('/api/me', { token: session.token })).status, 401);
  }
});

test('consultant endpoints read actual four-family state and remain distinct from core API', async t => {
  const fx = await fixture(t); const { token } = await fx.login('advisor');
  const dashboard = await fx.request('/api/consultant/dashboard', { token });
  assert.equal(dashboard.status, 200); assert.equal(dashboard.data.familiesMonitored, 4);
  assert.equal(dashboard.data.activeAlerts, 0); assert.equal(dashboard.data.avgReviewMinutes, null);
  assert.deepEqual((await fx.request('/api/alerts', { token })).data, []);
  const families = await fx.request('/api/ui/families', { token });
  assert.equal(families.data.length, 4); assert.deepEqual(families.data.map(f => f.id).sort(), fx.store.listFamilies().map(f => f.id).sort());
  assert.ok(families.data.every(f => f.risk === null && Array.isArray(f.facts)));
  const raw = await fx.request('/api/families', { token });
  assert.equal(Array.isArray(raw.data[0].facts), false); assert.ok(raw.data[0].facts.accounts);
  const c = fx.communication();
  const alerts = await fx.request('/api/alerts', { token }); assert.equal(alerts.data[0].id, c.id);
  assert.equal((await fx.request('/api/consultant/dashboard', { token })).data.activeAlerts, 1);
  const { token: client } = await fx.login('client', FAMILY);
  assert.equal((await fx.request('/api/ui/families', { token: client })).status, 403);
});

test('client plan and financial update requests are scoped and preserve current facts until analysis', async t => {
  const fx = await fixture(t); const { token } = await fx.login('client', FAMILY);
  const before = fx.store.getFamily(FAMILY), other = fx.store.getFamily(OTHER);
  const plan = await fx.request(`/api/client/plan?family_id=${OTHER}`, { token });
  assert.equal(plan.status, 200); assert.equal(plan.data.family_id, FAMILY);
  const accounts = before.facts.accounts.reduce((sum, row) => sum + row.balance, 0);
  assert.equal(plan.data.cards.find(c => c.id === 'effective-finances').items.find(item => item.label === 'Cuentas').value, accounts);
  assert.equal(plan.data.original_projection.read_only, true);
  assert.equal((await fx.request('/api/client/financial-updates', { token, method: 'POST', body: { income: 'Changed salary', family_id: OTHER } })).status, 403);
  assert.equal((await fx.request('/api/client/financial-updates', { token, method: 'POST', body: { income: 'Changed salary', person_id: other.people[0].id } })).status, 403);
  const input = { income: 'My annual salary is now USD 190000 from today.', request_id: 'http-financial-update' };
  const updated = await fx.request('/api/client/financial-updates', { token, method: 'POST', body: input });
  assert.equal(updated.status, 202); assert.equal(updated.data.status, 'queued');
  const event = fx.store.get('events', updated.data.event_id); assert.deepEqual(event.family_ids, [FAMILY]); assert.equal(event.origin, 'client_form');
  const repeat = await fx.request('/api/client/financial-updates', { token, method: 'POST', body: input });
  assert.equal(repeat.data.event_id, event.id); assert.equal(fx.store.list('jobs').length, 1);
  assert.deepEqual(fx.store.getFamily(FAMILY).facts, before.facts); assert.deepEqual(fx.store.getFamily(OTHER), other);
});

test('client chat excludes other families and unapproved drafts through HTTP routing', async t => {
  const fx = await fixture(t); const { token } = await fx.login('client', FAMILY);
  fx.communication({ text: 'Private pending package' });
  fx.communication({ family_id: OTHER, state: 'delivered', text: 'Other family private words' });
  assert.deepEqual((await fx.request('/api/client/chat/messages', { token })).data, []);
  const posted = await fx.request('/api/client/chat/messages', { token, method: 'POST', body: { text: 'Please clarify my plan.', request_id: 'http-client-message' } });
  assert.equal(posted.status, 202); assert.equal(posted.data.author, 'client');
  const messages = await fx.request('/api/client/chat/messages', { token });
  assert.equal(messages.data.length, 1); assert.doesNotMatch(messages.text, /Private pending|Other family/);
  const prepared = fx.communication({ state: 'delivered', text: 'Your own prepared response' });
  const active = await fx.request('/api/client/chat/messages', { token, method: 'POST', body: { text: 'I prefer brief explanations.', audio: false, request_id: 'prepared-turn' } });
  assert.equal(active.status, 200); assert.equal(fx.replies.length, 1); assert.equal(fx.replies[0].family.id, FAMILY);
  const conversation = fx.store.list('conversations', { communication_id: prepared.id })[0]; assert.equal(conversation.family_id, FAMILY);
  assert.equal(fx.store.list('conversations', { family_id: OTHER }).length, 0);
});

test('admin-only endpoints and CSV work through server dispatch without secret or formula leaks', async t => {
  const fx = await fixture(t); const advisor = await fx.login('advisor'), client = await fx.login('client', FAMILY), admin = await fx.login('admin');
  for (const token of [advisor.token, client.token]) for (const path of ['/api/admin/summary', '/api/admin/compliance/report'])
    assert.equal((await fx.request(path, { token })).status, 403);
  const summary = await fx.request('/api/admin/summary', { token: admin.token });
  assert.equal(summary.status, 200); assert.equal(summary.data.activeFamilies, 4); assert.equal(summary.data.slaMinutes, null);
  fx.store.put('audit_log', { actor: fx.env.TEST_API_KEY, action: '=1+2', family_id: FAMILY });
  const csv = await fx.request('/api/admin/compliance/report', { token: admin.token });
  assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /attachment/); assert.match(csv.text, /record_type/);
  assert.match(csv.text, /michael-carter/); assert.doesNotMatch(csv.text, /frontend-http-private-secret/); assert.match(csv.text, /'=1\+2/);
  assert.equal((await fx.request('/api/admin/billing/seats', { token: admin.token, method: 'POST', body: {} })).status, 409);
});

test('autonomy HTTP updates persist in core policy and reject stale saves', async t => {
  const fx = await fixture(t); const { token } = await fx.login('advisor');
  const initial = (await fx.request('/api/consultant/settings/autonomy', { token })).data;
  initial.sections[0].rules[0].enabled = false;
  const saved = await fx.request('/api/consultant/settings/autonomy', { token, method: 'PUT', body: initial });
  assert.equal(saved.status, 200); assert.equal(saved.data.mode, 'manual');
  assert.deepEqual((await fx.request('/api/policy', { token })).data, { mode: 'manual', version: 2 });
  assert.equal((await fx.request('/api/consultant/settings/autonomy', { token, method: 'PUT', body: initial })).status, 409);
  saved.data.sections[0].rules[0].enabled = true;
  assert.equal((await fx.request('/api/consultant/settings/autonomy', { token, method: 'PUT', body: saved.data })).status, 200);
  assert.deepEqual(fx.store.getPolicy(), { mode: 'auto', version: 3 });
});

test('draft API versions survive parsed-body dispatch and gate local inbox approval', async t => {
  const fx = await fixture(t, 'manual'); const { token } = await fx.login('advisor'), c = fx.communication();
  const detail = (await fx.request(`/api/alerts/${c.id}`, { token })).data;
  const versions = { content_version: detail.content_version, facts_hash: detail.facts_hash };
  const edited = await fx.request(`/api/alerts/${c.id}/draft`, { token, method: 'PUT', body: { ...versions,
    email: { subject: 'Edited subject', bodyHtml: '<p>New draft words.</p>' }, call: { script: 'New spoken opening.' } } });
  assert.equal(edited.status, 200); assert.equal(edited.data.content_version, 2);
  assert.equal(edited.data.preparation.text, 'New draft words.'); assert.equal(edited.data.canBatchApprove, false);
  assert.equal((await fx.request(`/api/alerts/${c.id}/email/approve`, { token, method: 'POST', body: versions })).status, 409);
  const approved = await fx.request(`/api/alerts/${c.id}/email/approve`, { token, method: 'POST', body: {
    content_version: edited.data.content_version, facts_hash: edited.data.facts_hash } });
  assert.equal(approved.status, 200); assert.equal(approved.data.external_email_sent, false); assert.equal(approved.data.delivery_kind, 'local_inbox');
  assert.equal(fx.store.get('communications', c.id).state, 'delivered');
  const all = await fx.request('/api/alerts?status=all', { token }); assert.ok(all.data.some(item => item.id === c.id));
  const client = await fx.login('client', FAMILY);
  const inbox = await fx.request('/api/client/chat/messages', { token: client.token });
  assert.ok(inbox.data.some(row => row.id === `opening:${c.id}`));
});
