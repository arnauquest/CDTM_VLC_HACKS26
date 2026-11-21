# Local configuration

This checkout is prepared for development on the team's Mac. Application implementation has not started. The environment file describes intended settings; no service reads them yet.

Repository: https://github.com/arnauquest/CDTM_VLC_HACKS26

Working branch: `codex/local-setup`. Keep frontend integration and subsequent implementation on a dedicated branch. Do not force-push or replace another contributor's work.

## Credentials

Edit the ignored `.env` file locally. Set `OPENAI_API_KEY` first for Decisions and API-based conversation models. Codex is already signed in with ChatGPT on this Mac and uses that subscription session separately.

Set `ELEVENLABS_API_KEY` for voice. Choose the agent and voice after the first account access check. Acoustic tone analysis has no selected provider yet: `VOICE_ANALYSIS_PROVIDER=none` and an empty model. The future backend must expose that status and continue analysis from transcript, context and self-report. The supplied Sherpas case files work without an MCP token.

- OpenAI API keys: https://platform.openai.com/api-keys
- ElevenLabs API keys: https://elevenlabs.io/app/developers/api-keys
- Optional Google AI Studio key: https://aistudio.google.com/apikey

The local `.env` uses owner-only file permissions. `.env.example` contains empty credential values and can be committed. Recordings, local databases, agent workspaces and logs are ignored.

## Installed tools

From the Toni workspace, run `source ./activar-herramientas.zsh` to use the installed `codex`, `claude`, `opencode` and `gh` commands. `Abrir-Codex.command` opens Codex in this checkout and starts login only if needed. `Iniciar-sesion-Claude.command` and `Iniciar-sesion-OpenCode.command` start their respective account setup.

The account files remain in each tool's standard user profile or macOS Keychain. They are not copied into this repository.

### Codex verified for backend use

On 21 November 2026, `codex exec` completed a synthetic configuration check using saved ChatGPT authentication, without API key environment variables. It returned the expected JSON with exit code 0 in 4.97 seconds. This checks authentication, non-interactive invocation and structured output; it does not benchmark the full application or validate financial decisions.

Verified options: `--ignore-user-config --ephemeral --skip-git-repo-check --sandbox read-only --json --output-schema <schema> --output-last-message <result> -C <job-directory>`.

For the future worker, keep each job's family context and output in its own directory, use a fresh execution, validate the returned JSON, and let the backend apply any proposed database changes. Preserve the current user's Codex credential store. Remove API credential overrides from the child environment when choosing the subscription adapter. CLI JSONL events and the final response are separate outputs.

Configuration check files are local and ignored under `var/config-check/codex/`. Re-run login only if authentication fails; no new login is currently needed.

## Intended runtime

The backend, worker, SQLite database and frontend will run on this Mac. Calls will use browser audio. Provider API access still needs internet. No cloud deployment or phone-network integration is configured.

Manual mode queues every outgoing communication for approval. Automatic mode sends eligible communications and queues exceptions. The backend must enforce the current mode; changing this environment variable alone is not yet functional. Calls are prepared with goals, facts, likely questions, alternative conversation paths and clear escalation limits.

The default is `auto`, as requested by the team. Delivery remains simulated. `manual` is available for a run requiring approval of every communication. The interface and runtime ports will be aligned with the frontend before implementation.
