# Configuration

## Deployment

Copy the root `.env.example` to `.env`. Both Docker Compose and `npm start` read this file. Recreate the container or restart Node after changing it.

| Variable | Default | Purpose |
| --- | --- | --- |
| `READ_BIND_ADDRESS` | `127.0.0.1` | Docker host binding |
| `READ_PORT` | `5174` | Docker host port or native Node port |
| `READ_ALLOWED_ORIGINS` | localhost and 127.0.0.1 at the configured port | Comma-separated exact origins, e.g. `https://read.example.com`; no paths or wildcards |
| `READ_AI_TIMEOUT_MS` | `180000` | Request timeout, 1000–600000 ms |
| `READ_MAX_BODY_BYTES` | `1048576` | Request body limit, 1024–16777216 bytes; field limits still apply |
| `READ_HOST` | `127.0.0.1` | Native Node binding; fixed to `0.0.0.0` in Docker |
| `READ_DATA_DIR` | `.local` | Native configuration directory relative to the app; fixed to `/data` in Docker |

The container listens on port 5174. For example, `READ_PORT=5274` makes it available at `http://127.0.0.1:5274/`. A different host or port has separate browser storage.

Read is a single-user application without account authentication. A reverse proxy must preserve `Host`, use an allowed origin and provide access control. The server does not trust `X-Forwarded-*` headers; origin checks do not replace authentication.

## Settings

| Setting | Location |
| --- | --- |
| Language | **Settings → General → Language**; English by default, with 简体中文 available |
| Appearance | **Settings → General**, or the toolbar theme button |
| Block toolbar, compact controls, Markdown hints | **Settings → General**, or toolbar settings; `Ctrl+Alt+M` toggles the toolbar |
| Export folder and data exports | **Settings → Files** |
| AI providers | **Settings → AI providers** |
| Assistant width | Drag its left edge, or focus the divider and use arrow keys |
| Model and response style | Assistant composer |
| Attached context | Selection, full section, or section with chapter outline and book title |
| Retention duration and decay weight | **Memory → Settings**; ranges 0.25–4× and 0.5–2 |
| Automatic priority | **Memory → Settings**; choose a model and focus, then update priorities |
| Manual priority | **Reading history → Scoring**; 0–1, with an option to restore automatic priority |

Interface preferences stay in the current browser. Changing language does not translate notes or book content. New assistant replies and scoring reasons use the selected language.

## AI providers

Configure providers in **Settings → AI providers**. Use a base URL without `/chat/completions`, credentials or query parameters. Enter model IDs one per line or separated by commas.

Environment variables can supply initial values for `GLM`, `DEEPSEEK` and `CUSTOM_AI`:

| Suffix | Example | Value |
| --- | --- | --- |
| `_API_KEY` | `GLM_API_KEY` | API key |
| `_BASE_URL` | `DEEPSEEK_BASE_URL` | Chat Completions-compatible base URL |
| `_MODELS` | `CUSTOM_AI_MODELS` | Comma-separated model IDs |

**Saved settings override environment values, which override defaults.** Leave the key field blank to keep an existing key. Select **Remove saved key** and save to clear it; restarting will not restore the environment key.

Keys are stored unencrypted in `assistant-config.json`, under `immersive-review/.local/` for native Node or `/data/` in Docker. They are not returned to the browser. Keep this writable directory outside `dist` and out of version control. Entering keys through settings also keeps them out of Compose environment output.

The static demo supports editing and exports. Provider configuration and requests require a local installation.

## Files and storage

**Settings → Files** can remember a local export folder in desktop browsers that support the File System Access API. The browser may request write permission again. Without folder access, exports use normal browser downloads.

The folder is an export destination, not automatic synchronization or container storage. Markdown exports contain notes and book content. JSON data copies include content, drafts, archived and deleted items, reading records, conversations and preferences; they exclude API keys, directory permissions and linked media. **JSON import is not available yet.**

| Data | Storage |
| --- | --- |
| Notes, chapters and reading records | Browser IndexedDB |
| Conversations and preferences | Browser site storage |
| Provider configuration | Docker named volume, or the native data directory |

Container restarts preserve browser content. Clearing site data removes it, so keep the same browser profile and address, and export regularly. The default Docker volume is `read_read-settings`; `docker compose down` preserves it, while `down -v` removes it.

To copy provider configuration:

```sh
docker compose stop
docker compose cp read:/data/assistant-config.json ./assistant-config.private.json
docker compose start
```

This file contains API keys. Keep it private. To restore it, copy it to `/data/assistant-config.json` with write access for the container user, then restart. This restores provider settings only; browser content is separate.
