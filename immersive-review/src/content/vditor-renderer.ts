/// <reference types="vite/client" />
import DOMPurify from 'dompurify';
import { fromHtml } from 'hast-util-from-html';
import type { Root, Element, Nodes } from 'hast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Code, Root as MarkdownRoot } from 'mdast';
import luteUrl from 'vditor/dist/js/lute/lute.min.js?url';

export type RenderedMarkdown = { tree: Root };
const cache = new Map<string, Promise<RenderedMarkdown>>();
const completed = new Map<string, RenderedMarkdown>();
let runtime: Promise<typeof import('vditor/dist/method')['default']> | undefined;

function loadRuntime() {
  runtime ??= Promise.all([
    import('vditor/dist/method'),
    new Promise<void>((resolve, reject) => {
      if (document.getElementById('vditorLuteScript')) return resolve();
      const script = document.createElement('script');
      script.src = luteUrl;
      script.onload = () => { script.id = 'vditorLuteScript'; resolve(); };
      script.onerror = () => { script.remove(); reject(new Error('Markdown 解析器加载失败')); };
      document.head.append(script);
    }),
  ]).then(([module]) => module.default).catch(error => { runtime = undefined; throw error; });
  return runtime;
}

function collectFences(tree: MarkdownRoot) {
  const fences: Code[] = [];
  const walk = (node: { type: string; children?: unknown[] }) => {
    if (node.type === 'code') fences.push(node as Code);
    node.children?.forEach(child => walk(child as typeof node));
  };
  walk(tree);
  return fences.map(node => ({ code: node.value, language: node.lang || '', meta: node.meta || '' }));
}

export function textOf(node: Nodes): string {
  return node.type === 'text' ? node.value : 'children' in node ? node.children.map(textOf).join('') : '';
}

/** Vditor owns Markdown syntax. HAST only bridges its sanitized output to React. */
export function getRenderedMarkdown(body: string): RenderedMarkdown | undefined {
  return completed.get(body);
}

export function renderMarkdown(body: string): Promise<RenderedMarkdown> {
  const found = cache.get(body);
  if (found) return found;
  const pending = loadRuntime().then(async Vditor => {
    const html = await Vditor.md2html(body, {
      mode: 'dark', cdn: `${import.meta.env.BASE_URL}vendor/vditor`, anchor: 0,
      markdown: { sanitize: true, footnotes: true, callout: true, mark: true, sup: true, sub: true,
        autoSpace: false, fixTermTypo: false, toc: false, imageCaption: true },
      math: { inlineDigit: true },
    });
    const safe = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['p','br','hr','h1','h2','h3','h4','h5','h6','strong','em','del','s','blockquote',
        'ul','ol','li','pre','code','a','table','thead','tbody','tfoot','tr','th','td','details','summary',
        'input','img','figure','figcaption','span','div','sup','sub','mark','kbd','dl','dt','dd','abbr'],
      ALLOWED_ATTR: ['href','title','src','alt','width','height','class','id','open','type','checked','disabled',
        'start','colspan','rowspan','align','data-subtype'],
      ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
    });
    const tree = fromHtml(safe, { fragment: true });
    // Vditor emits language classes but drops fence metadata. Read syntax only, never infer semantics.
    const remaining = collectFences(unified().use(remarkParse).parse(body));
    const walk = (node: Nodes) => {
      if (node.type === 'element' && node.tagName === 'pre') {
        const code = node.children.find(child => child.type === 'element' && child.tagName === 'code') as Element | undefined;
        if (code) {
          const text = textOf(code).replace(/\n$/, '');
          const index = remaining.findIndex(fence => fence.code === text);
          if (index >= 0) {
            const [fence] = remaining.splice(index, 1);
            node.properties.dataCodeLanguage = fence.language;
            node.properties.dataCodeMeta = fence.meta;
          }
        }
      }
      if ('children' in node) node.children.forEach(walk);
    };
    walk(tree);
    const result = { tree };
    // An evicted in-flight result must not re-enter the bounded cache later.
    if (cache.get(body) === pending) completed.set(body, result);
    return result;
  }).catch(error => {
    if (cache.get(body) === pending) { cache.delete(body); completed.delete(body); }
    throw error;
  });
  cache.set(body, pending);
  if (cache.size > 160) {
    const oldest = cache.keys().next().value!;
    cache.delete(oldest); completed.delete(oldest);
  }
  return pending;
}

/** Each rendered part owns its anchor namespace, including repeated footnote numbers. */
export function scopeAnchors(tree: Root, prefix: string): Root {
  const scoped = structuredClone(tree);
  const ids = new Set<string>();
  const walk = (node: Nodes, visit: (node: Element) => void) => {
    if (node.type === 'element') visit(node);
    if ('children' in node) node.children.forEach(child => walk(child, visit));
  };
  walk(scoped, node => { if (node.properties.id) ids.add(String(node.properties.id)); });
  walk(scoped, node => {
    if (node.properties.id) node.properties.id = prefix + node.properties.id;
    const href = String(node.properties.href || '');
    if (href.startsWith('#') && ids.has(href.slice(1))) node.properties.href = '#' + prefix + href.slice(1);
  });
  return scoped;
}
