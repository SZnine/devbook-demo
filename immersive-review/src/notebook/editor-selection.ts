import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Heading, Nodes as MarkdownNode } from 'mdast';

export type MarkdownSectionContext = {
  title?: string;
  depth?: number;
  markdown: string;
  start: number;
  end: number;
};

export type ChapterSelection = {
  text: string;
  markdown: string;
  before: string;
  after: string;
  context?: MarkdownSectionContext;
  canDelete: boolean;
  deleteSelection: () => boolean;
};

type SelectionCapture = () => ChapterSelection | null;
type RegisteredEditor = { capture: SelectionCapture; readMarkdown: () => string | null };
const chapterSelections = new WeakMap<HTMLElement, RegisteredEditor>();

export function registerChapterSelection(host: HTMLElement, capture: SelectionCapture, readMarkdown: () => string | null) {
  const registration = { capture, readMarkdown };
  chapterSelections.set(host, registration);
  return () => { if (chapterSelections.get(host) === registration) chapterSelections.delete(host); };
}

function editorHosts(scope: HTMLElement) {
  return [scope.closest<HTMLElement>('.chapter-editor-host'), ...scope.querySelectorAll<HTMLElement>('.chapter-editor-host')];
}

/** Include the latest keystroke even when the autosave has not committed yet. */
export function readChapterMarkdown(scope: HTMLElement): string | null {
  for (const host of editorHosts(scope)) {
    const markdown = host && chapterSelections.get(host)?.readMarkdown();
    if (typeof markdown === 'string') return markdown;
  }
  return null;
}

/** A menu owns this immutable selection snapshot, independently of toolbar focus. */
export function captureChapterSelection(scope: HTMLElement, sourceMarkdown?: string): ChapterSelection | null {
  let ownsEditor = false;
  for (const host of editorHosts(scope)) {
    const registration = host && chapterSelections.get(host);
    if (!registration) continue;
    ownsEditor = true;
    const selected = registration.capture();
    if (selected) return selected;
  }
  // A collapsed source selection must not fall through to a stale DOM Range
  // retained in Vditor's hidden rich-text field after switching modes.
  if (ownsEditor) return null;
  // Rendered reference material can be quoted, but is not an editable document.
  // The reference title outside .markdown is navigation, not a source heading.
  const root = scope.matches('.markdown') ? scope : scope.querySelector<HTMLElement>('.markdown') ?? scope.querySelector<HTMLElement>('.cw-prose') ?? scope;
  const selection = captureRenderedSelection(root, html => {
    const runtime = (window as unknown as { Lute?: { New: () => { HTML2Md: (html: string) => string } } }).Lute;
    return runtime?.New().HTML2Md(html) ?? '';
  }, sourceMarkdown);
  return selection ? { ...selection, canDelete: false, deleteSelection: () => false } : null;
}

/** Match Vditor's copy path, retaining the formatting ancestors of a partial selection. */
export function captureRenderedSelection(root: HTMLElement, serialize: (html: string) => string, sourceMarkdown?: string) {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || range.collapsed || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const text = range.toString();
  const parent = (node: Node) => node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  const code = parent(range.startContainer)?.closest('pre > code');
  let markdown: string;
  if (code && code.contains(range.endContainer)) {
    const fragment = document.createElement('div');
    fragment.appendChild(range.cloneContents());
    fragment.querySelectorAll('[data-selection-ignore]').forEach(node => node.remove());
    const lines = Array.from(fragment.querySelectorAll('.ec-line'));
    const content = lines.length ? lines.map(line => (line.querySelector('.code') ?? line).textContent ?? '').join('\n') : fragment.textContent ?? text;
    const language = Array.from(code.classList).find(name => name.startsWith('language-'))?.slice(9)
      ?? code.closest('[data-language]')?.getAttribute('data-language') ?? '';
    markdown = fencedSelection(content, language);
  } else {
    let fragment: Node = range.cloneContents();
    let ancestor = parent(range.commonAncestorContainer);
    // cloneContents omits the common ancestor: selecting only bold text, a
    // link label or a heading must still retain that element's Markdown.
    while (ancestor && ancestor !== root && root.contains(ancestor)) {
      const wrapper = ancestor.cloneNode(false);
      wrapper.appendChild(fragment);
      fragment = wrapper;
      ancestor = ancestor.parentElement;
    }
    const container = document.createElement('div');
    container.appendChild(fragment);
    container.querySelectorAll('[data-selection-ignore],.vditor-panel,.copy,.header').forEach(node => node.remove());
    markdown = serialize(container.innerHTML).trim() || text;
  }
  const head = range.cloneRange(); head.selectNodeContents(root); head.setEnd(range.startContainer, range.startOffset);
  const tail = range.cloneRange(); tail.selectNodeContents(root); tail.setStart(range.endContainer, range.endOffset);
  return { text, markdown, before: head.toString().slice(-300), after: tail.toString().slice(0, 300), range: range.cloneRange(),
    context: sourceMarkdown === undefined ? undefined : sectionForRenderedRange(root, range, sourceMarkdown) };
}

export function fencedSelection(content: string, language = '') {
  const longestFence = Math.max(0, ...Array.from(content.matchAll(/`+/g), match => match[0].length));
  const fence = '`'.repeat(Math.max(3, longestFence + 1));
  const safeLanguage = language.trim().split(/\s/)[0].replace(/`/g, '');
  return `${fence}${safeLanguage}\n${content}${content.endsWith('\n') ? '' : '\n'}${fence}`;
}

type FencedBlock = { content: string; markdown: string; language: string; contentStart: number; contentEnd: number };
function fencedBlocks(markdown: string): FencedBlock[] {
  const lines = Array.from(markdown.matchAll(/[^\n]*(?:\n|$)/g)).filter(match => match[0]);
  const result: FencedBlock[] = [];
  let opening: { marker: string; language: string; start: number; contentStart: number } | null = null;
  for (const line of lines) {
    const raw = line[0].replace(/\r?\n$/, '');
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(raw);
    if (!match) continue;
    if (!opening) {
      if (match[1][0] === '`' && match[2].includes('`')) continue;
      opening = { marker: match[1], language: match[2].trim().split(/\s/)[0], start: line.index!, contentStart: line.index! + line[0].length };
    } else if (match[1][0] === opening.marker[0] && match[1].length >= opening.marker.length && !match[2].trim()) {
      result.push({ content: markdown.slice(opening.contentStart, line.index), markdown: markdown.slice(opening.start, line.index! + raw.length), language: opening.language, contentStart: opening.contentStart, contentEnd: line.index! });
      opening = null;
    }
  }
  return result;
}

export function markdownForSourceSelection(source: string, start: number, end: number) {
  const block = fencedBlocks(source).find(item => start >= item.contentStart && end <= item.contentEnd);
  return block ? fencedSelection(source.slice(start, end), block.language) : source.slice(start, end);
}

type VisibleSegment = { text: string; code?: boolean };
const legacyMarkdownParser = unified().use(remarkParse).use(remarkGfm);

function documentHeadings(markdown: string) {
  // Only document-level headings form the outline. A heading inside a quoted
  // example or list belongs to that example rather than starting a new section.
  return legacyMarkdownParser.parse(markdown).children.filter((node): node is Heading => node.type === 'heading');
}

function sectionForHeading(markdown: string, headings: Heading[], index: number): MarkdownSectionContext {
  if (index < 0) {
    const end = headings[0]?.position?.start.offset ?? markdown.length;
    return { markdown: markdown.slice(0, end).trimEnd(), start: 0, end };
  }
  const heading = headings[index];
  const start = heading.position!.start.offset!;
  const next = headings.slice(index + 1).find(candidate => candidate.depth <= heading.depth);
  const end = next?.position?.start.offset ?? markdown.length;
  return { title: inlineVisibleText(heading) ?? '', depth: heading.depth,
    markdown: markdown.slice(start, end).trimEnd(), start, end };
}

/** Heading membership is positional; repeated text must never pick its first occurrence. */
export function markdownSectionAt(markdown: string, sourceOffset: number): MarkdownSectionContext {
  const headings = documentHeadings(markdown);
  const offset = Number.isFinite(sourceOffset) ? Math.max(0, Math.min(sourceOffset, markdown.length)) : 0;
  let index = -1;
  for (let current = 0; current < headings.length; current++) {
    if (headings[current].position!.start.offset! > offset) break;
    index = current;
  }
  return sectionForHeading(markdown, headings, index);
}

/** Map the live DOM outline by ordinal, not by searching the quoted words. */
export function markdownSectionForRenderedHeading(markdown: string, outline: { depth: number; title: string }[], headingIndex: number): MarkdownSectionContext {
  const headings = documentHeadings(markdown);
  const cleanTitle = (value: string) => value.replace(/\u200b/g, '').trim();
  const aligned = headings.length === outline.length && headings.every((heading, index) => heading.depth === outline[index].depth
    && cleanTitle(inlineVisibleText(heading) ?? '') === cleanTitle(outline[index].title));
  // Unknown embedded HTML can add headings to the DOM. Keep the current body
  // intact rather than guessing which source heading it represents.
  if (!aligned || headingIndex < -1 || headingIndex >= headings.length) return { markdown, start: 0, end: markdown.length };
  return sectionForHeading(markdown, headings, headingIndex);
}

export function isDocumentOutlineHeading(heading: Element, root: Element) {
  let node: Element | null = heading;
  // Vditor's entire WYSIWYG field is itself a PRE. Only content containers
  // inside that field exclude a heading; never inspect the host or its parents.
  while (node && node !== root) {
    if (node.matches('blockquote,li,pre,code,[data-selection-ignore]')) return false;
    node = node.parentElement;
  }
  return node === root;
}

function sectionForRenderedRange(root: HTMLElement, range: Range, markdown: string) {
  const headings = Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'))
    .filter(heading => isDocumentOutlineHeading(heading, root));
  let index = -1;
  for (let current = 0; current < headings.length; current++) {
    const position = document.createRange(); position.selectNode(headings[current]);
    if (position.compareBoundaryPoints(Range.START_TO_START, range) > 0) break;
    index = current;
  }
  return markdownSectionForRenderedHeading(markdown, headings.map(heading => ({ depth: Number(heading.tagName.slice(1)), title: heading.textContent ?? '' })), index);
}

function inlineVisibleText(node: MarkdownNode): string | null {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  if (node.type === 'break') return '\n';
  if (['paragraph', 'heading', 'tableCell', 'strong', 'emphasis', 'delete', 'link', 'linkReference'].includes(node.type) && 'children' in node) {
    const parts = node.children.map(inlineVisibleText);
    return parts.some(part => part === null) ? null : parts.join('');
  }
  // HTML, images, math and footnotes do not have a reliably equivalent visible
  // text snapshot. Keep those old quotations untouched instead of guessing.
  return null;
}

function visibleSegments(node: MarkdownNode, source: string): VisibleSegment[] | null {
  if (node.type === 'code') {
    const raw = source.slice(node.position?.start.offset, node.position?.end.offset);
    if (/^ {0,3}(?:`{3,}|~{3,})/.test(raw) && !fencedBlocks(raw).length) return null;
    return [{ text: node.value, code: true }];
  }
  if (node.type === 'definition' || node.type === 'thematicBreak') return [];
  if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'tableCell') {
    const text = inlineVisibleText(node);
    return text === null ? null : [{ text }];
  }
  if (['root', 'blockquote', 'list', 'listItem', 'table', 'tableRow'].includes(node.type) && 'children' in node) {
    const parts = node.children.map(child => visibleSegments(child, source));
    return parts.some(part => part === null) ? null : parts.flat() as VisibleSegment[];
  }
  return null;
}

function matchesWholeVisibleDocument(quote: string, markdown: string) {
  const segments = visibleSegments(legacyMarkdownParser.parse(markdown), markdown);
  if (!segments?.some(segment => segment.text.trim())) return false;
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = segments.map(segment => segment.code ? escape(segment.text.replace(/\r\n?/g, '\n'))
    : segment.text.split(/(\s+)/).map(part => /^\s+$/.test(part) ? '\\s+' : escape(part)).join('')).join('\\s*');
  // Block boundaries varied between the old DOM textContent and visual copy
  // paths. Code contents are exact: no whitespace normalization within code.
  return new RegExp(`^\\s*${pattern}\\s*$`, 'u').test(quote.replace(/\r\n?/g, '\n'));
}

/** Recover only an exact code block or the entire unchanged visible document. */
export function recoverLegacyQuoteMarkdown(quote: string, originalMarkdown: string): string | null {
  if (!quote.trim()) return null;
  // Legacy capture trimmed the snapshot boundaries, so compare the same edges.
  const matches = fencedBlocks(originalMarkdown).filter(block => block.content.trim() === quote.trim());
  if (matches.length === 1) return matches[0].markdown;
  if (matches.length > 1) return null;
  return matchesWholeVisibleDocument(quote, originalMarkdown) ? originalMarkdown : null;
}
