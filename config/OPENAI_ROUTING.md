# OpenAI connection configuration

This small connection utility is ready for the future backend. Decisions, the conversation loop and the rest of the product have not been implemented yet. Tests use synthetic HTTP responses and do not consume API credits.

Set the following values in the ignored `.env`:

```dotenv
OPENAI_API_KEY=
OPENAI_API_KEY_FALLBACK=
OPENAI_RATE_LIMIT_FAILOVER_ENABLED=true
OPENAI_RATE_LIMIT_COOLDOWN_SECONDS=30
OPENAI_RATE_LIMIT_MAX_ATTEMPTS=3
ELEVENLABS_API_KEY=
```

The team confirmed that the two OpenAI keys belong to different accounts and projects. Both must have access to the exact models used by Decisions and the conversation LLM. Codex agents use their saved ChatGPT session separately.

## Shared router for the local backend

```js
import { createOpenAIRouterFromEnv } from './config/openai-failover.mjs';

// Load the local .env in the server process before creating this instance.
// Keep one shared router for Decisions and conversation requests in this process.
const openai = createOpenAIRouterFromEnv(process.env);
const { response, credential, attempts } = await openai.request('/v1/decisions', {
  body: validatedDecisionsPayload,
  signal: jobAbortSignal,
  timeoutMs: 30000,
});
const decision = await response.json();
```

The router prefers the primary key, switches to the secondary on a confirmed temporary rate-limit response, and restores preference for primary after its cooldown. It tracks recovery by credential and model. If neither is ready, it waits within the operation's deadline and attempt budget. The configured cooldown is a fallback when no usable provider reset hint exists. Request and token reset hints and Retry-After take precedence.

The retry budget counts actual HTTP attempts, including the initial request. The router makes direct fetch requests, so no SDK retry loop multiplies those attempts. Telemetry reports only the primary/fallback label, attempt, status and recovery time. It does not log keys, prompts or response bodies.

Billing, exhausted credits, spend/usage caps, invalid credentials, permission errors and unrecognized errors are surfaced rather than retried through a different key. These are distinct from temporary rate limits. OpenAI documents project/organization-scoped limits and the relevant error codes. [Rate limits](https://developers.openai.com/api/docs/guides/rate-limits) · [Error codes](https://developers.openai.com/api/docs/guides/error-codes)

## Conversation behavior

Use the same router for `/v1/chat/completions` or `/v1/responses`. Keep the complete permitted conversation context locally so a new request can run under either project. Do not rely on project-specific conversation IDs or files being available to the other key.

For protection, requests containing recognized remote-state references are pinned to the primary account. That includes previous_response_id, conversation IDs, file/vector-store references and stored audio IDs. This utility does not infer which account originally created an ID. The planned app should use self-contained context and avoid those references; supporting remote state from both accounts later would require explicit credential affinity.

The router returns the original Response once HTTP succeeds. It never restarts an already delivered stream or replays spoken audio after a streaming failure. The consumer must separately bound stream duration, handle cancellation and record incomplete turns. A failed call turn can present an honest retry or handoff state instead of producing duplicate speech.

To make the team's own OpenAI keys govern every LLM turn, the intended voice path is browser microphone → speech transcription → this OpenAI router → ElevenLabs TTS. A provider-hosted LLM that bypasses this router would not inherit its failover behavior.

Keep the backend's API keys out of the Codex process environment. Codex uses the independently verified ChatGPT login. The API key pair is for Decisions and the conversation model.

## Verification

Run `node --test config/openai-failover.test.mjs`. The tests cover primary selection, fallback, recovery, wait limits, non-retryable errors, cancellation, destination restrictions and interrupted streams. Real access and model compatibility must still be checked after the keys are entered. The two endpoints' response formats remain the responsibility of their application adapters.
