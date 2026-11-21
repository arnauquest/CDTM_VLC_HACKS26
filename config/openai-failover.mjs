// Connection utility only. A second key may share the first key's project or
// organization limits; it does not create additional capacity by itself.
const ORIGIN = 'https://api.openai.com';
const PATHS = new Set(['/v1/decisions', '/v1/responses', '/v1/chat/completions']);

export class OpenAIRouterError extends Error {
  constructor(code, { status = null, retryAt = null } = {}) {
    super(`OpenAI request: ${code}`);
    this.name = 'OpenAIRouterError';
    this.code = code;
    this.status = status;
    this.retryAt = retryAt;
  }
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort);
    });
  });
}

function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

function durationMs(value) {
  if (!value || !/^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(value)) return null;
  const units = { ms: 1, s: 1000, m: 60000, h: 3600000 };
  return [...value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)]
    .reduce((sum, match) => sum + Number(match[1]) * units[match[2]], 0);
}

function resetDelay(headers, now, fallback) {
  const delays = [];
  const retry = headers.get('retry-after');
  if (retry !== null && retry.trim() !== '') {
    const seconds = Number(retry);
    const value = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - now;
    if (Number.isFinite(value) && value >= 0) delays.push(value);
  }
  for (const name of ['requests', 'tokens', 'project-tokens']) {
    const value = durationMs(headers.get(`x-ratelimit-reset-${name}`));
    if (value !== null && Number.isFinite(value)) delays.push(value);
  }
  return delays.length ? Math.max(...delays) : fallback;
}

function temporaryLimit(status, error) {
  if (status !== 429) return false;
  const code = typeof error?.code === 'string' ? error.code : '';
  const type = typeof error?.type === 'string' ? error.type : '';
  if (/quota|billing|credit|spend_limit|usage_limit/i.test(`${code} ${type}`)) return false;
  return code === 'rate_limit_exceeded' || code === 'slow_down' || type === 'rate_limit_error';
}

function referencesProjectState(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(referencesProjectState);
  for (const [key, item] of Object.entries(value)) {
    if (['previous_response_id', 'file_id', 'file_ids', 'vector_store_id', 'vector_store_ids'].includes(key) && item) return true;
    if (key === 'conversation' && (typeof item === 'string' || item?.id)) return true;
    if (key === 'audio' && item?.id) return true;
    if (key === 'type' && item === 'item_reference' && value.id) return true;
    if (referencesProjectState(item)) return true;
  }
  return false;
}

export function createOpenAIRouter({
  primaryKey, fallbackKey, fetchImpl = globalThis.fetch, now = Date.now,
  sleep = defaultSleep, cooldownMs = 30000, maxAttempts = 3, onEvent = () => {},
} = {}) {
  if (typeof primaryKey !== 'string' || !primaryKey.trim() ||
      !Number.isFinite(cooldownMs) || cooldownMs < 0 ||
      !Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new OpenAIRouterError('invalid_configuration');
  }
  const slots = [{ label: 'primary', key: primaryKey, blocked: new Map() }];
  if (typeof fallbackKey === 'string' && fallbackKey.trim() && fallbackKey !== primaryKey) {
    slots.push({ label: 'fallback', key: fallbackKey, blocked: new Map() });
  }
  const notify = (event) => { try { onEvent(event); } catch { /* Telemetry is optional. */ } };

  return {
    async request(path, { body, signal, timeoutMs = 30000 } = {}) {
      if (!PATHS.has(path) || !body || typeof body.model !== 'string' ||
          !body.model || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new OpenAIRouterError('invalid_request');
      }
      let payload;
      try { payload = JSON.stringify(body); } catch { throw new OpenAIRouterError('invalid_request'); }
      if (typeof payload !== 'string') throw new OpenAIRouterError('invalid_request');
      const model = body.model;
      // Server-side conversation, file and audio IDs are project-scoped. Keep
      // such requests on primary; cross-project fallback requires full context.
      const eligibleSlots = referencesProjectState(JSON.parse(payload)) ? [slots[0]] : slots;
      const deadline = now() + timeoutMs;
      const controller = new AbortController();
      // Keep caller cancellation connected to a successful streaming response,
      // while the routing deadline itself ends once its headers are returned.
      const fetchSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      const abort = () => controller.abort(new OpenAIRouterError('aborted'));
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => {
        controller.abort(new OpenAIRouterError('deadline_exceeded'));
      }, timeoutMs);
      let attempts = 0;
      let lastLimitedSlot;
      const check = () => {
        if (controller.signal.aborted) throw controller.signal.reason;
        if (now() >= deadline) throw new OpenAIRouterError('deadline_exceeded');
      };
      try {
        while (attempts < maxAttempts) {
          check();
          const available = candidate => (candidate.blocked.get(model) ?? 0) <= now();
          const slot = eligibleSlots.find(candidate => candidate !== lastLimitedSlot && available(candidate))
            ?? eligibleSlots.find(available);
          if (!slot) {
            const retryAt = Math.min(...eligibleSlots.map(candidate => candidate.blocked.get(model)));
            const delay = Math.max(0, retryAt - now());
            if (retryAt >= deadline) throw new OpenAIRouterError('deadline_exceeded', { status: 429, retryAt });
            await abortable(sleep(delay, controller.signal), controller.signal);
            continue;
          }
          attempts += 1;
          let response;
          try {
            response = await abortable(fetchImpl(`${ORIGIN}${path}`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${slot.key}`, 'Content-Type': 'application/json' },
              body: payload,
              signal: fetchSignal,
            }), controller.signal);
          } catch {
            check();
            throw new OpenAIRouterError('network_error');
          }
          check();
          if (response.ok) {
            notify({ label: slot.label, attempt: attempts, status: response.status, retryAt: null });
            // Return the original stream. Later stream failures must not restart
            // the turn or repeat audio already delivered to the client.
            return { response, credential: slot.label, attempts };
          }
          let error;
          try { error = (await abortable(response.json(), controller.signal))?.error; }
          catch { check(); }
          if (!temporaryLimit(response.status, error)) {
            notify({ label: slot.label, attempt: attempts, status: response.status, retryAt: null });
            throw new OpenAIRouterError('api_error', { status: response.status });
          }
          const retryAt = now() + resetDelay(response.headers, now(), cooldownMs);
          slot.blocked.set(model, Math.max(slot.blocked.get(model) ?? 0, retryAt));
          lastLimitedSlot = slot;
          notify({ label: slot.label, attempt: attempts, status: response.status, retryAt });
        }
        const retryAt = Math.min(...eligibleSlots.map(slot => slot.blocked.get(model) ?? now()));
        throw new OpenAIRouterError('rate_limit_exhausted', { status: 429, retryAt });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    },
  };
}

export function createOpenAIRouterFromEnv(env = process.env, overrides = {}) {
  return createOpenAIRouter({
    primaryKey: env.OPENAI_API_KEY,
    fallbackKey: env.OPENAI_RATE_LIMIT_FAILOVER_ENABLED === 'false' ? undefined : env.OPENAI_API_KEY_FALLBACK,
    cooldownMs: Number(env.OPENAI_RATE_LIMIT_COOLDOWN_SECONDS ?? 30) * 1000,
    maxAttempts: Number(env.OPENAI_RATE_LIMIT_MAX_ATTEMPTS ?? 3),
    ...overrides,
  });
}
