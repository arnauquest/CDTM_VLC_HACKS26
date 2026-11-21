# Local configuration

This checkout is prepared for development on the team's Mac. Application implementation has not started. The environment file describes intended settings; no service reads them yet.

Repository: https://github.com/arnauquest/CDTM_VLC_HACKS26

Working branch: `codex/local-setup`. Keep frontend integration and subsequent implementation on a dedicated branch. Do not force-push or replace another contributor's work.

## Credentials

Edit the ignored `.env` file locally. Set `OPENAI_API_KEY` first. Codex is already signed in with ChatGPT on this Mac; that session does not supply API credentials for Decisions or audio analysis.

Set `ELEVENLABS_API_KEY` for voice. Choose the agent and voice after the first account access check. Gemini is an optional alternative for audio analysis. The supplied Sherpas case files work without an MCP token.

- OpenAI API keys: https://platform.openai.com/api-keys
- ElevenLabs API keys: https://elevenlabs.io/app/developers/api-keys
- Optional Google AI Studio key: https://aistudio.google.com/apikey

The local `.env` uses owner-only file permissions. `.env.example` contains empty credential values and can be committed. Recordings, local databases, agent workspaces and logs are ignored.

## Installed tools

From the Toni workspace, run `source ./activar-herramientas.zsh` to use the installed `codex`, `claude`, `opencode` and `gh` commands. `Abrir-Codex.command` opens Codex in this checkout and starts login only if needed. `Iniciar-sesion-Claude.command` and `Iniciar-sesion-OpenCode.command` start their respective account setup.

The account files remain in each tool's standard user profile or macOS Keychain. They are not copied into this repository.

## Intended runtime

The backend, worker, SQLite database and frontend will run on this Mac. Calls will use browser audio. Provider API access still needs internet. No cloud deployment or phone-network integration is configured.

Manual mode queues every outgoing communication for approval. Automatic mode sends eligible communications and queues exceptions. The backend must enforce the current mode; changing this environment variable alone is not yet functional. Calls are prepared with goals, facts, likely questions, alternative conversation paths and clear escalation limits.

Default `manual` and simulated delivery support the published Sherpas demo rules. `auto` remains a planned product mode for local simulation. The interface and runtime ports will be aligned with the frontend before implementation.
