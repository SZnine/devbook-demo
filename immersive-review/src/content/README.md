# Markdown rendering

`src/Markdown.tsx` uses the bundled Vditor/Lute renderer with HTML sanitization. While it loads, React Markdown, GFM and sanitize provide a fallback. Renderer changes preserve scroll position and expanded content.

- Expressive Code renders code fences with language, line numbers and theme support. Editable code uses the editor's own highlighting.
- KaTeX renders mathematics; Mermaid renders diagrams with the configured security settings. Unsupported content remains readable text.
- Images and links use supplied URLs. External resources make network requests; links opening a new tab include `noopener noreferrer`.
- HTML passes through sanitization. Heading anchors are isolated per renderer instance, and quoted code retains its Markdown formatting.

References: [Vditor](https://github.com/Vanessa219/vditor), [Expressive Code](https://expressive-code.com/), [Mermaid security settings](https://mermaid.js.org/config/schema-docs/config.html), [DOMPurify](https://github.com/cure53/DOMPurify).

Third-party licenses are in `public/licenses` and `public/vendor`.
