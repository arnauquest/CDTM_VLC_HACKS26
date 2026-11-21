import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from './store.mjs';

function fixture(t) { const dir = mkdtempSync(join(tmpdir(), 'sherpas-store-')); let store = new Store({ dbPath: join(dir, 'test.sqlite') }).init(); t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); }); return { get store() { return store; }, reopen() { store.close(); store = new Store({ dbPath: join(dir, 'test.sqlite'), mode: 'manual' }).init(); return store; } }; }
const familyId = 'michael-carter';
const fact = (overrides = {}) => ({ field_path: 'incomes.0.yearly', new_value: 195000, unit: 'USD/year', effective_at: '2026-11-21T12:00:00Z', evidence_ref: 'client-message:salary-1', status: 'self_reported', ...overrides });

test('imports four families without rescaling USD and snapshots are immutable and hashed', t => {
  const { store } = fixture(t); const families = store.listFamilies(); assert.equal(families.length, 4);
  const f = store.getFamily(familyId); assert.equal(f.facts.incomes[0].yearly, 180000); assert.equal(f.people[0].id, 'michael-carter:michael');
  const doc = store.list('source_documents', { family_id: familyId }).find(x => x.source_path.endsWith('financial-health.json'));
  assert.equal(doc.sha256, createHash('sha256').update(readFileSync(doc.source_path)).digest('hex'));
  assert.deepEqual(JSON.parse(doc.snapshot), f.source.financial);
  assert.throws(() => store.db.prepare('UPDATE source_documents SET snapshot=? WHERE id=?').run('{}', doc.id), /immutable/);
  f.source.financial.profile.incomes[0].yearly = 1; assert.equal(store.getFamily(familyId).source.financial.profile.incomes[0].yearly, 180000);
});

test('fact updates preserve source, append history, mark projections stale and survive restart', t => {
  const fixtureStore = fixture(t); const { store } = fixtureStore;
  const updated = store.updateFamily(familyId, { expectedVersion: 1, factChanges: [fact()] });
  assert.equal(updated.version, 2); assert.equal(updated.facts.incomes[0].yearly, 195000); assert.equal(updated.projection_status, 'stale');
  assert.equal(updated.source.financial.profile.incomes[0].yearly, 180000);
  const history = store.list('fact_changes', { family_id: familyId }); assert.equal(history[0].old_value, 180000); assert.equal(history[0].new_value, 195000);
  assert.throws(() => store.patch('fact_changes', history[0].id, { new_value: 0 }), { code: 'IMMUTABLE_RECORD' });
  const reopened = fixtureStore.reopen(); assert.equal(reopened.getFamily(familyId).facts.incomes[0].yearly, 195000); assert.equal(reopened.getPolicy().mode, 'auto');
});

test('invalid facts and stale writers roll back atomically', t => {
  const { store } = fixture(t);
  for (const bad of [fact({ field_path: 'household.0.risk_profile', new_value: 'Conservative' }), fact({ field_path: '__proto__.polluted' }), fact({ new_value: Infinity }), fact({ new_value: -50 }), fact({ unit: 'cents' }), fact({ field_path: 'source.financial.profile.incomes.0.yearly' }), fact({ field_path: 'incomes.0.owner', new_value: ['Samantha'] }), fact({ field_path: 'incomes.2', new_value: { name: 'Fake', yearly: 5, risk_profile: 'High' } })]) {
    assert.throws(() => store.updateFamily(familyId, { expectedVersion: 1, factChanges: [fact(), bad] }), { status: 422 });
    assert.equal(store.getFamily(familyId).version, 1); assert.equal(store.list('fact_changes').length, 0);
  }
  assert.throws(() => store.updateFamily(familyId, { expectedVersion: 0, factChanges: [fact()] }), { status: 409 });
  assert.equal({}.polluted, undefined);
  const disputed = store.updateFamily(familyId, { expectedVersion: 1, factChanges: [fact({ status: 'needs_confirmation' })] });
  assert.equal(disputed.facts.incomes[0].yearly, 180000); assert.equal(store.list('fact_changes')[0].applied, false);
});

test('append supports a new income record without sparse arrays', t => {
  const { store } = fixture(t);
  const f = store.updateFamily(familyId, { expectedVersion: 1, factChanges: [fact({ field_path: 'incomes.2', new_value: { name: 'Consulting', type: 'OTHER_INCOME', yearly: 12000, owner: ['Michael'], starts: 2026, ends: 2027 } })] });
  assert.equal(f.facts.incomes[2].yearly, 12000);
  assert.throws(() => store.updateFamily(familyId, { expectedVersion: 2, factChanges: [fact({ field_path: 'incomes.10', new_value: {} })] }), { status: 422 });
});

test('relationship memory deduplicates evidence and scopes persons and recent conversations', t => {
  const { store } = fixture(t);
  const observation = { person_id: 'michael-carter:michael', conversation_id: 'conversation-1', kind: 'expressed_concern', statement: 'Concerned about the home deposit', transcript_span: { start_ms: 1, end_ms: 5 } };
  store.updateFamily(familyId, { expectedVersion: 1, observations: [observation, observation], preferenceChanges: [{ person_id: observation.person_id, key: 'channel', value: 'browser_voice', explicit_request: true }] });
  assert.equal(store.getFamily(familyId).relationship.observations.length, 1);
  assert.equal(store.getFamily(familyId).relationship.preferences[observation.person_id].channel, 'browser_voice');
  assert.throws(() => store.updateFamily(familyId, { expectedVersion: 2, observations: [{ ...observation, person_id: 'samantha-lewis:samantha' }] }), { status: 422 });
  for (let n = 0; n < 5; n++) store.put('conversations', { id: `conversation-${n}`, family_id: familyId });
  store.put('conversations', { family_id: 'samantha-lewis', transcript: 'private other family' });
  const context = store.context(familyId); assert.equal(context.recent_conversations.length, 3); assert.deepEqual(context.recent_conversations.map(x => x.id), ['conversation-2','conversation-3','conversation-4']);
  assert(!JSON.stringify(context).includes('private other family')); assert.equal(context.currency, 'USD');
});

test('generic entities deduplicate, preserve identifiers and rollback nested writes', t => {
  const { store } = fixture(t); const event = store.put('events', { family_id: familyId, dedupe_key: 'event1' });
  assert.equal(store.put('events', { dedupe_key: 'event1' }).id, event.id);
  assert.throws(() => store.patch('events', event.id, { id: 'new' }), { status: 422 });
  assert.throws(() => store.patch('events', event.id, { family_id: 'another' }), { status: 422 });
  assert.throws(() => store.patch('events', event.id, { summary: 'stale' }, { expectedVersion: 0 }), { status: 409 });
  assert.throws(() => store.transaction(() => { store.put('jobs', { id: 'rolled-back' }); throw new Error('fail'); }), /fail/);
  assert.equal(store.get('jobs', 'rolled-back'), null);
});

test('durable job leases recover after restart and respect retry time', t => {
  const fx = fixture(t); const { store } = fx; const now = store.now();
  store.put('jobs', { id: 'job-1', status: 'queued', attempts: 0, retry_at: now });
  store.put('jobs', { id: 'job-2', status: 'queued', retry_at: '2099-01-01T00:00:00Z' });
  const job = store.claimJob(now, 1000); assert.equal(job.id, 'job-1'); assert.equal(job.attempts, 1); assert.equal(job.status, 'leased');
  assert.equal(store.claimJob(now), null);
  const reopened = fx.reopen(); assert.equal(reopened.recoverJobs(new Date(Date.parse(now)+500).toISOString()).length, 0);
  assert.equal(reopened.recoverJobs(new Date(Date.parse(now)+1001).toISOString()).length, 1);
  assert.equal(reopened.claimJob(new Date(Date.parse(now)+1001).toISOString()).attempts, 2);
});

test('policy and simulation clock persist and reject stale/backwards updates', t => {
  const fx = fixture(t); const { store } = fx;
  assert.deepEqual(store.setPolicy('manual', 1), { mode: 'manual', version: 2 });
  assert.throws(() => store.setPolicy('auto', 1), { status: 409 });
  assert.equal(store.setClock('2090-01-01T00:00:00Z'), '2090-01-01T00:00:00.000Z');
  assert.throws(() => store.setClock('2089-01-01T00:00:00Z'), { status: 422 });
  const reopened = fx.reopen(); assert.equal(reopened.now(), '2090-01-01T00:00:00.000Z'); assert.equal(reopened.getPolicy().mode, 'manual');
});

test('new debt preserves dollar and ratio units, supports unknown values, and protects owners', t => {
  const { store } = fixture(t);
  const debt = { name: 'New car loan', type: 'AUTO_LOAN', balance: 22000, interest_rate: 0.06, monthly_payment: null, owner: ['Michael'] };
  const change = fact({ field_path: 'liabilities.3', new_value: debt, unit: 'USD; rates=ratio' });
  for (const bad of [{ ...debt, owner: ['Samantha'] }, { ...debt, owner: [] }, { ...debt, interest_rate: 6 }, { ...debt, balance: '22000' }, { ...debt, id: 'overwrite' }]) {
    assert.throws(() => store.updateFamily(familyId, { expectedVersion: 1, factChanges: [{ ...change, new_value: bad }] }), { status: 422 });
  }
  assert.throws(() => store.updateFamily(familyId, { expectedVersion: 1, factChanges: [{ ...change, unit: 'USD' }] }), { status: 422 });
  const updated = store.updateFamily(familyId, { expectedVersion: 1, factChanges: [change] });
  assert.equal(updated.facts.liabilities[3].balance, 22000); assert.equal(updated.facts.liabilities[3].interest_rate, 0.06); assert.equal(updated.source.financial.profile.liabilities.length, 3);
  assert.throws(() => store.updateFamily(familyId, { expectedVersion: 2, factChanges: [fact({ field_path: 'liabilities.3.monthly_payment', new_value: '500', unit: 'USD/month' })] }), { status: 422 });
  const completed = store.updateFamily(familyId, { expectedVersion: 2, factChanges: [fact({ field_path: 'liabilities.3.monthly_payment', new_value: 500, unit: 'USD/month' })] });
  assert.equal(completed.facts.liabilities[3].monthly_payment, 500); assert.equal(store.list('fact_changes').at(-1).old_value, null);
  assert.throws(() => store.updateFamily(familyId, { expectedVersion: 3, factChanges: [fact({ field_path: 'liabilities.3.interest_rate', new_value: 0.07, unit: 'USD; rates=ratio' })] }), { status: 422 });
  assert.throws(() => store.updateFamily(familyId, { expectedVersion: 3, factChanges: [fact({ field_path: 'liabilities.3.owner', new_value: ['Samantha'] })] }), { status: 422 });
});

test('resolved and evaluated followups are excluded from pending family context', t => {
  const { store } = fixture(t);
  for (const state of ['scheduled','pending_date','resolved','evaluated','cancelled','completed']) store.put('followups', { family_id: familyId, state });
  assert.deepEqual(store.context(familyId).pending_followups.map(f => f.state), ['scheduled','pending_date']);
});
