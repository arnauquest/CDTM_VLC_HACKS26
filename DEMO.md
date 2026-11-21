# Demo runbook — CDTM Valencia Hacks 2026 (Sherpas + ElevenLabs)

Handoff document: everything needed to run, repeat and record the demo. Written 21 Nov 2026 (~16:00 CET).

## Chosen case

**Samantha Lewis** (official synthetic family). Grounded in her case files: single earner, Ethan (18) already in college, **Ava (16) starts college in August 2028**, education goal shows **$98,838 of $100,000 still needed and $0 in 529 plans** (`persona.md`, lines 13, 36, 81). No holdings, dates or amounts beyond the dataset are assumed.

## Staged state (real results, not mocked)

Clean database `var/demo.sqlite3` (the earlier working DB `var/sherpas.sqlite3` is untouched). Built by these real steps:

1. Fresh import of the 4 official families.
2. **Global simulated event** (`origin: public_news`, `simulated: true`): "average US college tuition expected to rise ~4% for 2027-28". Relevance (OpenAI Decisions) + assessment (Codex) ran per family, in parallel (concurrency 2). Real outcome:
   | Family | Decision | Reason given by the agent (short) |
   | --- | --- | --- |
   | Michael Carter | **none** | No children; goals are a vacation and a 2027 home purchase. |
   | Timothy & Melanie Weah | **none** | College goals start 2038 and 2041; no household-specific change. |
   | Daniel & Emily Johnson | **later** | Children start 2033/2035; revisit at the monthly review. |
   | Samantha Lewis | **later** | No verified cost change; no expressed concern yet. |
   No communication was sent by this event: the system chose silence/waiting for all four.
3. **Directed client event**: Samantha asks (client form) for a short call about what the news means for Ava's plan. Directed events skip relevance. Codex prepared a full conversation package (voice script, objectives, anticipated Q&A, branches, response boundaries, escalation). In AUTO it was delivered automatically.
4. Policy switched **AUTO → MANUAL** (policy v2). The backend re-checked the package and moved it back to `awaiting_review` — this is the real effect of the switch.

Snapshot of this state: `var/demo-staged.sqlite3` (git-ignored).

## Reset / retake (5 seconds)

```sh
./scripts/demo-restore.sh
```

Stops the server, restores the snapshot, restarts on `SQLITE_PATH=./var/demo.sqlite3`. Then **reload the browser tabs** (sessions are in-memory and die on restart). To rebuild the snapshot from scratch: start the server with a new empty `SQLITE_PATH`, POST the two events above (`/api/events`, `/api/families/samantha-lewis/information`), wait for jobs, PATCH `/api/policy` to manual, then `sqlite3 var/demo.sqlite3 ".backup var/demo-staged.sqlite3"`. Agent outputs are non-deterministic, so wording may differ.

## Tabs (Chrome, same window)

1. Process: `http://127.0.0.1:3000/ops`
2. Advisor: `http://127.0.0.1:3000/app/?role=consultor#/alertas`
3. Client: `http://127.0.0.1:3000/app/?role=cliente&family=samantha-lewis#/mi-plan`
4. (after the call) Process for Samantha: `http://127.0.0.1:3000/ops?family=samantha-lewis`

## Recording script (target 2:30, narrate in English)

| Time | Screen | Action | Say |
| --- | --- | --- | --- |
| 0:00–0:25 | Tab 1 `/ops` | Scroll the decision trail to the tuition event. | "A tuition headline comes in. The system screens all four families. Two get no contact, two wait for their next review — each with a written reason. Most of the time the right answer is silence." |
| 0:25–0:55 | Tab 2 Alertas | Click **Revisar** on Samantha, show the prepared call and its limits; approve with **Llamada en navegador**. | "Samantha then asks for a short call. In manual mode nothing goes out without the advisor. The agent prepared the script, likely questions and the boundaries. One click approves it." |
| 0:55–1:50 | Tab 3 client | Reload the tab: the approved call is already open at the top ("Conversar con el asistente virtual"). Press **play** on the audio player to hear the opening (ElevenLabs). Click **Hablar**, say the client line, click **Terminar grabación**. Listen to the reply. Click **Terminar**. | Client line below. |
| 1:50–2:30 | Tab 4 `/ops?family=samantha-lewis` | Wait until "relationship analysis · completed" (~25 s; may be cut in editing, do not present as continuous timing). Show "Next thoughtful touch" (+5 days). | "The call is over, but the work isn't. The system kept what she said in her own words, her preference for short explanations, and scheduled the follow-up she asked for. When it's due, it re-evaluates before contacting her." |

**Client line (speak naturally, as Samantha):**

> "It was about tuition in general. Honestly, I'm worried about paying for Ava's college. Please keep your explanations short, and could you follow up with me in five days?"

## Verified in the dry run (text turn through the API, same staged state)

- Approve → `delivered`; conversation start 3 s (opening line with ElevenLabs audio); reply turn 4 s (OpenAI + ElevenLabs); post-analysis completed 24 s after finish.
- Stored after analysis: observation `expressed_concern` with the exact quote "Honestly, I am worried about paying for Ava's college."; `confirmed_preference` "Please keep explanations short"; preference `explanation_style: Short explanations`; two open questions; follow-up scheduled 5 days later (26 Nov) about Ava's college costs.
- `acoustic_status: unavailable` in the dry run because the turn was typed (no customer audio). Gemini tone analysis only runs on real microphone audio; its output is tentative and kept separate from explicit statements.

## Fallbacks

- Microphone or transcription fails: type the client line in the text box under the call ("También puedes responder por escrito"); the reply still has voice.
- A provider is slow: keep recording, cut the wait in editing; do not claim continuous latency.
- Anything inconsistent: `./scripts/demo-restore.sh`, reload tabs, retake.

## Honest limitations

- UI copy is Spanish in `/app/`, English in `/ops`; client content is English.
- Calls are in-browser, not telephone. Role sessions are local demo sessions, not authentication.
- The tuition event is simulated and labelled as such; no live news feed is connected.
- Relevance probabilities are provisional, not calibrated.
- Interface pass (16:05–16:10): `/ops` restyled to the app's light theme and now opens with "Events and family decisions" (event → per-family decision chip + reason + communication state); technical traces are hidden behind "Show technical steps"; relationship memory labels distinguish what the client said from tentative observations. Client view: the voice call card is first and the transcript uses bubbles. Advisor detail and history show readable state labels. No redesign beyond that.
- Verified through the UI (typed reply): approve as browser call → conversation opens for the client → reply with voice → finish → analysis completed → follow-up on 26 Nov shown in `/ops?family=samantha-lewis`. 104 tests pass.
- Earlier recording attempts were blocked by screen-recording/tooling availability. This was resolved for the final capture described in the Video section below.


## Video

Final recording on 21 November 2026: `/Users/paulasantaballalison/Desktop/Toni/entrega/sherpas-demo.mp4`. Duration **2:35 (155.02 seconds)**; **1920 × 1080, 30 fps, H.264 High / AAC-LC stereo 48 kHz**, approximately 6.4 MB. Segment lengths: A 25 s, B 30 s, C 70 s, D 30 s.

- Recorded the real running local application in Safari with `screencapture -v`, in four separate clips: global family decisions, advisor review/approval, Samantha’s conversation, and completed relationship analysis/follow-up. Screen Recording permission worked during this capture. Product code was not changed for the recording.
- English narration was generated with ElevenLabs, using **George — Warm, Captivating Storyteller**, a different voice from the assistant. The assistant’s opening and reply are the actual audio returned by the conversation API.
- Samantha’s voice is the real human recording `entrega/samantha.m4a` (11.817 seconds), submitted through the local conversation API as `audio/mp4`, with request ID `video-1`. It was **not** captured through the browser microphone button and was not replaced by synthetic speech.
- The STT result really says **“Abbas College”** instead of “Ava’s college.” The transcript is preserved. The relationship analysis retained the quote and added an open question to clarify this ambiguity; the video does not silently correct the result.
- Processing/idle waits were cut and some real frames held to align narration and dialogue. Browser chrome was cropped; closer views highlight the conversation and relationship memory without changing their content. This is an edited demonstration, **not a continuous latency measurement**. The tuition headline remains a labelled simulated event; no live feed or unmeasured performance claim is implied.
- Actual post-call result: `analysis_state: completed`, **`acoustic_status: available`**, with no analysis error. Gemini produced tentative observations (“steady,” “measured,” “direct”), stored separately from statements confirmed by the client. These are qualitative model estimates, not calibrated probabilities or verified emotional states.
- The system stored Samantha’s expressed concern, her confirmed preference for **short explanations**, and her request for a follow-up in five days. The follow-up was scheduled for **26 November 2026 at 15:35:13 UTC** (`America/Chicago` client timezone), with cancellation/re-evaluation conditions. The recorded post-analysis completed at 16:36:38 Madrid time; its processing wait is not shown continuously.
- Evidence and assembly assets are under `entrega/video-build/`, including `voice-turn-evidence.json`, `analysis-evidence.json`, `postanalysis-summary.json`, and the edit report. These are local assets; no API keys or session tokens are part of the deliverable.
- Validation: the entire final video decoded with FFmpeg without errors; its duration, video format, and audio stream were checked. Full playback in the isolated browser reached the end (`ended: true`, 155.021354 s, no playback error). The captured interfaces and audio sequence were checked; no notifications or API keys appeared in the reviewed recording.
- Final audio finishing: an output peak limiter was applied at −2 dBFS without automatic gain or pitch/speed changes. The measured oversampled peak is −1.85 dBFS. The video bitstream remained identical, and the adjusted file passed another complete decode. The limiter reduces output peaks; it does not reconstruct any overload already present in the original human recording. Evidence: `entrega/video-build/audio-limit-report.json`.
