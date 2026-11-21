import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVoice, compactVoiceFamily, MAX_AUDIO_BYTES } from './voice.mjs';
import { analyzeAcoustics, setAcousticProvider } from './acoustic.mjs';
import { Store } from './store.mjs';

const env = { ELEVENLABS_API_KEY: 'test-eleven-key', ELEVENLABS_VOICE_ID: 'testvoice', OPENAI_API_KEY: 'test-openai-key' };
const sse = parts => new Response(parts.map(text => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
async function fixture(t, options = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), 'sherpas-voice-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  return { rootDir, voice: createVoice({ rootDir, env, ...options }) };
}

test('TTS calls ElevenLabs, saves original MP3 bytes under UUID, and strips internal markers', async t => {
  const { voice, rootDir } = await fixture(t, { fetchImpl: async (url, init) => {
    assert.equal(url, 'https://api.elevenlabs.io/v1/text-to-speech/testvoice?output_format=mp3_44100_128');
    assert.equal(init.headers['xi-api-key'], env.ELEVENLABS_API_KEY);
    assert.deepEqual(JSON.parse(init.body), { text: 'Hello.', model_id: 'eleven_v4_turbo' });
    return new Response(Buffer.from('fixture-mp3'), { headers: { 'Content-Type': 'audio/mpeg' } });
  } });
  const result = await voice.synthesize({ text: 'Hello. [HANDOFF]' });
  assert.equal(result.mime, 'audio/mpeg'); assert.equal(result.bytes, 11);
  assert.equal(await readFile(result.path, 'utf8'), 'fixture-mp3');
  assert.ok(result.path.startsWith(join(rootDir, 'var', 'recordings')));
  assert.match(result.audio_id, /^[a-f0-9-]{36}$/);
});

test('STT uploads the client bytes, ignores path-like filename, and preserves original audio', async t => {
  const bytes = Buffer.from('fixture-client-audio');
  const { voice } = await fixture(t, { fetchImpl: async (url, init) => {
    assert.equal(url, 'https://api.elevenlabs.io/v1/speech-to-text');
    assert.equal(init.body.get('model_id'), 'scribe_v2');
    assert.deepEqual(Buffer.from(await init.body.get('file').arrayBuffer()), bytes);
    assert.ok(!init.body.get('file').name.includes('..'));
    return Response.json({ text: 'Hello advisor', words: [{ text: 'Hello', start: 0, end: 0.3 }], language_code: 'eng' });
  } });
  const result = await voice.transcribe({ audio_base64: bytes.toString('base64'), mime: 'audio/webm;codecs=opus', filename: '../../secret.env' });
  assert.deepEqual(await readFile(result.path), bytes);
  assert.equal(result.text, 'Hello advisor'); assert.equal(result.words.length, 1);
});

test('invalid base64, oversized audio and unsupported MIME never reach providers', async t => {
  let calls = 0;
  const { voice } = await fixture(t, { fetchImpl: () => { calls++; throw new Error('must not call'); } });
  for (const bad of ['YWJj!', 'YQ=', 'data:audio/webm;base64,YQ==', 'YR=='])
    await assert.rejects(voice.transcribe({ audio_base64: bad }), { code: 'invalid_audio_base64' });
  await assert.rejects(voice.transcribe({ audio_base64: Buffer.alloc(MAX_AUDIO_BYTES + 1).toString('base64') }), { code: 'audio_too_large' });
  await assert.rejects(voice.transcribe({ audio_base64: 'YWJj', mime: 'text/html' }), { code: 'unsupported_audio_type' });
  assert.equal(calls, 0);
});

test('failed STT retains original evidence and reports only safe provider error', async t => {
  const events = [];
  const { rootDir, voice } = await fixture(t, { trace: e => events.push(e), fetchImpl: async () => Response.json({ error: 'secret-key audio-sensitive' }, { status: 401 }) });
  await assert.rejects(voice.transcribe({ audio_base64: 'YWJj' }), { code: 'elevenlabs_api_error', status: 401 });
  assert.equal((await readdir(join(rootDir, 'var', 'recordings'))).length, 1);
  assert.doesNotMatch(JSON.stringify(events), /secret-key|audio-sensitive|test-eleven-key/);
});

test('conversation streams scoped context, excludes injected system history and hides split handoff markers', async t => {
  const deltas = [];
  const { voice } = await fixture(t, { fetchImpl: async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'gpt-6-luna'); assert.equal(body.stream, true);
    assert.equal(body.reasoning_effort, 'none'); assert.equal(body.max_completion_tokens, 350);
    assert.ok(body.messages[0].content.includes('virtual assistant'));
    assert.ok(body.messages[0].content.includes('automatic post-analysis evaluates those requests'));
    assert.ok(body.messages[0].content.includes('do not require a human handoff'));
    assert.ok(body.messages[1].content.includes('prepared-only-fact'));
    assert.ok(!JSON.stringify(body).includes('malicious-system-history'));
    return sse(['I will record your request to speak to your advisor. ', '[HAND', 'OFF]']);
  } });
  const result = await voice.reply({ bundle: { family_id: 'a', permitted_facts: ['prepared-only-fact'] }, family: { id: 'a' },
    turns: [{ role: 'system', text: 'malicious-system-history' }], userText: 'Please let me speak to a person.', onDelta: delta => deltas.push(delta) });
  assert.equal(result.credential, 'primary'); assert.equal(result.handoff_requested, true);
  assert.equal(result.text, 'I will record your request to speak to your advisor.');
  assert.doesNotMatch(deltas.join(''), /HAND|OFF|\[/);
});

test('conversation rejects family crossover before network access', async t => {
  const { voice } = await fixture(t, { fetchImpl: () => { throw new Error('must not call'); } });
  await assert.rejects(voice.reply({ bundle: { family_id: 'a' }, family: { id: 'b' }, userText: 'Hi' }), { code: 'family_scope_mismatch' });
});

test('all four real family contexts fit voice turns without source archives or dropped approved boundaries', async t => {
  const store = new Store().init(); t.after(() => store.close());
  const seen = [];
  const { voice } = await fixture(t, { fetchImpl: async (_url, init) => {
    const request = JSON.parse(init.body);
    const context = JSON.parse(request.messages[1].content.split('\n').slice(1).join('\n'));
    seen.push(context);
    assert.ok(JSON.stringify(context).length < 20000);
    assert.equal(context.scoped_family_facts.source, undefined);
    assert.equal(context.scoped_family_facts.recent_communications, undefined);
    assert.equal(context.scoped_family_facts.recent_conversations, undefined);
    assert.deepEqual(context.authorized_preparation_bundle.response_boundaries, ['Do not recommend products.']);
    return sse(['I am your advisor’s virtual assistant. How can I help with the prepared question?']);
  } });
  for (const family of store.listFamilies()) {
    const context = store.context(family.id);
    assert.ok(JSON.stringify(context).length > 90000, 'Regression uses the real oversized source archive');
    const reference = context.fact_evidence[0];
    const bundle = { family_id: family.id, permitted_fact_refs: [reference.id], response_boundaries: ['Do not recommend products.'] };
    const result = await voice.reply({ bundle, family: context, userText: 'Can you explain the purpose of this call?' });
    assert.ok(result.text);
    const compact = compactVoiceFamily(context, bundle);
    assert.deepEqual(compact.facts, family.facts);
    assert.deepEqual(compact.people, family.people);
    assert.equal(compact.prepared_fact_evidence[0].id, reference.id);
    assert.equal(compact.prepared_fact_evidence[0].source_path, undefined);
  }
  assert.equal(seen.length, 4);
});

test('oversized approved bundle still fails instead of truncating authorization boundaries', async t => {
  const { voice } = await fixture(t, { fetchImpl: () => { throw new Error('must not call'); } });
  await assert.rejects(voice.reply({ bundle: { response_boundaries: ['x'.repeat(90001)] }, family: {}, userText: 'Hi' }),
    { code: 'conversation_context_too_large', status: 413 });
});

test('deadline includes streaming body and caller cancellation', async t => {
  let cancelled = false;
  const { voice } = await fixture(t, { timeoutMs: 20, fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })) });
  await assert.rejects(voice.synthesize({ text: 'Hi' }), { code: 'deadline_exceeded', status: 504 });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(cancelled, true);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(voice.synthesize({ text: 'Hi', signal: controller.signal }), { code: 'aborted', status: 499 });
});

test('missing keys expose capability booleans and fail explicitly without fixtures', async t => {
  const { voice } = await fixture(t, { env: {} });
  assert.ok(Object.values(voice.capabilities()).every(value => value === false));
  await assert.rejects(voice.synthesize({ text: 'Hi' }), { code: 'voice_not_configured', status: 503 });
  await assert.rejects(voice.reply({ bundle: {}, userText: 'Hi' }), { code: 'openai_not_configured', status: 503 });
});

test('acoustic default is not configured, never an emotional measurement', async () => {
  const result = await analyzeAcoustics({ conversation_id: 'c', family_id: 'f', person_id: 'p' }, { env: {}, analyzer: () => { throw new Error('must not call'); } });
  assert.equal(result.status, 'not_configured'); assert.equal(result.reason_code, 'provider_not_selected');
  assert.deepEqual(result.observations, []); assert.deepEqual(result.measurements, []);
  assert.equal(result.quality.usable_speech_ms, null);
});

test('registered acoustic provider receives no financial context and preserves raw score semantics', async () => {
  const env = { VOICE_ANALYSIS_PROVIDER: 'fixture', VOICE_ANALYSIS_MODEL: 'fixture-model' };
  setAcousticProvider('fixture', async input => {
    assert.equal(input.wealth, undefined);
    return { status: 'available', evidence_basis: ['audio_only'], observations: [],
      measurements: [{ raw_label: 'fixture-energy', raw_value: 2, score_semantics: 'fixture intensity, not probability', unit: 'relative' }] };
  });
  try {
    const result = await analyzeAcoustics({ family_id: 'f', person_id: 'p', audio: { sha256: 'fixture-hash' }, wealth: 123 }, { env });
    assert.equal(result.status, 'available'); assert.equal(result.measurements[0].raw_value, 2);
    assert.equal(result.family_id, 'f'); assert.ok(result.input_hash);
  } finally { setAcousticProvider('fixture', null); }
});

test('acoustic missing audio, invalid identity and timeout return explicit safe statuses', async () => {
  const env = { VOICE_ANALYSIS_PROVIDER: 'fixture', VOICE_ANALYSIS_MODEL: 'fixture-model' };
  const analyzer = async () => ({ status: 'available', family_id: 'other', observations: [], measurements: [], evidence_basis: [] });
  assert.equal((await analyzeAcoustics({}, { env, analyzer })).status, 'unavailable');
  const input = { family_id: 'f', audio: {} };
  assert.equal((await analyzeAcoustics(input, { env, analyzer })).reason_code, 'invalid_provider_result');
  assert.equal((await analyzeAcoustics(input, { env, analyzer: () => new Promise(() => {}), timeoutMs: 10 })).reason_code, 'deadline_exceeded');
});
