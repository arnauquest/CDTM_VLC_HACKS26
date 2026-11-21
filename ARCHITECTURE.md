# Architecture and implementation decisions

This document describes the implemented local prototype. Read the [product and workflow overview](README.md) first. The code and linked contracts are the source of truth; future production changes are identified explicitly.

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

Browser voice uses real uploaded audio, ElevenLabs transcription, an OpenAI conversation reply and ElevenLabs synthesis when configured. Text works without requesting audio. Delivery and phone-like calls are simulated in the local app: there is no outbound email delivery, PSTN dialing, phone carrier integration or actual outbound telephone call. Recordings live under `var/recordings` and are accessible only through scoped conversation references.

Optional Gemini tone analysis is available with `VOICE_ANALYSIS_PROVIDER=gemini` and `GEMINI_API_KEY` in `.env`. It analyses actual customer recordings after conversation completion and returns tentative, timestamped delivery observations, not calibrated emotional scores. Missing keys/audio or provider failure do not prevent transcript analysis. See `backend/GEMINI-TONE.md`. Postanalysis uses the actual speaker-attributed transcript and optional self-report. Quotes, person scope and available transcript spans are checked; assistant speech cannot substantiate a customer observation. Textual concern is distinct from an inferred vocal state.

Follow-ups with no date remain pending. Dated follow-ups generate family-scoped reevaluation events when the demo clock reaches their due time. The new assessment considers the original purpose and cancellation conditions; a scheduled event does not itself authorize another contact. SQLite transactions preserve job state and proposed effects, and the worker recovers expired leases after restart.

## Frontend integration contracts

The browser endpoint catalog is [ui/front/js/api/endpoints.js](ui/front/js/api/endpoints.js). Three backend adapters translate its view models into existing Store and Engine operations:

- [Advisor adapter](backend/frontend-advisor.mjs) and [contract](backend/FRONTEND-ADVISOR.md): dashboard, alerts, families, history and policy.
- [Client adapter](backend/frontend-client.mjs) and [contract](backend/FRONTEND-CLIENT.md): selected family, actual conversations, information updates and preferences.
- [Administration adapter](backend/frontend-admin.mjs) and [contract](backend/FRONTEND-ADMIN.md): published branding, drafts, audit export, configuration and actual local workload.

The frontend shows actual stored family/workflow counts. Unknown SLA or capacity metrics remain unavailable; mock figures such as 150 assigned families are not runtime measurements. Billing, account provisioning, portfolio reassignment and editable guardrails are explicitly unavailable. Implemented guardrails remain read-only. Branding uploads use JSON data URIs for PNG/JPEG/WebP up to 2 MiB; SVG and external asset URLs are rejected. Original family sources remain immutable, with authorized updates written to the versioned overlay.

The [original frontend README](ui/front/README.md) is preserved as design and endpoint reference, with a current integration notice at the top. The lower-level [API contract](backend/API.md) also remains available.


## Operational verification

`npm test` currently passes 104 tests. They cover family isolation, valid and invalid agent proposals, policy changes, stale approvals, conversations, recoverable work, provider fallback and acoustic evidence. These checks establish covered behavior; they do not establish production security or statistically calibrated model quality.

[API contract](backend/API.md) · [Agent contracts](backend/agents/contracts.mjs) · [Exact agent prompts](backend/agents/prompts.mjs) · [Demo evidence](DEMO.md)
