# Advisor frontend compatibility

`handleFrontendAdvisor({path,method,input,session,store,engine,voice,env,rootDir,url})` returns `{body,status?,headers?}`, returns null for another module's routes, or throws an error carrying `status`. `path` can be `/api/...`, a route without `/api`, or path segments. `url` provides query parameters. The handler requires an authenticated `advisor` or `admin` session for every owned route. It does not create sessions or modify frontend files.

All objects come from the real Store and Engine. Empty storage returns empty feeds and actual family counts. Missing review-duration samples return null. There are no synthetic alert, risk, customer, performance or delivery metrics.

## Routes

| Method | Route below `/api` | Behavior |
| --- | --- | --- |
| GET | `/consultant/dashboard` | Actual family/alert counts, measured approval wait average when available, recorded automatic actions. |
| GET | `/alerts/categories` | Supported display categories. Categories describe event kinds, not financial effect measurements. |
| GET | `/alerts?status=pending&category=...` | Prepared/awaiting-review communication feed. Repeated or comma-separated categories supported. `status=all` includes delivered/completed and other states. |
| GET | `/alerts/:id` | Real communication detail, version, facts hash and prepared conversation package. ID is the core communication ID. |
| POST | `/alerts/batch-approve` | `{items:[{id,content_version,facts_hash}]}`; per-item results. Individual/content-required review is rejected from batches. |
| PUT | `/alerts/:id/draft` | Versioned text/script edit described below. Returns fresh detail. |
| POST | `/alerts/:id/email/approve` | Approves the text channel and makes the package available in the local client inbox. **No external email is sent.** |
| POST | `/alerts/:id/call/launch` | Approves `browser_voice` and starts a real browser conversation. Optional `audio:false` skips synthesized opening. **No PSTN call is made.** |
| POST | `/alerts/:id/snooze` | Version + `{until,timezone?}`. Supersedes pending package and schedules a scoped purpose reevaluation. |
| GET | `/ui/families/summary` | Actual total, families with pending packages, and families in auto mode without pending packages. |
| GET | `/ui/families?q=...&status=all` | UI summaries and sourced financial facts. Does not replace core `/families` API. |
| GET | `/history/summary` | Counts of actual approval, automatic-action and audit records. |
| GET | `/history?type=all` | Real approval/trace/audit entries, latest 500. `kind` is `approved`, `silent`, or `audit`. |
| POST | `/history/:id/revert` | HTTP 409: history and completed delivery cannot be silently undone. Use policy changes or explicit corrections. |
| GET | `/templates` | Actual family-prepared packages, with real conversation use counts. Not generic cross-family templates. |
| GET/PUT | `/consultant/settings/autonomy` | Reads/writes actual versioned auto/manual policy through `Engine.setMode`. |

## Review versions and detail fields

Cache `{content_version,facts_hash}` from alert list/detail responses and include both in draft, approval, launch and snooze mutations. A missing/stale version, changed financial context, or action on an inappropriate state returns 409. Refresh the cached version from `updateDraft`'s returned detail and the `alert` object returned by approval/launch. Batch approval accepts versioned `items`, not bare IDs.

Each alert summary includes `canBatchApprove`, `requiresReview`, `reviewLane`, `requires_review`, `review_reasons`, `recommended_channel`, `state` and `stale`. The backend independently rejects batch approval of content-required/individual review. `impact` is mapped from the analyst's urgency, with an explicit `impactBasis`; it is not a calculated monetary impact.

Detail provides the frontend aliases:

- `decision`: actual contact decision, reason, urgency, review conditions, channel and purpose.
- `preparation`: full prepared draft, including objectives, grounded Q&A, branches, questions, permitted fact references, boundaries and handoff text.
- `evidenceRefs`, `missing_information`, `assessment`, `reasoning`: actual assessment evidence and explanation.
- `email`: recipient display names, escaped text converted to paragraphs, subject and explicit local-delivery label.
- `call`: actual script, configured provider label, audio URL only when a real recording exists, and `pstn:false`. Unknown duration is null.

`dataVerified` is only true when a current advisor approval exists and the facts hash still matches. It is not a claim that every imported source has been independently verified.

## Draft edits

```json
{
  "content_version": 1,
  "facts_hash": "hash-from-the-reviewed-package",
  "email": {"subject":"Follow-up","bodyHtml":"<p>Revised wording.</p>"},
  "call": {"script":"Revised opening."}
}
```

Only pending packages can be edited. HTML is converted to plain text and escaped when displayed. Existing boundaries, permitted facts and other preparation are preserved. The transaction stores the preceding content under `communication_versions`, increments `content_version`, clears approval/authorization, requires individual rereview and records an audit entry with old/new hashes and snapshot reference. Already delivered or completed packages cannot be silently rewritten.

## Delivery results

Text approval returns `{approved,state,delivery_kind:"local_inbox",external_email_sent:false,message,alert}`. The UI must say “available in the local inbox,” not “email sent.”

Browser launch returns `{launched,delivery_kind:"browser_voice",pstn:false,conversationId,conversation,audioUrl,message,alert}`. Audio file paths are removed from the response. The existing conversation endpoints handle subsequent actual text/audio turns and completion. “Launched” means a browser conversation exists, not that a telephone call connected.

Snooze records a future follow-up with cancellation conditions and an explicit advisor-selected time. When due, the engine reassesses current context; it does not automatically deliver the old draft.

## Families, history and autonomy

Family plan URLs point to `/app/?role=cliente&family=<id>#/mi-plan`; relationship diagnostic URLs point to `/ops?family=<id>`. No psychological diagnosis or inferred risk category is generated by this adapter. A family without pending work under manual mode has `status:"manual"`, not autopilot and not an invented pending approval.

History `kind:"audit"` must be displayed as a recorded change, not an approval. Entries are immutable and expose `canRevert:false`. Source IDs reference the actual approvals, traces or audit log. Prepared packages expose `reusable_across_families:false`.

Autonomy returns `{mode,version,expected_version,sections,integration}`. Its one configurable rule is `automatic_delivery`; false maps to manual, true to auto. Save the returned structure with its version. Unknown rules are rejected instead of pretending an unimplemented monetary threshold or safety setting was saved. The integration label describes actual local SQLite imports and does not claim a live MCP connection.

Verification: `node --test backend/frontend-advisor.test.mjs` exercises role checks, real metrics, draft history and invalidation, stale actions, low-risk batches, local delivery/browser launch, snooze deduplication, policy persistence and immutable history.
