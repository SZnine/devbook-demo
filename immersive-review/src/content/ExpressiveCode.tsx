import { t, useLanguage } from '../i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Element, RootContent } from 'hast';
import { codeSurface, darkCodeSurface, darkCodeThemeName, loadCodeTheme } from './code-theme';
import './expressive-code.css';

export type CodeBlockInput = { code: string; language?: string; meta?: string };
export type RenderedCode = { html: string; styles: string[] };

const renderCache = new Map<string, Promise<RenderedCode>>();
const completed = new Map<string, RenderedCode>();
const styleCache = new WeakMap<Document, Set<string>>();
const CACHE_LIMIT = 80;

// The engine is loaded once, only when a code block approaches the viewport.
// Imported code and fence metadata are data: no evaluated scripts or MDX.
async function createEngine() {
  const [{ ExpressiveCode }, { pluginLineNumbers }, { toHtml }, { bundledLanguages }] = await Promise.all([
    import('expressive-code'), import('@expressive-code/plugin-line-numbers'), import('expressive-code/hast'), import('shiki/langs'),
  ]);
  const engine = new ExpressiveCode({
    themes: [await loadCodeTheme(), await loadCodeTheme('dark')],
    useDarkModeMediaQuery: false,
    // EC scopes nested CSS itself: selector lists inside themeCssRoot are
    // flattened incorrectly by its processor. Keep the root/selectors singular.
    themeCssRoot: ':root',
    themeCssSelector: theme => theme.name === darkCodeThemeName ? '[data-read-theme="dark"]'
      : '[data-read-theme="light"]',
    shiki: { engine: 'javascript' },
    plugins: [pluginLineNumbers()],
    defaultProps: { showLineNumbers: false },
    frames: { extractFileNameFromCode: false, showCopyToClipboardButton: false },
    styleOverrides: {
      borderRadius: '10px', borderColor: [darkCodeSurface.border, codeSurface.border], codeBackground: [darkCodeSurface.background, codeSurface.background],
      codeFontFamily: '"Cascadia Code", Consolas, "SFMono-Regular", monospace',
      codeFontSize: '13px', codeLineHeight: '1.75', codePaddingBlock: '18px',
      uiFontFamily: 'inherit', uiFontSize: '12px',
      frames: { frameBoxShadowCssValue: 'none', editorTabBarBackground: [darkCodeSurface.header, codeSurface.header], editorActiveTabBackground: [darkCodeSurface.background, codeSurface.background],
        terminalBackground: [darkCodeSurface.background, codeSurface.background], terminalTitlebarBackground: [darkCodeSurface.header, codeSurface.header], terminalTitlebarDotsOpacity: '0.4' },
    },
  });
  const styles = await Promise.all([engine.getBaseStyles(), engine.getThemeStyles()]);
  const supported = new Set([...Object.keys(bundledLanguages), 'text', 'txt', 'plaintext', 'ansi']);
  return { engine, toHtml, styles, supported };
}
let enginePromise: ReturnType<typeof createEngine> | undefined;

function markPresentation(node: Element | RootContent) {
  if (node.type !== 'element') return;
  const classes = (node.properties.className || []) as string[];
  if (node.tagName === 'figcaption' || classes.includes('gutter')) {
    node.properties['dataSelectionIgnore'] = '';
    node.properties['dataContentControl'] = '';
  }
  if (classes.includes('gutter')) node.properties.ariaHidden = 'true';
  if (node.tagName === 'pre') {
    node.properties.tabIndex = 0;
    node.properties.ariaLabel = t("代码", "Code");
  }
  node.children.forEach(markPresentation);
}

/** Renders only library-produced HAST; user text is escaped by Expressive Code. */
export function getRenderedExpressiveCode({ code, language = 'text', meta = '' }: CodeBlockInput): RenderedCode | undefined {
  return completed.get(JSON.stringify([code, language, meta]));
}

export function renderExpressiveCode({ code, language = 'text', meta = '' }: CodeBlockInput): Promise<RenderedCode> {
  const key = JSON.stringify([code, language, meta]);
  const cached = renderCache.get(key);
  if (cached) {
    renderCache.delete(key); renderCache.set(key, cached);
    return cached;
  }
  const result = (async () => {
    const { engine, toHtml, styles, supported } = await (enginePromise ??= createEngine().catch(error => { enginePromise = undefined; throw error; }));
    const selectedLanguage = supported.has(language) ? language : 'text';
    let rendered;
    try { rendered = await engine.render({ code, language: selectedLanguage, meta }); }
    catch { rendered = await engine.render({ code, language: 'text', meta: '' }); }
    markPresentation(rendered.renderedGroupAst);
    return { html: toHtml(rendered.renderedGroupAst), styles: [...styles, ...rendered.styles] };
  })();
  renderCache.set(key, result);
  if (renderCache.size > CACHE_LIMIT) {
    const oldest = renderCache.keys().next().value!;
    renderCache.delete(oldest); completed.delete(oldest);
  }
  void result.then(value => {
    if (renderCache.get(key) === result) completed.set(key, value);
  }, () => {
    if (renderCache.get(key) === result) { renderCache.delete(key); completed.delete(key); }
  });
  return result;
}

function installStyles(doc: Document, styles: string[]) {
  let installed = styleCache.get(doc);
  if (!installed) { installed = new Set(); styleCache.set(doc, installed); }
  for (const css of styles) {
    if (installed.has(css)) continue;
    const style = doc.createElement('style');
    style.dataset.expressiveCode = '';
    style.textContent = css;
    doc.head.append(style);
    installed.add(css);
  }
}

export function ExpressiveCodeBlock({ code, language = 'text', meta = '' }: CodeBlockInput) {
  const { language: interfaceLanguage } = useLanguage();
  const host = useRef<HTMLDivElement>(null);
  const resetCopy = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState<{ key: string; result: RenderedCode } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const key = JSON.stringify([code, language, meta]);
  const current = rendered?.key === key ? rendered.result : getRenderedExpressiveCode({ code, language, meta });

  useLayoutEffect(() => {
    if (current && host.current) {
      installStyles(host.current.ownerDocument, current.styles);
      host.current.querySelectorAll('pre').forEach(node => node.setAttribute('aria-label', t('代码', 'Code')));
    }
  }, [current, interfaceLanguage]);

  useEffect(() => {
    const element = host.current;
    if (!element || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '600px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || current) return;
    let live = true;
    void renderExpressiveCode({ code, language, meta }).then(result => {
      if (!live || !host.current) return;
      setRendered({ key, result });
    }).catch(() => { if (live) setFailedKey(key); });
    return () => { live = false; };
  }, [code, language, meta, key, visible, current]);

  useEffect(() => { setCopyState('idle'); return () => clearTimeout(resetCopy.current); }, [key]);

  async function copyCode() {
    clearTimeout(resetCopy.current);
    try { await navigator.clipboard.writeText(code); setCopyState('copied'); }
    catch { setCopyState('failed'); }
    resetCopy.current = setTimeout(() => setCopyState('idle'), 1800);
  }

  const copyLabel = copyState === 'copied' ? t("已复制", "Copied") : copyState === 'failed' ? t("复制失败，重试", "Copy failed. Retry") : t("复制代码", "Copy code");
  return <div ref={host} className="code-presentation not-content" data-code-status={current ? 'rendered' : failedKey === key ? 'fallback' : 'pending'}>
    {current ? <div className="code-highlight" dangerouslySetInnerHTML={{ __html: current.html }} />
      : <pre className="code-fallback" tabIndex={0} aria-label={t("代码", "Code")}><code>{code}</code></pre>}
    <button type="button" className="code-copy" data-content-control="" data-selection-ignore="" data-state={copyState}
      aria-label={copyLabel} title={copyLabel} onClick={event => { event.stopPropagation(); void copyCode(); }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        {copyState === 'copied' ? <path d="m5 12 4 4L19 6" /> : <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>}
      </svg>
    </button>
    <span className="code-copy-status" role="status" data-content-control="" data-selection-ignore="">{copyState === 'idle' ? '' : copyLabel}</span>
  </div>;
}
