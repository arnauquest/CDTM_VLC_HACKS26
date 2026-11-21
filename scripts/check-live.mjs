// Explicit opt-in real provider smoke check:
// node --env-file=.env scripts/check-live.mjs
// Uses synthetic speech only. Runtime evidence/report remains under ignored var/.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVoice } from '../backend/voice.mjs';
import { analyzeAcoustics } from '../backend/acoustic.mjs';
import { createOpenAIRouterFromEnv } from '../config/openai-failover.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(rootDir, 'var', 'check-live');
const reportPath = join(outputDir, 'latest.json');
const report = { started_at: new Date().toISOString(), synthetic_test: true,
  purpose: 'Real provider TTS → STT → conversation smoke check; no customer audio or acoustic inference.',
  status: 'running', steps: [] };
const started = performance.now();
let activeStep;
async function step(name, work) {
  const began = performance.now(); activeStep = name;
  const result = await work();
  const entry = { name, status: 'passed', elapsed_ms: Math.round(performance.now() - began), ...result };
  report.steps.push(entry);
  console.log(`PASS ${name} (${entry.elapsed_ms} ms)`);
  return result;
}
function check(value, code) { if (!value) throw Object.assign(new Error(code), { code }); }

try {
  const router = createOpenAIRouterFromEnv(process.env);
  const voice = createVoice({ rootDir, router, timeoutMs: 90000 });
  const capabilities = voice.capabilities();
  check(capabilities.tts && capabilities.stt && capabilities.conversation, 'voice_configuration_incomplete');
  const generated = await step('elevenlabs_tts', async () => {
    const result = await voice.synthesize({ text: 'Hello, I would like to speak with my advisor on Friday.' });
    check(result.bytes > 0 && result.mime === 'audio/mpeg', 'tts_empty_audio');
    return { model: result.model, audio_id: result.audio_id, path: result.path, bytes: result.bytes, mime: result.mime };
  });
  const transcription = await step('elevenlabs_stt', async () => {
    const result = await voice.transcribe({ audio_base64: (await readFile(generated.path)).toString('base64'), mime: generated.mime });
    check(result.text.trim() && /friday/i.test(result.text), 'stt_expected_synthetic_phrase_missing');
    return { model: result.model, text: result.text, language_code: result.language_code,
      word_count: result.words.length, audio_id: result.audio_id, path: result.path };
  });
  await step('openai_conversation', async () => {
    const deltas = [];
    const result = await voice.reply({
      bundle: {
        family_id: 'synthetic-live-check', recipient: { person_id: 'synthetic-person', name: 'Demo client' },
        purpose: 'Listen to the client’s requested timing for a human advisor conversation.',
        opening: 'I am your advisor’s virtual assistant. I can note when you would like to speak with your advisor.',
        permitted_facts: [], conversation_objectives: ['Capture the client’s requested contact day.'],
        response_boundaries: ['No financial advice.', 'Do not claim an appointment has been scheduled or a message sent.'],
        escalation_conditions: ['The client asks to speak to their advisor.'],
        handoff_response: 'I understand you would like to speak with your advisor on Friday. Your request can be passed to your advisor for confirmation.',
      },
      family: { id: 'synthetic-live-check', people: [{ id: 'synthetic-person', display_name: 'Demo client' }], facts: {} },
      turns: [], userText: transcription.text, onDelta: delta => deltas.push(delta),
    });
    check(result.text.trim() && deltas.length > 0, 'conversation_missing_stream');
    check(!/\[HANDOFF\]/i.test(result.text + deltas.join('')), 'conversation_marker_leaked');
    check(result.handoff_requested, 'conversation_handoff_missing');
    return { model: result.model, credential: result.credential, text: result.text,
      handoff_requested: result.handoff_requested, stream_delta_count: deltas.length };
  });
  await step('acoustic_provider_pending', async () => {
    // Synthetic TTS is deliberately excluded from customer acoustic analysis.
    const result = await analyzeAcoustics({ conversation_id: 'synthetic-live-check', family_id: 'synthetic-live-check', person_id: 'synthetic-person' });
    check(result.status === 'not_configured', 'acoustic_provider_unexpectedly_configured');
    check(result.observations.length === 0 && result.measurements.length === 0, 'acoustic_measurements_unexpected');
    return { acoustic_status: result.status, reason_code: result.reason_code, provider_called: false };
  });
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  // Provider bodies, arbitrary exception messages and credentials are never printed.
  const code = typeof error?.code === 'string' && /^[a-z0-9_]{1,80}$/i.test(error.code) ? error.code : 'live_check_failed';
  report.steps.push({ name: activeStep || 'configuration', status: 'failed', code,
    http_status: Number.isInteger(error?.status) ? error.status : null });
  console.error(`FAIL ${activeStep || 'configuration'} (${code})`);
  process.exitCode = 1;
} finally {
  report.completed_at = new Date().toISOString();
  report.elapsed_ms = Math.round(performance.now() - started);
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`Report: ${reportPath}`);
}
