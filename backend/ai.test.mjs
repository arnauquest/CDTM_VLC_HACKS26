import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { createAI, compactFamily } from './ai.mjs';
import { createAgentRunner, childEnvironment, executeProcess, parseFinal } from './agents/runner.mjs';
import { assessmentSchema, validateSchema } from './agents/contracts.mjs';
import { Store } from './store.mjs';

const family = { id: 'synthetic-family', version: 2, people: [{ id: 'p1', name: 'Test Person' }], facts: { incomes: [{ yearly: 50000 }] }, source: {}, relationship: { observations: [], open_questions: [] } };
const event = { id: 'e1', origin: 'public_news', summary: 'Synthetic event', source_refs: ['source1'] };
const policy = { mode: 'auto', version: 3 };
const now = '2026-11-21T12:00:00Z';
const emptyDraft = { text: '', voice_script: '', permitted_fact_refs: [], conversation_objectives: [], anticipated_questions_and_answers: [], conversation_branches: [], questions_to_ask: [], response_boundaries: [], escalation_conditions: [], handoff_response: '' };
const assessment = () => ({ family_id: family.id, expected_state_version: 2, policy_version: 3, fact_changes: [], evidence_refs: [], missing_information: [], contact: { decision: 'none', reason: 'No relevant change.', urgency: 'low', requires_review: false, review_reasons: [], review_lane: 'none', channel: 'text', person_ids: ['p1'], purpose: '' }, followup_proposals: [], draft: { ...emptyDraft } });
const postOutput = () => ({ conversation_id: 'c1', family_id: family.id, expected_state_version: 2, observation_additions: [{ person_id: 'p1', conversation_id: 'c1', kind: 'expressed_concern', statement: 'Concern about deposit.', quote: 'I am worried about my deposit.', transcript_span: null, acoustic_evidence_ref: null, confirmed_by_client: true, context_event_id: 'e1' }], preference_changes: [], fact_changes: [], open_questions: ['Deposit funding?'], summary: 'Concern about deposit funding.', followup_proposals: [] });
const conversation = { id: 'c1', person_id: 'p1', turns: [{ role: 'user', text: 'I am worried about my deposit.' }, { role: 'assistant', text: 'You have a million dollars.' }] };
const runner = output => async () => ({ output, provider: 'test', model: 'test', latency_ms: 1 });

test('Decisions uses named real predicates, preserves probabilities, and discards only when all are low', async () => {
  let request;
  const ai = createAI({ env: {}, router: { request: async (path, options) => {
    request = { path, ...options };
    return { response: { json: async () => ({ model: 'actual-model', answers: ['insufficient_evidence', 'financial_relevance', 'relationship_relevance'].map(name => ({ type: 'predicate', name, probability: 0.05 })) }) }, credential: 'primary' };
  } } });
  const result = await ai.relevance({ event, family });
  assert.equal(request.path, '/v1/decisions'); assert.equal(request.body.questions.length, 3);
  assert.equal(result.route, 'discard'); assert.equal(result.probabilities.financial_relevance, 0.05);
  assert.equal(result.calibration, 'provisional_not_evaluated');
});

test('missing or refused Decisions result stays null and routes to assessment', async () => {
  const ai = createAI({ env: {}, router: { request: async () => ({ response: { json: async () => ({ answers: [{ type: 'predicate', name: 'financial_relevance', probability: 0 }, { type: 'refusal', name: 'relationship_relevance' }] }) } }) } });
  const result = await ai.relevance({ event, family });
  assert.equal(result.route, 'assess'); assert.equal(result.probabilities.relationship_relevance, null); assert.equal(result.probabilities.insufficient_evidence, null);
});

test('provider errors propagate without fabricated analysis', async () => {
  const ai = createAI({ env: {}, runner: async () => { throw new Error('provider_unavailable'); } });
  await assert.rejects(ai.assess({ event, family, policy, now }), /provider_unavailable/);
});

test('strict schema, scope and version validation protect assigned family', async () => {
  const good = assessment(); validateSchema(good, assessmentSchema);
  for (const mutate of [value => { value.family_id = 'other'; }, value => { value.expected_state_version++; }, value => { value.contact.person_ids = ['foreign']; }, value => { value.contact.decision = 'send'; }, value => { value.policy_version++; }]) {
    const invalid = assessment(); mutate(invalid);
    await assert.rejects(createAI({ env: {}, runner: runner(invalid) }).assess({ event, family, policy, now }));
  }
  assert.equal((await createAI({ env: {}, runner: runner(good) }).assess({ event, family, policy, now })).family_id, family.id);
});

test('postanalysis rejects invented spans, assistant quotes and acoustic evidence without audio', async () => {
  const args = { conversation, event, family, policy, now, acousticResult: { status: 'not_configured' } };
  const good = await createAI({ env: {}, runner: runner(postOutput()) }).postAnalyze(args);
  assert.equal(good.acoustic_status, 'not_configured');
  for (const mutate of [value => { value.quote = 'You have a million dollars.'; }, value => { value.transcript_span = { start_ms: 0, end_ms: 500 }; }, value => { value.acoustic_evidence_ref = 'invented'; }, value => { value.person_id = 'foreign'; }]) {
    const invalid = postOutput(); mutate(invalid.observation_additions[0]);
    await assert.rejects(createAI({ env: {}, runner: runner(invalid) }).postAnalyze(args));
  }
});

test('context retains original profiles while trimming long projection arrays', () => {
  const context = compactFamily({ ...family, source: { persona: { concern: 'deposit' }, investment: { holdings: ['fund'] }, financial: { projections: Array.from({ length: 100 }, (_, year) => ({ year })) } } });
  assert.equal(context.source.persona.concern, 'deposit'); assert.deepEqual(context.source.investment.holdings, ['fund']);
  assert.equal(context.source.financial.projections.original_length, 100);
});

test('Codex job gets private workspace, structured input, absolute executable, no API credentials', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'sherpas-agent-test-'));
  try {
    const env = { PATH: process.env.PATH, AGENT_PROVIDER: 'codex', CODEX_BIN: process.execPath, OPENAI_API_KEY: 'secret-a', OPENAI_API_KEY_FALLBACK: 'secret-b', CODEX_API_KEY: 'secret-c', CODEX_ACCESS_TOKEN: 'secret-d', ELEVENLABS_API_KEY: 'secret-e', GEMINI_API_KEY: 'secret-f', CODEX_HOME: '/subscription/login' };
    const run = createAgentRunner({ rootDir, env, processRunner: async options => {
      assert.ok(isAbsolute(options.executable)); assert.equal(options.env.CODEX_HOME, '/subscription/login');
      assert.equal(Object.keys(options.env).filter(name => /API_KEY|ACCESS_TOKEN/.test(name)).length, 0);
      assert.ok(options.args.includes('--ignore-user-config')); assert.ok(options.args.includes('--ephemeral'));
      assert.equal(options.args[options.args.indexOf('--sandbox') + 1], 'read-only');
      assert.equal((await stat(options.cwd)).mode & 0o777, 0o700);
      assert.deepEqual(JSON.parse(await readFile(join(options.cwd, 'input.json'))), { family_id: family.id });
      assert.ok(options.stdin.includes('OUTPUT_SCHEMA'));
      return { stdout: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(assessment()) } }), stderr: '' };
    } });
    const output = await run({ stage: 'assessment', input: { family_id: family.id }, schema: assessmentSchema, prompt: 'Test only.' });
    assert.equal(output.output.family_id, family.id);
  } finally { await rm(rootDir, { recursive: true, force: true }); }
});

test('process timeout and output caps terminate failed runners', async () => {
  const base = { executable: process.execPath, cwd: tmpdir(), env: childEnvironment(process.env), stdin: '', maxOutputBytes: 1000 };
  await assert.rejects(executeProcess({ ...base, args: ['-e', 'setTimeout(()=>{},10000)'], timeoutMs: 30 }), /agent_timeout/);
  await assert.rejects(executeProcess({ ...base, args: ['-e', 'process.stdout.write("x".repeat(5000))'], timeoutMs: 1000 }), /agent_output_limit/);
});

test('alternative adapters extract structured final output', () => {
  assert.deepEqual(parseFinal('claude', JSON.stringify({ structured_output: { ok: true } })), { ok: true });
  assert.deepEqual(parseFinal('opencode', JSON.stringify({ type: 'text', part: { text: '{"ok":true}' } })), { ok: true });
});

test('new debt records preserve unknown values and reject arbitrary fields or foreign ownership', async () => {
  const make = () => ({ ...assessment(), fact_changes: [{ person_id: 'p1', field_path: 'liabilities.0',
    new_value: { name: 'New reported loan', type: null, balance: 22000, interest_rate: 0.06, monthly_payment: null, owner: ['Test Person'] },
    unit: 'USD; rates=ratio', effective_at: null, evidence_ref: 'e1', status: 'self_reported' }] });
  const good = await createAI({ env: {}, runner: runner(make()) }).assess({ event, family, policy, now });
  assert.equal(good.fact_changes[0].new_value.monthly_payment, null);
  for (const mutate of [value => { value.new_value.secret_role = 'admin'; }, value => { value.new_value.owner = []; },
    value => { value.new_value.owner = ['Other family']; }, value => { value.field_path = 'accounts.0'; }, value => { value.evidence_ref = ''; }]) {
    const invalid = make(); mutate(invalid.fact_changes[0]);
    await assert.rejects(createAI({ env: {}, runner: runner(invalid) }).assess({ event, family, policy, now }));
  }
});

test('all real family contexts remain bounded with long histories and no recursive bundles', async () => {
  const store = new Store().init();
  try {
    for (const item of store.listFamilies()) {
      const current = store.context(item.id), personId = current.people[0].id;
      const hugeTurns = Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, role: i % 2 ? 'assistant' : 'user', text: 'evidence '.repeat(700), person_id: personId }));
      const large = { ...current,
        relationship: { ...current.relationship, summary: 'summary '.repeat(2000),
          observations: Array.from({ length: 300 }, (_, i) => ({ id: `o${i}`, person_id: personId, statement: 'statement '.repeat(400), quote: 'quote '.repeat(400) })),
          open_questions: Array(100).fill('question '.repeat(100)) },
        recent_conversations: Array.from({ length: 20 }, (_, i) => ({ id: `old${i}`, turns: hugeTurns, bundle: { recursive: 'not included '.repeat(100000) } })),
        recent_communications: Array.from({ length: 20 }, (_, i) => ({ id: `comm${i}`, draft: { text: 'draft '.repeat(2000) }, assessment: { recursive: 'not included '.repeat(100000) } })),
        pending_followups: Array.from({ length: 100 }, (_, i) => ({ id: `follow${i}`, purpose: 'purpose '.repeat(200), cancel_conditions: Array(20).fill('condition '.repeat(100)) })),
      };
      const compact = compactFamily(large);
      assert.deepEqual(compact.facts, current.facts);
      assert.deepEqual(compact.source.financial.profile, current.source.financial.profile);
      assert.deepEqual(compact.source.investment.positions, current.source.investment.positions);
      assert.equal(compact.recent_conversations.length, 3);
      assert.equal(compact.recent_conversations[0].bundle, undefined);
      assert.equal(compact.recent_communications[0].assessment, undefined);
      const inputs = [];
      const ai = createAI({ env: {}, runner: async ({ input, stage }) => {
        inputs.push(input);
        const output = stage === 'assessment' ? { ...assessment(), family_id: current.id, expected_state_version: current.version, contact: { ...assessment().contact, person_ids: [personId] } }
          : { ...postOutput(), family_id: current.id, expected_state_version: current.version, observation_additions: [] };
        return { output, provider: 'test', model: 'test' };
      } });
      await ai.assess({ family: large, event, policy, now });
      await ai.postAnalyze({ family: large, event, policy, now, conversation: { id: 'c1', person_id: personId, turns: hugeTurns, bundle: emptyDraft }, acousticResult: { status: 'not_configured' } });
      for (const input of inputs) {
        assert.ok(JSON.stringify(input).length < 180000, current.id);
        assert.equal(input.family_context.recent_conversations, undefined);
        assert.equal(input.family_context.fact_evidence, undefined);
      }
      assert.equal(inputs[1].family_context.relationship, undefined);
      assert.ok(inputs[1].transcript_with_speakers.length < hugeTurns.length);
    }
  } finally { store.close(); }
});
