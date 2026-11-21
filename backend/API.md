# Local backend API

Base URL: `http://127.0.0.1:3000`. JSON request/response bodies; errors use `{ "error": "...", "code": "..." }` with an HTTP status. Mutation responses contain the updated object unless otherwise stated. Jobs run asynchronously: event creation is not the same as analysis completion.

## Sessions and access

`POST /api/session` creates a local demo role session:

```json
{"role":"client","family_id":"michael-carter"}
```

`role` is `admin`, `advisor` or `client`; `family_id` is required for clients. The response includes a bearer `token`, and the server sets an HttpOnly, SameSite=Strict cookie. Send the cookie with `credentials: "include"` or use `Authorization: Bearer <token>`. Tokens last 12 hours, remain in memory, and do not survive a restart. Role selection has no identity verification and must not be presented as production authentication.

Clients may read and act within their selected family. Advisor/admin sessions may access all demo families and the review, policy, event and diagnostic operations. The server binds only to loopback when launched normally.

| Method and path | Access | Result |
| --- | --- | --- |
| `GET /api/health` | Public | Local clock, policy, provider capabilities and active job count. No credentials. |
| `GET /api/demo/families` | Public | Family IDs and display names for demo login. |
| `POST /api/session` | Public | Create a demo session. |
| `GET /api/session` | Session | Current session metadata. |
| `GET /api/overview` | Advisor/admin | Policy, families, recent events/jobs, communications, follow-ups, conversations and traces. |

## Family state and policy

| Method and path | Body / result |
| --- | --- |
| `GET /api/policy` | Advisor/admin; `{mode,version}`. |
| `PATCH /api/policy` | Advisor/admin; `{mode:"auto"|"manual",expected_version}`. Rechecks pending/delivered packages under the current policy. |
| `GET /api/families` | Scoped family summaries, effective facts and relationship state. Original source field omitted from this list. |
| `GET /api/families/:id` | Full scoped family, source snapshots, change history, follow-ups, communications and conversations. |
| `POST /api/families/:id/information` | `{summary,changes?:[],person_id?,kind?,request_id?}` creates a directed event; HTTP 202. Client input is recorded as `client_form`. |
| `PATCH /api/families/:id/facts` | Advisor/admin; `{expected_version,changes:[...]}` confirms allowed fact changes. |
| `PATCH /api/families/:id/preferences` | `{expected_version,person_id,preferences:{...}}` records an explicit preference request. |
| `GET /api/fact-proposals` | Advisor/admin; pending and confirmed proposals. |
| `POST /api/fact-proposals/:id/confirm` | Advisor/admin; confirms a pending proposal against current family state. |

Example factual change:

```json
{
  "expected_version": 1,
  "changes": [{
    "person_id": "michael-carter:michael",
    "field_path": "incomes.0.yearly",
    "new_value": 190000,
    "unit": "USD/year",
    "effective_at": "2026-11-21T12:00:00Z",
    "evidence_ref": "advisor_confirmation"
  }]
}
```

IDs and versions in examples are illustrative; read current objects before mutation. Unsupported fact paths, protected identity fields, invalid units and stale versions are rejected. Original source snapshots are immutable. New financial facts mark projections stale. Client reports are `self_reported`; advisor confirmation is `confirmed`; unresolved conflicting proposals require confirmation.

Append new financial records at the next numeric collection index, such as `liabilities.3`. A new debt uses `{name,type,balance,interest_rate,monthly_payment,owner}` with null for unknown scalar values and an owner array of exact existing household first names. Use compound unit `USD; rates=ratio` for a whole record containing money and a decimal interest rate; `0.06` means 6%. Income, expense and account records have their own strict field sets. Newborn household associations require advisor confirmation.

## Events and background work

| Method and path | Body / result |
| --- | --- |
| `POST /api/events` | Advisor/admin; event body below; HTTP 202. |
| `GET /api/events` | Advisor/admin; recent events. |
| `GET /api/events/:id` | Advisor/admin; event. |
| `GET /api/jobs` | Advisor/admin; recent job states and errors. |
| `POST /api/jobs/:id/retry` | Advisor/admin; requeues a failed job. |
| `GET /api/traces?family_id=...&event_id=...` | Advisor/admin; optional filters, latest 300 traces. |

```json
{
  "origin": "public_news",
  "scope": "global",
  "family_ids": [],
  "kind": "market_change",
  "summary": "Describe the event and its source without inventing effects.",
  "source_refs": [],
  "simulated": true,
  "dedupe_key": "demo-event-unique-key"
}
```

`scope` is `global`, `family_set` or `family`; directed scopes require valid `family_ids`. `family` skips Decisions. Other scopes evaluate genuine predicate probabilities per family before deeper assessment. Routing calibration is provisional. Missing predicate values are null and route to assessment. HTTP `Idempotency-Key` is supported for event creation and family information submission. Poll jobs/events or overview for progress.

## Communications and review

| Method and path | Body / result |
| --- | --- |
| `GET /api/communications` | Scoped packages; clients see delivered/completed entries. |
| `GET /api/communications/:id` | Scoped communication, prepared draft/bundle, contact decision and state. |
| `POST /api/communications/:id/approve` | Advisor/admin; `{content_version,facts_hash,channel?}`. |
| `POST /api/communications/approve-batch` | Advisor/admin; `{items:[{id,content_version,facts_hash,channel?}]}`; per-item success/error results; cases requiring individual review are rejected from batch approval. |
| `POST /api/communications/:id/reject` | Advisor/admin; `{reason}`. |
| `POST /api/communications/:id/revise` | Advisor/admin; `{instruction}`; supersedes prior package and queues new assessment, HTTP 202. |
| `POST /api/communications/:id/start` | Scoped recipient; `{person_id?,audio?:true}`. Revalidates authorization and creates or returns active conversation. |

Use `content_version` and `facts_hash` from the reviewed communication. The optional `channel` is `browser_voice`, `text` or `audio`; the advisor can choose it at approval, and a changed channel increments content version before the approval is recorded. The final channel is included in the approval hash. A mismatched draft/fact context is not approved. Manual policy always requires approval; auto policy still requires it when the content requires human review. Typical states: `prepared`, `awaiting_review`, `delivered`, `completed`, `rejected`, `superseded`. A changed financial context requires a new preparation/review.

The `draft` holds text, opening voice script, permitted fact references, conversation objectives, anticipated Q&A, branches, questions, response boundaries and escalation/handoff wording. Approval covers the package; ordinary replies within that package do not require individual approval.

Delivery is to the local demo inbox. Browser voice can use real providers; phone-like delivery is simulated and does not dial the telephone network.

## Conversations and audio

| Method and path | Body / result |
| --- | --- |
| `GET /api/conversations` | Scoped conversation list. |
| `GET /api/conversations/:id` | Scoped turns, state and postanalysis state. |
| `POST /api/conversations/:id/turns` | `{text?,audio_base64?,mime?,audio?:true,request_id?}`; records customer turn and returns `{conversation,reply,audio_error}`. |
| `POST /api/conversations/:id/check-in` | `{value:"..."}`; optional self-report, maximum 1,000 characters. |
| `POST /api/conversations/:id/finish` | Marks complete and queues postanalysis; safe to repeat. |
| `GET /api/audio/:id` | Scoped recording bytes and provider MIME type; ID must belong to a visible conversation turn. |
| `POST /api/transcribe` | Advisor/admin diagnostic transcription; `{audio_base64,mime}`. |

Send either text or base64 audio. Uploaded audio is limited to 10 MiB; HTTP JSON body is limited to 15 MiB. Supported MIME types include WebM, Ogg, WAV, MPEG, MP4, AAC and FLAC. `audio:false` disables synthesized reply audio for a text-only interaction. Audio/provider failures are surfaced; no fake transcription or synthesized clip is substituted. Turn `Idempotency-Key` or `request_id` avoids duplicate completed turn requests.

Conversation `state:"completed"` and `analysis_state:"completed"` are different milestones. Postanalysis can be `pending` or `failed` after the conversation ends. Verified observations, explicit preferences, factual proposals and follow-ups are applied after successful analysis. `acoustic_status` reports `available`, `unavailable`, `no_speech`, `low_quality`, `failed` or `not_configured`. Gemini requires `VOICE_ANALYSIS_PROVIDER=gemini` and `GEMINI_API_KEY`; missing audio and missing estimates are never zero concern. Evidence lives in relationship assessments under `acoustic`, with recording-relative intervals, per-turn IDs and tentative qualitative confidence.

## Follow-ups and demo time

| Method and path | Body / result |
| --- | --- |
| `GET /api/followups` | Scoped follow-ups, timing, purpose, cancellation conditions and state. |
| `POST /api/followups/:id/cancel` | Scoped request; `{reason}`. |
| `POST /api/followups/:id/schedule` | Advisor/admin; `{due_at:"...UTC ISO date..."}`. |
| `GET /api/clock` | Advisor/admin; `{now}`. |
| `POST /api/clock` | Advisor/admin; `{now:"...ISO date..."}` advances time; backward movement is rejected. |

Follow-ups may be `pending_date`, `scheduled`, `evaluating`, `evaluated`, `resolved` or `cancelled`. A due follow-up creates one scoped scheduler event carrying its purpose and cancellation conditions. The agent reevaluates whether contact is still useful. Starting the worker seeds monthly reviews and qualifying future goal milestones.

## Frontend integration

Use `/api/overview` or small scoped endpoints with short polling. Display provider processing, communication completion and relationship update as distinct states. Show manual review and content-required review separately from urgency. Never render a null Decisions probability or missing acoustic score as zero. `/ops` is for diagnostics; a product frontend can run separately on port 5173 and use the JSON API with credentials enabled.
