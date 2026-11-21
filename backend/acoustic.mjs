import { createHash, randomUUID } from 'node:crypto';

const providers = new Map();
const STATUSES = new Set(['pending', 'unavailable', 'no_speech', 'low_quality', 'available', 'failed']);

// Registration is explicit. No acoustic provider or emotional model is assumed.
export function setAcousticProvider(name, analyzer) {
  if (typeof name !== 'string' || !/^[a-z0-9_-]+$/i.test(name) || name === 'none') throw new TypeError('Invalid acoustic provider name');
  if (analyzer === null) { providers.delete(name); return; }
  if (typeof analyzer !== 'function') throw new TypeError('Acoustic analyzer must be a function');
  providers.set(name, analyzer);
}

export async function analyzeAcoustics(input = {}, { env = process.env, analyzer, signal, timeoutMs = 30000 } = {}) {
  const provider = env.VOICE_ANALYSIS_PROVIDER;
  const model = env.VOICE_ANALYSIS_MODEL;
  // Only acoustic evidence goes to this adapter; financial/relationship context is excluded.
  const evidence = Object.fromEntries(['schema_version', 'conversation_id', 'family_id', 'person_id', 'audio',
    'speaker_segments', 'time_mapping', 'language', 'transcript_ref', 'options'].filter(key => input[key] !== undefined).map(key => [key, input[key]]));
  const base = {
    schema_version: '1', analysis_id: input.analysis_id || randomUUID(),
    conversation_id: input.conversation_id ?? null, family_id: input.family_id ?? null, person_id: input.person_id ?? null,
    status: 'not_configured', reason_code: 'provider_not_selected', provider: null, model: null, adapter_version: null,
    input_hash: null, audio_sha256: input.audio?.sha256 ?? null, evidence_basis: [],
    quality: { usable_speech_ms: null, warnings: [] }, observations: [], measurements: [], error: null,
  };
  if (!provider || provider === 'none' || !model) return base;
  base.provider = provider; base.model = model; base.adapter_version = '1';
  base.input_hash = createHash('sha256').update(JSON.stringify({ evidence, provider, model, adapter_version: '1' })).digest('hex');
  const selected = analyzer ?? providers.get(provider);
  if (!selected) return { ...base, reason_code: 'provider_adapter_not_registered' };
  if (!input.audio) return { ...base, status: 'unavailable', reason_code: 'audio_missing' };
  const controller = new AbortController(); let timer; let abort;
  try {
    const deadline = new Promise((_, reject) => {
      abort = () => { controller.abort(); reject(Object.assign(new Error(), { code: 'aborted' })); };
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error(), { code: 'deadline_exceeded' })); }, timeoutMs);
    });
    const result = await Promise.race([deadline, Promise.resolve().then(() => {
      if (controller.signal.aborted) throw Object.assign(new Error(), { code: 'aborted' });
      return selected(evidence, { model, signal: controller.signal, timeoutMs });
    })]);
    if (!result || !STATUSES.has(result.status) || !Array.isArray(result.observations) || !Array.isArray(result.measurements) ||
        !Array.isArray(result.evidence_basis) || (result.person_id && result.person_id !== base.person_id) ||
        (result.family_id && result.family_id !== base.family_id) || (result.conversation_id && result.conversation_id !== base.conversation_id))
      throw Object.assign(new Error(), { code: 'invalid_provider_result' });
    for (const observation of result.observations) {
      if (!observation.id || observation.person_id !== base.person_id || !Array.isArray(observation.intervals) || !observation.intervals.length ||
          observation.intervals.some(span => !Number.isFinite(span.start_ms) || !Number.isFinite(span.end_ms) || span.start_ms < 0 || span.end_ms <= span.start_ms))
        throw Object.assign(new Error(), { code: 'invalid_provider_result' });
    }
    return { ...base, status: result.status, reason_code: result.reason_code ?? null,
      evidence_basis: result.evidence_basis, quality: result.quality ?? base.quality,
      observations: result.observations, measurements: result.measurements,
      error: result.status === 'failed' ? { code: 'provider_failed', retryable: false, next_action: 'inspect_provider_configuration' } : null };
  } catch (error) {
    const code = ['aborted', 'deadline_exceeded', 'invalid_provider_result'].includes(error?.code) ? error.code : 'provider_failed';
    return { ...base, status: 'failed', reason_code: code,
      error: { code, retryable: code === 'deadline_exceeded', next_action: code === 'deadline_exceeded' ? 'retry_with_limit' : 'inspect_provider_configuration' } };
  } finally { clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort); }
}
