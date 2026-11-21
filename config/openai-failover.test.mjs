import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAIRouter, createOpenAIRouterFromEnv } from './openai-failover.mjs';

const primaryKey = 'fixture-primary';
const fallbackKey = 'fixture-fallback';
const body = { model: 'fixture-model', input: 'Synthetic configuration check' };
const ok = () => Response.json({ ok: true });
const rateLimit = (retryAfter = '30') => Response.json(
  { error: { type: 'rate_limit_error', code: 'rate_limit_exceeded' } },
  { status: 429, headers: { 'Retry-After': retryAfter } },
);

test('uses primary by default and preserves the payload', async () => {
  const calls = [];
  const router = createOpenAIRouter({ primaryKey, fallbackKey, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return ok();
  } });
  const result = await router.request('/v1/decisions', { body });
  assert.equal(result.credential, 'primary');
  assert.equal(result.attempts, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/decisions');
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), `Bearer ${primaryKey}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), body);
  assert.deepEqual(await result.response.json(), { ok: true });
});

test('switches on a temporary limit and returns to primary after its cooldown', async () => {
  let clock = 1000;
  const credentials = [];
  const router = createOpenAIRouter({ primaryKey, fallbackKey, now: () => clock,
    sleep: async ms => { clock += ms; }, fetchImpl: async (_url, init) => {
      credentials.push(new Headers(init.headers).get('authorization'));
      return credentials.length === 1 ? rateLimit('120') : ok();
    },
  });
  const first = await router.request('/v1/decisions', { body });
  assert.equal(first.credential, 'fallback');
  assert.equal(first.attempts, 2);
  assert.equal(clock, 1000, 'an independent fallback need not wait for primary recovery');
  const second = await router.request('/v1/chat/completions', { body });
  assert.equal(second.credential, 'fallback');
  clock += 120001;
  const third = await router.request('/v1/decisions', { body });
  assert.equal(third.credential, 'primary');
  assert.deepEqual(credentials, [primaryKey, fallbackKey, fallbackKey, primaryKey].map(k => `Bearer ${k}`));
});

test('billing, quota, authentication and unknown errors do not rotate credentials', async () => {
  for (const [status, code, type] of [
    [429, 'insufficient_quota', 'insufficient_quota'],
    [429, 'credit_balance_exhausted', 'insufficient_quota'],
    [429, 'organization_spend_limit_exceeded', 'rate_limit_error'],
    [429, 'project_spend_limit_exceeded', 'rate_limit_error'],
    [429, 'organization_usage_limit_exceeded', 'rate_limit_error'],
    [429, 'unrecognized_error', 'unknown'],
    [401, 'invalid_api_key', 'invalid_request_error'],
  ]) {
    let calls = 0;
    const router = createOpenAIRouter({ primaryKey, fallbackKey, fetchImpl: async () => {
      calls++;
      return Response.json({ error: { code, type } }, { status });
    } });
    await assert.rejects(router.request('/v1/decisions', { body }));
    assert.equal(calls, 1, `${code} must not cause a retry`);
  }
});

test('when both are limited, honors the earlier recovery time before retrying', async () => {
  let clock = 0;
  let calls = 0;
  const waits = [];
  const router = createOpenAIRouter({ primaryKey, fallbackKey, maxAttempts: 3,
    now: () => clock, sleep: async ms => { waits.push(ms); clock += ms; },
    fetchImpl: async () => { calls++; return calls <= 2 ? rateLimit('60') : ok(); },
  });
  const result = await router.request('/v1/responses', { body, timeoutMs: 120000 });
  assert.equal(result.attempts, 3);
  assert.ok(waits.reduce((a, b) => a + b, 0) >= 60000);
});

test('a short deadline stops before retrying an unavailable capacity pool', async () => {
  let clock = 0;
  let calls = 0;
  const router = createOpenAIRouter({ primaryKey, fallbackKey,
    now: () => clock, sleep: async ms => { clock += ms; },
    fetchImpl: async () => { calls++; return rateLimit('60'); },
  });
  await assert.rejects(router.request('/v1/decisions', { body, timeoutMs: 1000 }));
  assert.equal(calls, 2);
});

test('never restarts a successful HTTP response after a streaming failure', async () => {
  let calls = 0;
  let controller;
  const stream = new ReadableStream({ start(c) { controller = c; c.enqueue(new TextEncoder().encode('partial')); } });
  const router = createOpenAIRouter({ primaryKey, fallbackKey, fetchImpl: async () => {
    calls++;
    return new Response(stream, { status: 200 });
  } });
  const { response } = await router.request('/v1/chat/completions', { body: { ...body, stream: true } });
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'partial');
  controller.error(new Error('fixture stream interruption'));
  await assert.rejects(reader.read());
  assert.equal(calls, 1);
});

test('does not send keys to arbitrary destinations or start an aborted request', async () => {
  let calls = 0;
  const router = createOpenAIRouter({ primaryKey, fallbackKey, fetchImpl: async () => { calls++; return ok(); } });
  await assert.rejects(router.request('https://example.invalid/collect', { body }));
  await assert.rejects(router.request('/v1/files', { body }));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(router.request('/v1/decisions', { body, signal: controller.signal }));
  assert.equal(calls, 0);
});

test('environment configuration can disable fallback and does not change input values', async () => {
  const env = { OPENAI_API_KEY: primaryKey, OPENAI_API_KEY_FALLBACK: fallbackKey,
    OPENAI_RATE_LIMIT_FAILOVER_ENABLED: 'false', OPENAI_RATE_LIMIT_MAX_ATTEMPTS: '1' };
  const snapshot = { ...env };
  let calls = 0;
  const router = createOpenAIRouterFromEnv(env, { fetchImpl: async () => { calls++; return rateLimit(); } });
  await assert.rejects(router.request('/v1/decisions', { body }));
  assert.equal(calls, 1);
  assert.deepEqual(env, snapshot);
});

test('a zero retry delay still tries secondary before repeating the limited primary', async () => {
  const credentials = [];
  const events = [];
  const router = createOpenAIRouter({ primaryKey, fallbackKey, onEvent: event => events.push(event),
    fetchImpl: async (_url, init) => {
      credentials.push(new Headers(init.headers).get('authorization'));
      return credentials.length === 1 ? rateLimit('0') : ok();
    },
  });
  const result = await router.request('/v1/decisions', { body });
  assert.equal(result.credential, 'fallback');
  assert.deepEqual(credentials, [`Bearer ${primaryKey}`, `Bearer ${fallbackKey}`]);
  const telemetry = JSON.stringify(events);
  assert.equal(telemetry.includes(primaryKey), false);
  assert.equal(telemetry.includes(fallbackKey), false);
  assert.equal(telemetry.includes(body.input), false);
});

test('project-bound references are never transferred to the fallback account', async () => {
  for (const reference of [
    { previous_response_id: 'fixture-response' },
    { conversation: 'fixture-conversation' },
    { input: [{ type: 'input_file', file_id: 'fixture-file' }] },
    { messages: [{ role: 'assistant', audio: { id: 'fixture-audio' } }] },
  ]) {
    const credentials = [];
    const router = createOpenAIRouter({ primaryKey, fallbackKey, fetchImpl: async (_url, init) => {
      credentials.push(new Headers(init.headers).get('authorization'));
      return rateLimit('60');
    } });
    await assert.rejects(router.request('/v1/responses', { body: { ...body, ...reference }, timeoutMs: 1000 }));
    assert.deepEqual(credentials, [`Bearer ${primaryKey}`]);
  }
});
