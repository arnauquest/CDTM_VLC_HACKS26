# Local frontend/backend integration

## Integration record — 21 November 2026

1. The local implementation lives on `codex/local-setup`. GitHub Desktop was restarted after its UI displayed stale state; the existing repository account `Tonet564` was selected and the branch was published. No new GitHub account was created.
2. The existing frontend was imported from `origin/feat/ui-front` at `2591c9a` through merge commit `33ad2fd`. The source frontend branch was not changed. Subsequent integration edits are confined to `codex/local-setup`, retaining the supplied design and layouts.
3. The Node server now serves the actual frontend at `/app/` on the same origin as `/api`; `/` redirects there. `/ops` remains the diagnostic surface. Startup stays `npm start`, with no new npm dependencies or frontend build step.
4. Frontend endpoint adapters connect advisor, client and admin views to durable local Store/Engine operations. Real API mode is the default; `?mock=1` explicitly selects the original mock UI. Local sessions use `?role=consultor|admin|cliente`, with `family=<case-slug>` for clients and tab-scoped bearer tokens in `sessionStorage`.
5. Integration changes are maintained on `codex/local-setup`. Publish this branch through GitHub Desktop using the existing repository account; do not push or reset `feat/ui-front`. Runtime databases, audio, agent workspaces and credentials remain ignored by Git.

## Runtime boundaries

The four supplied synthetic cases remain the source of family data. Source snapshots are immutable; financial updates and relationship memory use the versioned overlay. Counts and actionable items come from actual stored records. Unknown metrics remain unavailable rather than inheriting mock business figures.

Local role selection is for the demo, not production identity management. Billing, account provisioning, portfolio reassignment and changing backend guardrails return explicit unsupported-operation errors. Guardrails describe implemented controls, without a regulatory-certification claim. Integration diagnostics inspect configuration without claiming an unperformed network test.

Browser voice uses configured providers for actual uploaded audio and generated replies. No outbound email or PSTN calls are sent, and no acoustic emotion model is configured. Brand images are uploaded as JSON PNG/JPEG/WebP data URIs; SVG and external image URLs are rejected.

## Implementation references

| Area | Implementation and contract |
| --- | --- |
| Same-origin static serving, sessions and API routing | `backend/server.mjs` |
| Frontend requests and role bootstrap | `ui/front/js/api/client.js`, `ui/front/js/api/endpoints.js`, `ui/front/js/main.js` |
| Advisor | `backend/frontend-advisor.mjs`, `backend/FRONTEND-ADVISOR.md` |
| Client | `backend/frontend-client.mjs`, `backend/FRONTEND-CLIENT.md` |
| Administration and public branding | `backend/frontend-admin.mjs`, `backend/FRONTEND-ADMIN.md` |
| Durable workflow and data | `backend/engine.mjs`, `backend/store.mjs` |
| Existing lower-level API | `backend/API.md` |

## Validation

`npm test`: **98 tests passed**, including 8 actual-HTTP integration tests. Checks cover scoped data, role isolation, state changes, policy versions, approval versions, safe branding, audit exports, static path containment and explicit unavailable operations. All frontend JavaScript files also passed `node --check`.

Computer Use verified advisor, client and admin screens against the running backend. The browser test changed AUTO to manual and back to AUTO (final policy version 3). A synthetic Michael income update reached the mutable overlay and refreshed the client view to $190,000; the original projection was marked pending recalculation. A Samantha client request produced an advisor review item, was approved, and opened a browser conversation with real ElevenLabs audio. A typed reply received a real OpenAI response and generated voice. Finishing the conversation completed Codex post-analysis, saved evidence-linked concern and brief-explanation preferences, and scheduled a written follow-up in five days with the explicitly stated Europe/Madrid timezone. No acoustic emotional inference was made.

The microphone capture control is wired but was not exercised with a human recording in this integration pass. Earlier provider checks covered transcription separately. No real client was contacted. Browser error/warning logs were empty for the tested advisor and client flows.

The existing `check:live`, `check:flow` and `check:relevance` scripts remain optional real-provider checks. They can consume provider usage; frontend mock mode is not a substitute for those checks.
