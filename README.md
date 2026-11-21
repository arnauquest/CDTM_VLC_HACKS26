# Sherpas local prototype

A local, family-scoped advisor workflow: ingest an event, assess its relevance, prepare a communication, apply the current review policy, hold a client conversation, update relationship understanding, and schedule useful follow-ups.

## Run locally

Use Node.js 22.13 or newer. The backend uses Node's built-in SQLite and has no npm package dependencies.

```sh
cd /Users/paulasantaballalison/Desktop/Toni/proyecto/CDTM_VLC_HACKS26
# Preserve an existing .env:
test -f .env || cp .env.example .env
# Fill the local configuration without committing credentials.
npm start
```

The server binds to loopback, normally `http://127.0.0.1:3000`. Open [operational diagnostics](http://127.0.0.1:3000/ops) to inspect events, jobs and provider status. `/ops` is a diagnostic surface separate from the product frontend; the backend currently also serves it at `/`. [API routes and payloads](backend/API.md) support a separately developed frontend. Local development origins on ports 3000 and 5173 are permitted; additional exact origins can be configured with `ALLOWED_ORIGINS`.

Choose an advisor, admin or a specific family's client session. These are local demo roles with temporary session tokens, **not production authentication**. A client session is scoped to its selected family. Session tokens expire after 12 hours and disappear when the server restarts.

## Configuration

The existing `.env` is local and private. Do not overwrite it with the example or print its contents in diagnostics.

On another machine, obtain the public synthetic cases from the [official challenge repository](https://github.com/SherpasEngineering/hackathon-cdtm-vlc-hacks-2026) and set `SHERPAS_CASES_DIR` to its `cases` directory. The defaults above point to the existing Toni workspace. Set your own executable paths, Codex login and API credentials; no secrets or local source files are bundled with this branch.

| Setting | Purpose |
| --- | --- |
| `APP_HOST`, `APP_PORT` | Loopback host and port; defaults `127.0.0.1:3000`. |
| `SQLITE_PATH` | Main SQLite database; default `./var/sherpas.sqlite3`. |
| `SHERPAS_CASES_DIR` | Four supplied case directories; default `../../referencias/sherpas/recursos-oficiales/cases`. |
| `COMMUNICATION_MODE` | Initial policy for a fresh database; default `auto`. The persisted policy takes precedence afterward. |
| `AGENT_PROVIDER` | `codex` by default; adapters also exist for `claude` and `opencode`. |
| `CODEX_BIN`, `CLAUDE_BIN`, `OPENCODE_BIN` | Local executable path or command resolved to an absolute path before spawning. |
| `AGENT_MODEL` | Optional model override; provider-specific `CODEX_MODEL`, `CLAUDE_MODEL`, `OPENCODE_MODEL` take precedence. |
| `AGENT_MAX_CONCURRENCY` | Concurrent background jobs, default 2 and bounded to 1–4. |
| `AGENT_WORKSPACES_DIR` | Private per-job input/schema/result directories, default `./var/agents`. |
| `AGENT_TIMEOUT_MS` | Agent deadline, bounded to 1–120 seconds; default 120 seconds. |
| `OPENAI_API_KEY`, `OPENAI_API_KEY_FALLBACK` | API credentials for Decisions and conversation replies, separate from Codex subscription login. |
| `OPENAI_DECISIONS_MODEL` | Decisions model, default `gpt-6-luna`. |
| `DECISIONS_RELEVANCE_THRESHOLD` | Provisional routing threshold, default `0.2`. |
| `OPENAI_CONVERSATION_MODEL` | Conversation model, default `gpt-6-luna`. |
| `OPENAI_CONVERSATION_REASONING_EFFORT` | Conversation reasoning setting; see `.env.example`. |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | Enable real transcription and speech generation; voice ID is needed for synthesis. |
| `ELEVENLABS_TTS_MODEL`, `ELEVENLABS_STT_MODEL` | Speech provider models, defaults `eleven_v4_turbo` and `scribe_v2`. |

Temporary OpenAI rate limits can use the configured fallback credential through the shared router. Quota/billing errors are surfaced instead of being treated as temporary limits. A second key may share the same project limits and does not create capacity. See [routing behavior](config/OPENAI_ROUTING.md).

Codex runs with the existing local subscription login, `--ignore-user-config`, `--ephemeral`, a read-only command sandbox, structured output, and a private job working directory. Service API credentials are removed from its child environment. Shell tools are disabled in the configured runner. The read-only sandbox does **not** constitute filesystem read isolation. Claude and OpenCode adapters are implemented; their login and full execution paths remain unverified here. Failed providers leave visible failed/retryable jobs; the product does not fabricate model results.

## Data and behavior

Original JSON, Markdown and PDF case files are imported as immutable source snapshots with hashes. Effective facts are a versioned overlay; authorized changes retain their prior values, units, provenance and status. Monetary fields preserve the source's original USD units. Changes to financial assumptions mark dependent projections stale. Relationship observations and explicit preferences are kept separately from financial facts. A client's reported newborn is a pending association proposal until advisor confirmation. New income, debt, expense and account records use strict shapes and known owners; unknown fields stay null. Agent context uses bounded history excerpts and selected derived metrics while retaining effective facts, original financial profiles, holdings and persona evidence. Full local records remain available in storage.

The tracker accepts advisor-entered demo news, client information submissions and due-time events. Live scraping/news/social integrations are not connected; externally sourced demo events are explicitly simulated. Recurring relationship reviews run every 30 days, with goal milestones seeded from supplied case dates.

Directed family events bypass relevance filtering. Global and family-set events use the real OpenAI Decisions endpoint with financial relevance, relationship relevance and insufficient evidence predicates. All three probabilities must be below the threshold to discard. Missing/refused results remain null and route conservatively to assessment. Probabilities and the threshold are **provisional, not empirically calibrated performance claims**; they do not determine whether to contact the client.

The assessment chooses `now`, `later`, `none` or `needs_information`, prepares a recommended channel and full conversation bundle, and proposes fact changes and follow-ups. Browser voice is the default when preferences and context allow it. In `auto`, routine eligible communications can be delivered to the local client inbox. In `manual`, every communication requires advisor approval and the advisor can choose the final channel at approval. Content requiring review remains gated in either mode. Approvals bind the draft, selected channel and facts hashes; policy and facts are checked again before delivery or conversation start.

Browser voice uses real uploaded audio, ElevenLabs transcription, an OpenAI conversation reply and ElevenLabs synthesis when configured. Text works without requesting audio. Delivery and phone-like calls are simulated in the local app: there is no PSTN dialing, phone carrier integration or actual outbound telephone call. Recordings live under `var/recordings` and are accessible only through scoped conversation references.

Acoustic/tone inference is deliberately `not_configured`, with no acoustic scores. Postanalysis uses the actual speaker-attributed transcript and optional self-report. Quotes, person scope and available transcript spans are checked; assistant speech cannot substantiate a customer observation. Textual concern is distinct from an inferred vocal state.

Follow-ups with no date remain pending. Dated follow-ups generate family-scoped reevaluation events when the demo clock reaches their due time. The new assessment considers the original purpose and cancellation conditions; a scheduled event does not itself authorize another contact. SQLite transactions preserve job state and proposed effects, and the worker recovers expired leases after restart.

## Checks

```sh
npm test
npm run check:live
npm run check:flow
npm run check:relevance
```

Unit and integration tests use controlled provider responses. `check:live` performs actual provider diagnostics. `check-flow.mjs` uses real Codex and OpenAI calls for one directed Michael workflow, conditional approval, one text conversation turn, postanalysis and a scheduler enqueue check. It writes a separate database and private agent artifacts under `var/check-flow/<run-id>/`, with a safe report at `var/check-flow/latest.json`; it does not alter the application's database. A failed run can resume with `--resume <run-id>` to reuse completed stages. Its final scheduler reevaluation is queued but not run, avoiding an additional agent call. Live checks consume provider usage and report status without printing credentials. `check:relevance` evaluates 16 clearly labelled synthetic examples across the four families and reports threshold sensitivity; this small set is an integration check, not statistical calibration. Worker retry/lease timers use real time even when the demo clock is frozen.

Implementation entry points: [server](backend/server.mjs), [workflow engine](backend/engine.mjs), [storage](backend/store.mjs), [AI adapters](backend/ai.mjs), [voice](backend/voice.mjs), and [API contract](backend/API.md).
