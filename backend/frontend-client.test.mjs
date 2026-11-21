import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './store.mjs';
import { Engine, hash } from './engine.mjs';
import { handleFrontendClient } from './frontend-client.mjs';

function fixture(t) {
  const store = new Store().init(); t.after(() => store.close());
  const calls = [];
  const voice = { reply: async args => { calls.push(args); return { text: 'Actual adapter fixture reply', handoff_requested: false }; }, synthesize: async () => { throw new Error('Text-only test'); } };
  const engine = new Engine({ store, ai: {}, voice });
  const session = { role: 'client', family_id: 'michael-carter', id: 'client-test' };
  const call = (path, method = 'GET', input = {}, overrides = {}) => handleFrontendClient({ path, method, input, session, store, engine,
    url: new URL(`http://localhost/api${path}`), ...overrides });
  const communication = (id, state, family_id = session.family_id) => {
    const family = store.getFamily(family_id);
    return store.put('communications', { id, family_id, person_ids: [family.people[0].id], state,
      contact: { channel: 'browser_voice', requires_review: state === 'awaiting_review' }, draft: { text: 'Authorized prepared opening', voice_script: 'Authorized prepared opening' },
      content_version: 1, policy_version: 1, facts_hash: hash(family.facts), delivered_at: store.now() });
  };
  return { store, engine, session, call, communication, calls };
}

test('client adapter enforces family/person sessions and leaves unrelated routes alone', async t => {
  const { call } = fixture(t);
  assert.equal(await call('/unrelated'), null);
  assert.equal(await call('/client/plan', 'GET', {}, { path: ['api', 'client', 'plan'] }).then(result => result.body.family_id), 'michael-carter');
  await assert.rejects(call('/client/plan', 'GET', {}, { session: { role: 'advisor' } }), { status: 403 });
  await assert.rejects(call('/client/plan', 'GET', { family_id: 'samantha-lewis' }), { status: 403 });
  await assert.rejects(call('/client/preferences', 'PUT', { person_id: 'samantha-lewis:samantha', contact: { channel: 'text' } }), { status: 403 });
});

test('all family plans use effective USD facts and immutable original projection with stale label', async t => {
  const { call, store } = fixture(t);
  for (const family of store.listFamilies()) {
    const result = await call('/client/plan', 'GET', {}, { session: { role: 'client', family_id: family.id } });
    assert.equal(result.body.currency, 'USD'); assert.ok(result.body.cards.length >= 3);
    assert.deepEqual(result.body.original_projection.yearly, family.source.financial.projections.yearly);
    assert.equal(result.body.original_projection.read_only, true);
  }
  const original = store.getFamily('michael-carter').source.financial.projections.yearly;
  store.updateFamily('michael-carter', { expectedVersion: 1, factChanges: [{ field_path: 'incomes.0.yearly', new_value: 195000,
    unit: 'USD/year', effective_at: store.now(), evidence_ref: 'fixture-client-report', status: 'self_reported' }] });
  const { body } = await call('/client/plan');
  assert.equal(body.cards[0].items.find(item => item.label === 'Ingresos anuales vigentes').value, 195000);
  assert.equal(body.original_projection.stale, true); assert.deepEqual(body.original_projection.yearly, original);
  assert.match(body.cards.at(-1).title, /pendiente de recálculo/);
});

test('financial form queues a directed event with original text without premature fact writes', async t => {
  const { call, store } = fixture(t);
  const before = store.getFamily('michael-carter');
  const result = await call('/client/financial-updates', 'POST', { income: 'My salary is now 195000 USD/year from December.', request_id: 'financial-input-1' });
  assert.equal(result.status, 202);
  const event = store.get('events', result.body.event_id);
  assert.equal(event.origin, 'client_form'); assert.deepEqual(event.family_ids, ['michael-carter']); assert.equal(event.scope, 'family');
  assert.equal(event.payload.submitted_fields.income, 'My salary is now 195000 USD/year from December.');
  assert.deepEqual(store.getFamily('michael-carter').facts, before.facts);
  assert.equal(store.list('jobs').length, 1);
  await call('/client/financial-updates', 'POST', { income: 'Duplicate', request_id: 'financial-input-1' });
  assert.equal(store.list('jobs').length, 1);
  await assert.rejects(call('/client/financial-updates', 'POST', { income: ' ' }), { status: 422 });
});

test('chat queues without a prepared package, hides other-family/pending openings, and uses actual active turn adapter', async t => {
  const { call, store, communication, calls } = fixture(t);
  communication('hidden', 'awaiting_review'); communication('other-family', 'delivered', 'samantha-lewis');
  const pending = await call('/client/chat/messages', 'POST', { text: 'Could you explain my plan?', request_id: 'initial-message' });
  assert.equal(pending.status, 202); assert.equal(pending.body.author, 'client'); assert.equal(calls.length, 0);
  let messages = (await call('/client/chat/messages')).body; assert.equal(messages.length, 1);
  assert.ok(!JSON.stringify(messages).includes('Authorized prepared opening'));
  communication('delivered', 'delivered');
  messages = (await call('/client/chat/messages')).body; assert.equal(messages.filter(row => row.author === 'assistant').length, 1);
  const sent = await call('/client/chat/messages', 'POST', { text: 'My question is about the deposit.', request_id: 'active-message' });
  assert.equal(sent.body.author, 'client'); assert.equal(calls.length, 1); assert.equal(calls[0].family.id, 'michael-carter');
  assert.equal(store.list('conversations', { family_id: 'michael-carter' }).length, 1);
  messages = (await call('/client/chat/messages')).body;
  assert.ok(messages.some(row => row.text === 'Actual adapter fixture reply'));
  assert.equal(messages.filter(row => row.id === 'opening:delivered').length, 1);
  await call('/client/chat/messages', 'POST', { text: 'My question is about the deposit.', request_id: 'active-message' });
  assert.equal(calls.length, 1);
  const last = messages.at(-1).id;
  assert.deepEqual((await call('/client/chat/messages', 'GET', {}, { url: new URL(`http://localhost/api/client/chat/messages?after=${last}`) })).body, []);
});

test('view preferences persist separately; explicit per-person contact preference leaves financial facts unchanged', async t => {
  const { call, store } = fixture(t); const before = store.getFamily('michael-carter');
  const first = await call('/client/preferences', 'PUT', { sections: { updateData: false } });
  assert.equal(first.body.sections.updateData, false); assert.equal(store.getFamily('michael-carter').version, before.version);
  await call('/client/preferences', 'PUT', { contact: { channel: 'text', explanation_style: 'short', timezone: 'Europe/Madrid' } });
  const loaded = (await call('/client/preferences')).body;
  assert.equal(loaded.sections.updateData, false); assert.equal(loaded.contact.channel, 'text');
  assert.deepEqual(store.getFamily('michael-carter').facts, before.facts);
  await assert.rejects(call('/client/preferences', 'PUT', { contact: { timezone: 'invented' } }), { status: 422 });
  await assert.rejects(call('/client/preferences', 'PUT', { sections: { risk_profile: true } }), { status: 422 });
});

test('explicit chat finish queues same-family post-analysis once and never finishes another family', async t => {
  const { call, store, engine, communication } = fixture(t);
  const empty = await call('/client/chat/finish', 'POST');
  assert.equal(empty.body.state, 'no_active_conversation'); assert.equal(store.list('jobs').length, 0);
  communication('own-package', 'delivered'); communication('other-package', 'delivered', 'samantha-lewis');
  const own = await engine.startConversation('own-package', { audio: false });
  const other = await engine.startConversation('other-package', { audio: false });
  await assert.rejects(call('/client/chat/finish', 'POST', { conversation_id: other.id }), { status: 403 });
  assert.equal(store.get('conversations', other.id).state, 'active');
  const finished = await call('/client/chat/finish', 'POST', { conversation_id: own.id });
  assert.equal(finished.body.state, 'completed'); assert.equal(finished.body.analysis_state, 'pending');
  assert.equal(finished.body.conversation_id, own.id);
  const repeated = await call('/client/chat/finish', 'POST', { conversation_id: own.id });
  assert.equal(repeated.body.state, 'completed');
  assert.equal((await call('/client/chat/finish', 'POST')).body.state, 'no_active_conversation');
  const postJobs = store.list('jobs').filter(job => job.stage === 'post_analysis');
  assert.equal(postJobs.length, 1); assert.equal(postJobs[0].family_id, 'michael-carter'); assert.equal(postJobs[0].conversation_id, own.id);
  assert.equal(store.get('conversations', other.id).state, 'active');
});

test('approved text channel displays and opens the exact edited text instead of the voice script', async t => {
  const { call, store, engine, communication } = fixture(t);
  const prepared = communication('text-package', 'prepared');
  store.patch('communications', prepared.id, { contact: { ...prepared.contact, channel: 'text' },
    draft: { text: 'The exact advisor-approved text message.', voice_script: 'A different voice-only opening.' } });
  await engine.approve(prepared.id, { content_version: 1, facts_hash: prepared.facts_hash }, { id: 'advisor-test' });
  let messages = (await call('/client/chat/messages')).body;
  assert.equal(messages[0].text, 'The exact advisor-approved text message.');
  await call('/client/chat/messages', 'POST', { text: 'I have a question about that message.', request_id: 'text-channel-turn' });
  const conversation = store.list('conversations', { family_id: 'michael-carter' })[0];
  assert.equal(conversation.authorization, 'advisor_approval');
  assert.equal(conversation.turns[0].text, 'The exact advisor-approved text message.');
  messages = (await call('/client/chat/messages')).body;
  assert.equal(messages.find(message => message.id === 'opening:text-package').text, 'The exact advisor-approved text message.');
  assert.ok(!messages.some(message => message.text === 'A different voice-only opening.'));
});

test('call dates are explicit demo preferences; ASAP queues event and dated request schedules cancellable evaluation', async t => {
  const { call, store } = fixture(t);
  const slots = (await call('/client/call-slots')).body;
  assert.equal(slots.length, 3); assert.ok(slots.every(slot => slot.demo && Date.parse(slot.start) > Date.parse(store.now())));
  const asap = await call('/client/call-requests', 'POST', { asap: true });
  assert.equal(asap.status, 202); assert.equal(store.get('events', asap.body.event_id).kind, 'human_contact_request');
  const scheduled = await call('/client/call-requests', 'POST', { slotId: slots[0].id });
  assert.equal(scheduled.body.status, 'scheduled_evaluation');
  const followup = store.get('followups', scheduled.body.followup_id);
  assert.equal(followup.due_at, slots[0].start); assert.ok(followup.cancel_conditions.length);
  await assert.rejects(call('/client/call-requests', 'POST', { slotId: 'yesterday' }), { status: 422 });
});
