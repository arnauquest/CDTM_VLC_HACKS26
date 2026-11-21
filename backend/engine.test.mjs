import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './store.mjs';
import { Engine, hash } from './engine.mjs';

const FAMILY = 'michael-carter';
const OTHER = 'samantha-lewis';
const NOW = '2090-01-01T00:00:00.000Z';
const fact = (overrides = {}) => ({ person_id: `${FAMILY}:michael`, field_path: 'incomes.0.yearly', new_value: 190000, unit: 'USD/year', effective_at: null, evidence_ref: '', status: 'self_reported', ...overrides });
function assessment({ family, policy }, overrides = {}) {
  return { family_id: family.id, expected_state_version: family.version, policy_version: policy.version, fact_changes: [], followup_proposals: [],
    contact: { decision: 'now', reason: 'Clarify the client question', requires_review: false, review_reasons: [], channel: 'browser_voice', person_ids: [family.people[0].id], purpose: 'Clarification' },
    draft: { text: 'Hello, I am your advisor’s virtual assistant.', voice_script: 'Hello, what would you like to clarify?' }, ...overrides };
}
function fixture(t, options = {}) {
  const store = new Store().init(); store.setClock(NOW); const calls = { relevance: [], assess: [], post: [], voice: [] };
  const ai = { async relevance(args) { calls.relevance.push(args); return { route: 'assess' }; }, async assess(args) { calls.assess.push(args); return assessment(args); },
    async postAnalyze(args) { calls.post.push(args); return { family_id: args.family.id, conversation_id: args.conversation.id, observation_additions: [], preference_changes: [], fact_changes: [], followup_proposals: [], open_questions: [], summary: 'Conversation reviewed.' }; }, ...options.ai };
  const voice = { async synthesize() { return { url: '/mock.mp3' }; }, async transcribe() { return { text: 'Please use text next time.' }; }, async reply(args) { calls.voice.push(args); return { text: 'I have noted your request.', handoff_requested: false }; }, ...options.voice };
  const engine = new Engine({ store, ai, voice, wallNow: () => store.now() });
  t.after(() => { engine.stop(); store.close(); });
  async function drain() { let job; let count = 0; while ((job = store.claimJob(engine.wallNow()))) { if (++count > 20) throw new Error('Unexpected queue loop'); await engine.runJob(job); } }
  const event = (input = {}, actor) => engine.createEvent({ scope: 'family', family_ids: [FAMILY], summary: 'Please review my situation.', ...input }, actor);
  return { store, engine, ai, voice, calls, event, drain };
}

test('auto delivers and manual waits for approval; changing modes revalidates pending delivery', async t => {
  const { store, engine, event, drain } = fixture(t); event(); await drain();
  const c = store.list('communications')[0]; assert.equal(c.state, 'delivered'); assert.equal(c.authorization_kind, 'policy_auto');
  await engine.setMode('manual', 1); assert.equal(store.get('communications', c.id).state, 'awaiting_review');
  await assert.rejects(engine.startConversation(c.id, { audio: false }), { status: 409 });
  await assert.rejects(engine.approve(c.id, { content_version: 5, facts_hash: c.facts_hash }, { id: 'advisor' }), { status: 409 });
  const approved = await engine.approve(c.id, { content_version: 1, facts_hash: c.facts_hash }, { id: 'advisor' });
  assert.equal(approved.state, 'delivered'); assert.equal(approved.authorization_kind, 'advisor_approval');
  assert.equal(store.list('approvals').length, 1);
  const conversation = await engine.startConversation(c.id, { audio: false }); assert.equal(conversation.authorization, 'advisor_approval');
});

test('content review survives auto mode and changed financial facts invalidate approval', async t => {
  const { store, engine, ai, event, drain } = fixture(t);
  ai.assess = async args => { const result = assessment(args); result.contact.requires_review = true; return result; };
  event(); await drain(); let c = store.list('communications')[0]; assert.equal(c.state, 'awaiting_review');
  await engine.setMode('manual', 1); await engine.setMode('auto', 2); assert.equal(store.get('communications', c.id).state, 'awaiting_review');
  c = await engine.approve(c.id, { content_version: 1, facts_hash: c.facts_hash }, { role: 'advisor' });
  store.updateFamily(FAMILY, { expectedVersion: 1, factChanges: [fact({ effective_at: NOW, evidence_ref: 'client' })] });
  await assert.rejects(engine.approve(c.id, { content_version: 1, facts_hash: c.facts_hash }, { role: 'advisor' }), { status: 409 });
  assert.equal((await engine.deliver(c.id)).stale, true);
  await assert.rejects(engine.startConversation(c.id, { audio: false }), { status: 409 });
});

test('client scope and idempotency keys are isolated by family; directed events bypass relevance', async t => {
  const { store, event, drain, calls } = fixture(t);
  const input = { scope: 'global', family_ids: [OTHER], dedupe_key: 'client-request-1' };
  const first = event(input, { role: 'client', family_id: FAMILY }); const duplicate = event(input, { role: 'client', family_id: FAMILY });
  const other = event(input, { role: 'client', family_id: OTHER });
  assert.equal(first.id, duplicate.id); assert.notEqual(first.id, other.id); assert.deepEqual(first.family_ids, [FAMILY]); assert.equal(first.scope, 'family');
  assert.equal(store.list('jobs').length, 2); await drain(); assert.equal(calls.relevance.length, 0); assert.equal(calls.assess.length, 2);
  assert.equal(store.list('communications', { family_id: FAMILY }).length, 1); assert.equal(store.list('communications', { family_id: OTHER }).length, 1);
  assert.equal(calls.assess[0].family.people.every(p => p.family_id === FAMILY), true);
  event({ scope: 'global', family_ids: [], summary: 'Market update' }); await drain(); assert.equal(calls.relevance.length, 4);
});

test('facts can update without contact and rerunning a committed job does not apply changes twice', async t => {
  const { store, engine, ai, event, drain } = fixture(t);
  ai.assess = async args => ({ ...assessment(args), fact_changes: [fact()], contact: { decision: 'none', reason: 'Record only' } });
  const e = event({}, { role: 'client', family_id: FAMILY }); await drain();
  assert.equal(store.getFamily(FAMILY).facts.incomes[0].yearly, 190000); assert.equal(store.getFamily(FAMILY).version, 2); assert.equal(store.list('communications').length, 0);
  assert.equal(store.list('fact_changes')[0].effective_at, NOW); assert.equal(store.list('fact_changes')[0].status, 'self_reported');
  await engine.assess(store.list('jobs', { event_id: e.id })[0]); assert.equal(store.getFamily(FAMILY).version, 2); assert.equal(store.list('fact_changes').length, 1);
});

test('public events cannot mutate facts and bad recipient results leave no partial mutations', async t => {
  const { store, ai, event, drain } = fixture(t);
  ai.assess = async args => ({ ...assessment(args), fact_changes: [fact()] });
  event({ origin: 'public_news' }); await drain(); assert.equal(store.getFamily(FAMILY).version, 1); assert.equal(store.list('fact_proposals').length, 1); assert.equal(store.list('communications')[0].state, 'awaiting_review');
  ai.assess = async args => { const output = assessment(args, { fact_changes: [fact()] }); output.contact.person_ids = [`${OTHER}:samantha`]; return output; };
  const e = event(); await drain(); assert.equal(store.getFamily(FAMILY).version, 1); assert.equal(store.list('jobs', { event_id: e.id })[0].status, 'failed');
  assert.equal(store.list('fact_changes').length, 0); assert.equal(store.list('communications').length, 1);
});

test('conversation post-analysis verifies preferences, preserves other family, and schedules due reassessment', async t => {
  const { store, engine, ai, event, drain } = fixture(t); const otherBefore = store.getFamily(OTHER);
  ai.postAnalyze = async ({ family, conversation }) => ({ family_id: family.id, conversation_id: conversation.id, observation_additions: [{ person_id: conversation.person_id, quote: 'Please use text next time.', statement: 'Requested text contact', kind: 'explicit_request' }],
    preference_changes: [{ person_id: conversation.person_id, field_path: 'channel', new_value: 'text', evidence_ref: conversation.id, quote: 'Please use text next time.' }], fact_changes: [], open_questions: ['Is the deposit ready?'], summary: 'Prefers a text follow-up.',
    followup_proposals: [{ person_ids: [conversation.person_id], purpose: 'Check deposit question', due_at: '2090-01-06T00:00:00Z', timezone: 'America/Chicago', cancel_conditions: ['Deposit question resolved'] }] });
  event(); await drain(); const c = await engine.startConversation(store.list('communications')[0].id, { audio: false });
  await engine.turn(c.id, { text: 'Please use text next time.', audio: false, request_id: 'one' });
  await engine.turn(c.id, { text: 'Please use text next time.', audio: false, request_id: 'one' }); assert.equal(store.get('conversations', c.id).turns.length, 3);
  await Promise.all([engine.finish(c.id), engine.finish(c.id)]); assert.equal(store.list('jobs', { stage: 'post_analysis' }).length, 1); await drain();
  const family = store.getFamily(FAMILY); assert.equal(family.relationship.preferences[c.person_id].channel, 'text'); assert.equal(family.relationship.observations.length, 1);
  assert.equal(store.get('conversations', c.id).analysis_state, 'completed'); assert.equal(store.get('conversations', c.id).acoustic_status, 'not_configured'); assert.deepEqual(store.getFamily(OTHER), otherBefore);
  const followup = store.list('followups')[0]; assert.equal(followup.state, 'scheduled');
  ai.assess = async args => ({ ...assessment(args), contact: { decision: 'none', reason: 'The client already resolved this concern.' } });
  store.setClock('2090-01-06T00:00:00Z'); engine.runDue(); engine.runDue(); assert.equal(store.list('events', { origin: 'scheduler' }).length, 1); await drain();
  assert.equal(store.get('followups', followup.id).state, 'resolved'); assert.equal(store.list('communications').length, 1);
  const cancelled = engine.schedule(FAMILY, { purpose: 'Cancelled check', due_at: store.now(), cancel_conditions: ['Client declines'] }); store.patch('followups', cancelled.id, { state: 'cancelled' });
  engine.runDue(); assert.equal(store.list('events', { origin: 'scheduler' }).length, 1);
});

test('unverified preferences fail without changing memory and worker failure is visible', async t => {
  const { store, engine, ai, event, drain } = fixture(t); event(); await drain(); const c = await engine.startConversation(store.list('communications')[0].id, { audio: false });
  ai.postAnalyze = async ({ family }) => ({ family_id: family.id, preference_changes: [{ person_id: c.person_id, field_path: 'channel', new_value: 'text', quote: 'invented client quote' }] });
  await engine.finish(c.id); await drain(); assert.equal(store.get('conversations', c.id).analysis_state, 'failed'); assert.equal(store.getFamily(FAMILY).version, 1);
  ai.assess = async () => { throw new Error('temporary provider outage'); }; const e = event(); await drain(); let job = store.list('jobs', { event_id: e.id })[0]; assert.equal(job.status, 'queued'); assert.equal(job.attempts, 1);
  store.setClock('2090-01-01T00:00:06Z'); await drain(); job = store.get('jobs', job.id); assert.equal(job.status, 'failed'); assert.equal(job.attempts, 2); assert.equal(store.get('events', e.id).status, 'needs_attention');
  assert(store.list('traces').some(trace => trace.status === 'failed' && trace.message.includes('provider outage')));
});

test('newborn client reports remain proposals and advisor confirmation adds protected household identity', async t => {
  const { store, ai, event, drain } = fixture(t);
  const child = fact({ field_path: 'household.1', new_value: { first_name: 'Luna', name: null, role: 'child', age: 0 }, unit: 'person' });
  ai.assess = async args => ({ ...assessment(args), fact_changes: [child], contact: { decision: 'none', reason: 'Record family update' } });
  event({}, { role: 'client', family_id: FAMILY }); await drain(); assert.equal(store.getFamily(FAMILY).people.length, 1); assert.equal(store.list('fact_proposals').length, 1);
  event({}, { role: 'advisor' }); await drain(); const family = store.getFamily(FAMILY); assert.equal(family.people[1].id, `${FAMILY}:luna`); assert.equal(family.facts.household[1].role, 'child'); assert.equal(family.source.financial.case.household.length, 1);
});

test('superseded communication stays blocked and mode changes during speech generation prevent a new session', async t => {
  const { store, engine, voice, event, drain } = fixture(t); event(); await drain(); const c = store.list('communications')[0];
  engine.requestChanges(c.id, 'Use a shorter opening'); await assert.rejects(engine.startConversation(c.id, { audio: false }), { status: 409 }); await drain();
  const revised = store.list('communications').at(-1); let release; let started;
  const waiting = new Promise(resolve => { started = resolve; }); voice.synthesize = async () => { started(); return new Promise(resolve => { release = resolve; }); };
  const opening = engine.startConversation(revised.id); await waiting; await engine.setMode('manual', 1); release({ url: '/mock.mp3' }); await assert.rejects(opening, { status: 409 });
  assert.equal(store.list('conversations').length, 0);
});

test('concurrent starts share one session and worker tick drains a due followup without recursion', async t => {
  const { store, engine, ai, event, drain } = fixture(t); event(); await drain(); const c = store.list('communications')[0];
  const [a,b] = await Promise.all([engine.startConversation(c.id, { audio: false }), engine.startConversation(c.id, { audio: false })]); assert.equal(a.id, b.id);
  ai.assess = async args => ({ ...assessment(args), contact: { decision: 'none', reason: 'No new need' } });
  const followup = engine.schedule(FAMILY, { purpose: 'Due once', due_at: NOW, cancel_conditions: ['Resolved'] });
  engine.stopped = false; await engine.tick();
  for (let attempt=0; attempt<50 && engine.running; attempt++) await new Promise(resolve => setTimeout(resolve, 2));
  engine.stop(); assert.equal(engine.running, 0); assert.equal(store.get('followups', followup.id).state, 'resolved'); assert.equal(store.list('events', { origin: 'scheduler' }).length, 1);
});

test('advisor selects channel before approval and the channel is covered by the approved hash', async t => {
  const { store, engine, event, drain } = fixture(t); await engine.setMode('manual', 1); event(); await drain();
  const c = store.list('communications')[0]; const approved = await engine.approve(c.id, { content_version: 1, facts_hash: c.facts_hash, channel: 'text' }, { id: 'advisor' });
  assert.equal(approved.contact.channel, 'text'); assert.equal(approved.content_version, 2); assert.equal(approved.approval.channel, 'text'); assert.equal(approved.state, 'delivered');
  assert(store.list('audit_log').some(row => row.action === 'communication_channel_selected' && row.after_channel === 'text'));
  store.patch('communications', c.id, { contact: { ...approved.contact, channel: 'audio' } }); assert.equal((await engine.deliver(c.id)).state, 'awaiting_review');
});

test('explicit check-in becomes distinct grounded evidence and deduplicates before postanalysis', async t => {
  const { store, engine, ai, event, drain } = fixture(t); event(); await drain(); const c = await engine.startConversation(store.list('communications')[0].id, { audio: false });
  await engine.checkIn(c.id, { value: 'I feel worried', request_id: 'check-1' }); await engine.checkIn(c.id, { value: 'I feel worried', request_id: 'check-1' });
  const current = store.get('conversations', c.id); assert.equal(current.turns.length, 2); assert.equal(current.turns[1].evidence_kind, 'explicit_checkin'); assert.equal(current.self_report.evidence_ref, current.turns[1].id);
  ai.postAnalyze = async ({ conversation, family }) => ({ family_id: family.id, conversation_id: conversation.id, observation_additions: [{ person_id: c.person_id, kind: 'explicit_self_report', statement: 'Client reported feeling worried', quote: 'I feel worried' }], preference_changes: [], fact_changes: [], followup_proposals: [], open_questions: [] });
  await engine.finish(c.id); await drain(); assert.equal(store.getFamily(FAMILY).relationship.observations[0].kind, 'explicit_self_report');
  await assert.rejects(engine.checkIn(c.id, { value: 'Too late' }), { status: 409 });
});

test('acoustic adapter receives only customer recordings and preserves per-turn source alignment', async t => {
  const { store, engine, ai, event, drain } = fixture(t); event(); await drain(); const c = await engine.startConversation(store.list('communications')[0].id, { audio: true });
  const original = store.get('conversations', c.id); original.turns[0].audio = { audio_id: 'assistant-speech', path: '/private/assistant.mp3' };
  store.patch('conversations', c.id, { turns: [...original.turns, { id: 'customer-recording', role: 'user', person_id: c.person_id, text: 'A real response', start_ms: 4000, end_ms: 6000, audio: { audio_id: 'customer-audio', path: '/private/customer.webm', sha256: 'checksum', mime: 'audio/webm', words: [{ text: 'A', start: 0, end: 0.2 }, { text: 'response', start: 1, end: 2 }] } }] });
  const received = []; engine.acousticOptions = { env: { VOICE_ANALYSIS_PROVIDER: 'test', VOICE_ANALYSIS_MODEL: 'configured-test' }, analyzer: async input => { received.push(input); return { status: 'available', evidence_basis: ['customer-audio'], observations: [], measurements: [] }; } };
  let aggregate; ai.postAnalyze = async ({ family, acousticResult }) => { aggregate = acousticResult; return { family_id: family.id, observation_additions: [], preference_changes: [], fact_changes: [], followup_proposals: [], open_questions: [] }; };
  await engine.finish(c.id); await drain(); assert.equal(received.length, 1); assert.equal(received[0].audio.audio_id, 'customer-audio'); assert.equal(received[0].speaker_segments[0].person_id, c.person_id); assert.equal(received[0].time_mapping.audio_end_ms, 2000);
  assert(!JSON.stringify(received).includes('assistant-speech')); assert(!JSON.stringify(received).includes('facts')); assert.equal(aggregate.status, 'available'); assert.equal(aggregate.turn_results[0].turn_id, 'customer-recording');
  assert.equal(store.get('conversations', c.id).acoustic_inputs[0].audio.sha256, 'checksum');
  engine.acousticOptions.env.VOICE_ANALYSIS_PROVIDER = 'none'; const disabled = await engine.acousticEvidence(store.get('conversations', c.id)); assert.equal(disabled.status, 'not_configured'); assert.equal(received.length, 1); assert.deepEqual(disabled.measurements, []);
});

test('worker recovers a crashed unexpired lease on a later tick using wall time', async t => {
  const { store, engine, ai, event } = fixture(t); let wall = '2026-11-21T12:00:00.000Z'; engine.wallNow = () => wall;
  ai.assess = async args => ({ ...assessment(args), contact: { decision: 'none', reason: 'Record only' } });
  event(); const abandoned = store.claimJob(wall, 1000); assert.equal(abandoned.status, 'leased');
  engine.stopped = false; await engine.tick(); assert.equal(store.get('jobs', abandoned.id).status, 'leased'); assert.equal(engine.running, 0);
  wall = '2026-11-21T12:00:01.001Z'; await engine.tick();
  for(let n=0;n<20&&engine.running;n++)await new Promise(resolve=>setImmediate(resolve));
  engine.stop(); assert.equal(store.get('jobs', abandoned.id).status, 'completed'); assert.equal(store.get('jobs', abandoned.id).attempts, 2); assert.equal(store.now(), NOW);
});

test('provider retries become due while the simulation clock remains frozen', async t => {
  const { store, engine, ai, event, drain } = fixture(t); let wall = '2026-11-21T12:00:00.000Z'; engine.wallNow = () => wall; let calls = 0;
  ai.assess = async args => { if(++calls===1)throw new Error('Temporary provider error'); return { ...assessment(args), contact: { decision: 'none', reason: 'Retry succeeded' } }; };
  const e = event(); await drain(); const job = store.list('jobs', { event_id: e.id })[0]; assert.equal(job.retry_at, '2026-11-21T12:00:05.000Z'); assert.equal(job.status, 'queued');
  wall = '2026-11-21T12:00:04.999Z'; await drain(); assert.equal(calls, 1);
  wall = '2026-11-21T12:00:05.000Z'; await drain(); assert.equal(store.get('jobs', job.id).status, 'completed'); assert.equal(calls, 2); assert.equal(store.now(), NOW); assert.equal(e.observed_at, NOW);
});

test('live worker renews its own lease instead of recovering the same in-flight job', async t => {
  const { store, engine, ai, event } = fixture(t); let wall = '2026-11-21T12:00:00.000Z'; engine.wallNow = () => wall;
  let finish; let calls = 0; ai.assess = args => { calls++; return new Promise(resolve => { finish=()=>resolve({ ...assessment(args), contact: { decision: 'none', reason: 'Done' } }); }); };
  event(); engine.stopped = false; await engine.tick(); assert.equal(calls, 1);
  wall = '2026-11-21T12:04:00.000Z'; await engine.tick(); assert.equal(calls, 1); assert.equal(store.list('jobs')[0].attempts, 1);
  finish(); for(let n=0;n<20&&engine.running;n++)await new Promise(resolve=>setImmediate(resolve)); engine.stop(); assert.equal(store.list('jobs')[0].status, 'completed');
});
