# Gemini audio observations

Implemented 21 November 2026 on `codex/local-setup`. No extra package or subscription SDK was installed; the server uses native fetch.

## Configure

Edit the ignored root `.env`:

```
VOICE_ANALYSIS_PROVIDER=gemini
VOICE_ANALYSIS_MODEL=
GEMINI_API_KEY=your_key_here
GEMINI_VOICE_ANALYSIS_MODEL=gemini-3.5-flash-lite
```

`VOICE_ANALYSIS_MODEL`, when nonempty, overrides the Gemini model. Restart `npm start` after changing `.env`. Create/manage a key in https://aistudio.google.com/apikey. The browser never receives the key. `/api/health` reports configuration only, not a successful network test.

## Flow and scope

At conversation completion, the existing post-analysis job sends each customer recording to Gemini. Assistant-generated speech and typed replies are not treated as customer audio. Only the recording and fixed analysis instructions are sent: no family identifiers, financial database, relationship profile or separate transcript. Audio itself can contain whatever the customer said.

The adapter uses `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, with the key in `x-goog-api-key`, inline audio and structured JSON output. Recorded-file paths and symlinks must remain inside the recordings folder, sizes are limited to 10 MiB, stored hashes are checked and requests have the existing 30-second deadline. Redirects are rejected. Provider error bodies are not exposed.

Output contains audible delivery cues, tentative tone descriptions, qualitative model confidence, recording-relative millisecond intervals, audio IDs and turn IDs. There are no calibrated emotion probabilities, diagnoses, personality labels or fabricated acoustic measurements. Codex receives this evidence alongside its usual conversation context; any acoustic conclusion must cite a real observation belonging to the same person and turn and remain unconfirmed. Explicit customer preferences retain their separate exact-quote requirement.

Missing credentials/audio, low-quality audio, silence, refusal, rate limits and invalid output preserve an explicit unavailable/failed status and allow transcript analysis to continue. A failed audio result never means the customer is calm. Inspect `GET /api/conversations/{id}` under `acoustic_result` (scoped to the authorized family), or the stored relationship assessment, to review the full saved acoustic result.

## Validation

104 automated tests pass, including isolated Gemini transport, missing credentials, file containment/symlink/hash checks, rate limiting, invalid timestamps, silence and acoustic-reference validation. These tests stub Gemini; they do not establish real-world tone accuracy. A live request with the configured key and existing synthetic generated speech returned `available`, one observation, in 2,343 ms. Evidence is saved privately at `var/check-live/gemini-tone.json`; this did not modify a family profile. Human microphone recording and subjective assessment of tone remain to be tested together.

Sources: [audio understanding](https://aistudio.google.com/docs/audio), [Gemini 3.5 Flash-Lite](https://aistudio.google.com/docs/models/gemini-3.5-flash-lite), [GenerateContent API](https://aistudio.google.com/api-reference/generate-content).
