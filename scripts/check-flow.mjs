import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../backend/store.mjs';
import { Engine } from '../backend/engine.mjs';
import { createAI } from '../backend/ai.mjs';
import { createVoice } from '../backend/voice.mjs';
import { createOpenAIRouterFromEnv } from '../config/openai-failover.mjs';

// Live, paid-provider check. Never opens or modifies the application's database.
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resumeIndex = process.argv.indexOf('--resume');
const resumeId = resumeIndex >= 0 ? process.argv[resumeIndex + 1] : null;
if (resumeIndex >= 0 && !/^[a-f0-9-]{36}$/.test(resumeId || '')) throw new Error('Valid run UUID required after --resume');
const runId = resumeId || randomUUID();
const runDir = resolve(rootDir, 'var/check-flow', runId);
await mkdir(runDir, { recursive: true, mode: 0o700 });
const env = { ...process.env, AGENT_WORKSPACES_DIR: resolve(runDir, 'agents') };
const store = new Store({ dbPath: resolve(runDir, 'flow.sqlite3'),
  casesDir: resolve(rootDir, env.SHERPAS_CASES_DIR || '../../referencias/sherpas/recursos-oficiales/cases'), mode: 'auto' }).init();
const report = { run_id: runId, started_at: new Date().toISOString(), status: 'running', steps: [] };
const output = (stage, details = {}) => {
  const entry = { stage, ...details };
  report.steps.push(entry);
  if (stage === 'flow' && ['passed', 'failed'].includes(details.status)) report.status = details.status;
  console.log(JSON.stringify(entry));
};
const trace = event => {
  store.trace({ stage: event.stage || event.operation || 'provider', status: String(event.status || 'info'), message: 'Live check provider activity', ...event });
  if (['started', 'completed', 'failed'].includes(event.status)) output(event.stage || event.operation || 'provider', { status: event.status, provider: event.provider, latency_ms: event.latency_ms });
};
let engine;
try {
  const router = createOpenAIRouterFromEnv(env, { onEvent: event => trace({ stage: 'openai_routing', status: 'completed', credential: event.label }) });
  const ai = createAI({ rootDir, env, router, trace });
  const voice = createVoice({ rootDir, env, router, trace });
  engine = new Engine({ store, ai, voice, concurrency: 1 });
  const family = store.getFamily('michael-carter');
  const person = family.people[0];
  const initialSource = JSON.stringify(family.source);
  const initialFacts = JSON.stringify(family.facts);
  const event = engine.createEvent({ origin: 'client_message', scope: 'family', family_ids: [family.id], kind: 'communication_preference',
    summary: 'Michael asks for a short conversation now to choose his preferred follow-up channel and discuss an unresolved question about funding his future home deposit. Please ask which channel and timing he wants; he is not asking for investment advice or financial changes.',
    payload: { person_id: person.id }, simulated: true, dedupe_key: `live-check:${runId}` }, { role: 'system' });
  async function runQueued(stage, conversationId) {
    const job = store.claimJob(store.now(), 180000);
    assert.ok(job, `Missing ${stage} job`);
    assert.equal(job.stage, stage);
    if (conversationId) assert.equal(job.conversation_id, conversationId);
    await engine.runJob(job);
    const done = store.get('jobs', job.id);
    if (done.status !== 'completed') throw new Error(`${stage}_job_failed: ${done.error || done.status}`);
    return done;
  }
  output('flow', { status: 'started', run_id: runId, family_id: family.id });
  if (!store.list('jobs', { event_id: event.id }).some(job => job.stage === 'assessment' && job.status === 'completed')) await runQueued('assessment');
  assert.equal(store.list('assessments', { event_id: event.id }).some(row => row.kind === 'relevance'), false, 'Directed events must bypass Decisions');
  let communication = store.list('communications', { event_id: event.id })[0];
  assert.ok(communication, 'Agent chose no immediate contact for explicit conversation request');
  if (communication.state === 'awaiting_review') communication = await engine.approve(communication.id,
    { content_version: communication.content_version, facts_hash: communication.facts_hash }, { role: 'advisor', id: 'live-check-advisor' });
  assert.ok(['delivered', 'completed'].includes(communication.state));
  output('delivery', { status: 'passed', authorization: communication.authorization_kind });
  const conversation = store.list('conversations', { communication_id: communication.id })[0] || await engine.startConversation(communication.id, { person_id: person.id, audio: false });
  if (conversation.state !== 'completed') {
    const turn = await engine.turn(conversation.id, { audio: false, request_id: `turn:${runId}`,
      text: 'Please use text messages for my follow-ups, and contact me again in five days. My timezone is America/Chicago. I am still concerned about how to fund my home deposit; I will gather my figures before then.' });
    assert.ok(turn.reply.text.trim());
    assert.equal(turn.conversation.turns.filter(item => item.role === 'user').length, 1);
    await engine.finish(conversation.id);
  }
  if (store.get('conversations', conversation.id).analysis_state !== 'completed') await runQueued('post_analysis', conversation.id);
  const analyzed = store.get('conversations', conversation.id);
  assert.equal(analyzed.analysis_state, 'completed');
  assert.equal(analyzed.acoustic_status, 'not_configured');
  const updated = store.getFamily(family.id);
  assert.equal(JSON.stringify(updated.source), initialSource, 'Original sources must remain immutable');
  assert.equal(JSON.stringify(updated.facts), initialFacts, 'Channel preferences must not change financial facts');
  assert.ok(updated.version > communication.assessment.expected_state_version, 'Relationship changes must advance the version');
  assert.ok(updated.relationship.observations.some(row => row.conversation_id === conversation.id));
  const followups = store.list('followups', { conversation_id: conversation.id });
  const followup = followups.find(row => row.state === 'scheduled');
  assert.ok(followup, 'Explicit five-day request must produce a dated follow-up');
  assert.equal(followup.timezone, 'America/Chicago');
  const requestedAt = analyzed.turns.find(turn => turn.role === 'user').created_at;
  assert.ok(Math.abs(Date.parse(followup.due_at) - Date.parse(requestedAt) - 5 * 86400000) < 60000, 'Follow-up must honor five days from the actual client request');
  assert.ok(followup.cancel_conditions.length);
  output('post_analysis', { status: 'passed', observations: updated.relationship.observations.length, followups: followups.length, acoustic_status: analyzed.acoustic_status });
  store.setClock(followup.due_at);
  engine.runDue();
  engine.runDue();
  const due = store.get('followups', followup.id);
  assert.equal(due.state, 'evaluating');
  const scheduledEvent = store.get('events', due.evaluation_event_id);
  assert.equal(scheduledEvent.origin, 'scheduler');
  assert.equal(scheduledEvent.scope, 'family');
  assert.deepEqual(scheduledEvent.family_ids, [family.id]);
  assert.deepEqual(scheduledEvent.payload.cancel_conditions, followup.cancel_conditions);
  assert.equal(store.list('jobs', { event_id: scheduledEvent.id }).length, 1, 'Scheduler must not duplicate an evaluation');
  output('scheduler', { status: 'passed', evaluation_jobs: 1, model_reevaluation: 'queued_not_run' });
  output('flow', { status: 'passed', run_id: runId, database: `var/check-flow/${runId}/flow.sqlite3` });
} catch (error) {
  let message = String(error.message || 'Live check failed');
  for (const [key, value] of Object.entries(env)) if (value && /KEY|TOKEN|SECRET/.test(key)) message = message.split(value).join('[redacted]');
  output('flow', { status: 'failed', run_id: runId, error: message.slice(0, 500) });
  process.exitCode = 1;
} finally {
  engine?.stop();
  store.close();
  report.completed_at = new Date().toISOString();
  await writeFile(resolve(runDir, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  await writeFile(resolve(rootDir, 'var/check-flow/latest.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
}
