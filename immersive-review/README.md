# Development

See the [project README](../README.md) for installation and the [configuration guide](docs/CONFIGURATION.md) for settings and storage.

```sh
npm ci
npm run dev
npm test
npm run typecheck
npm run build       # dist/ and build/server.mjs
npm start           # http://127.0.0.1:5174
npm run build:demo  # static demo without server APIs
```

The production server serves `dist`, the assistant API and `/healthz`. Docker uses this server, not Vite.

For GitHub Pages, select **GitHub Actions** in the repository's Pages settings. The workflow deploys `main` with the repository path configured automatically. Other static hosts can set `READ_PUBLIC_BASE` before building; the default is `/`.

| Path | Contents |
| --- | --- |
| `src/notebook` | Notes, books, editor, search, assistant and reading activity |
| `src/content`, `src/Markdown.tsx` | Markdown, code and media rendering |
| `src/memory` | Memory engine and IndexedDB storage |
| `src/manual-demo` | Reference rendering and compatibility with existing content |
| `src/i18n.ts` | English and Simplified Chinese interface preferences |
| `server` | Provider configuration, chat, scoring and HTTP server |
| `tests` | Storage, editing, API and deployment tests |
| `public/vendor`, `public/licenses` | Bundled editor assets and licenses |

English is the default. Users can switch to **简体中文** in **Settings → General → Language**; content is never translated automatically.

Keep existing database names, content IDs and migrations when changing storage. Run browser checks on a separate origin with test data and placeholder credentials. Before publishing, run `node scripts/check-publish.mjs` from the repository root.
