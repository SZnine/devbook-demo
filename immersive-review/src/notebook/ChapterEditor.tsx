import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import type Vditor from 'vditor';
import { createDirectInsertion, type MarkdownInsertion, type MarkdownInsertKind } from './MarkdownInsertMenu';
import { useComponentLibrary } from './ComponentLibrary';
import { captureRenderedSelection, markdownForSourceSelection, markdownSectionAt, registerChapterSelection, type ChapterSelection } from './editor-selection';
import { codeTokenColors } from '../content/code-theme';
import 'vditor/dist/index.css';
import 'vditor/dist/js/highlight.js/styles/github.min.css';
import './chapter-editor.css';

export type ChapterEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onSave: (markdown: string) => Promise<boolean> | boolean;
  onCancel: () => void;
  autoFocus?: boolean;
  label?: string;
  placeholder?: string;
  mode?: 'ir' | 'sv';
  live?: boolean;
  initiallyDirty?: boolean;
  allowEmpty?: boolean;
  onCommit?: (markdown: string) => Promise<boolean>;
  onFocus?: () => void;
  onLeaveEmpty?: (target: EventTarget | null) => void;
};

const assetRoot = `${import.meta.env.BASE_URL}vendor/vditor`;
const renderedFieldSelector = '.vditor-wysiwyg [contenteditable="true"]';
// Keep the public mode name compatible with existing workspaces. Normal
// editing uses Vditor's Markdown-aware rich editor; only sv exposes source.
const nativeMode = (mode: 'ir' | 'sv') => mode === 'sv' ? 'sv' : 'wysiwyg';
let editorAssets: Promise<unknown> | undefined;
let editorConstructor: typeof Vditor | undefined;
let editorRuntime: Promise<typeof Vditor> | undefined;
type LocalHighlighter = { getLanguage: (name: string) => unknown; highlight: (source: string, options: { language: string; ignoreIllegals: boolean }) => { value: string } };
type HighlightRuntime = { Highlight?: new (...ranges: Range[]) => unknown; CSS?: { highlights?: Map<string, unknown> } };
const codeColors = Object.fromEntries(Object.entries(codeTokenColors).map(([kind, color]) => [kind, `var(--read-code-${kind}, ${color})`]));
const codeLanguages = [['plaintext', '纯文本'], ['python', 'Python'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['json', 'JSON'], ['bash', 'Shell'], ['sql', 'SQL'], ['html', 'HTML'], ['css', 'CSS']];
type BlockControl = { kind: 'heading' | 'code'; node: HTMLElement; value: string; top: number; left: number };
type CodeToken = { start: number; end: number; kind: string };

function cancelRenderedToolbarTimers(instance?: Vditor) {
  for (const renderer of [instance?.vditor.ir, instance?.vditor.wysiwyg]) {
    if (!renderer) continue;
    // Delayed toolbar callbacks must not inspect a source textarea selection.
    window.clearTimeout(renderer.hlToolbarTimeoutId);
    renderer.hlToolbarTimeoutId = 0;
  }
}

function loadLocalScript(path: string, id: string) {
  if (document.getElementById(id)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${assetRoot}/${path}`;
    script.onload = () => { script.id = id; resolve(); };
    script.onerror = () => { script.remove(); reject(new Error('编辑器资源未能加载')); };
    document.head.appendChild(script);
  });
}

function loadEditorAssets() {
  // Preload before construction: Vditor's async setup otherwise outlives a
  // rapidly unmounted editor. Every executable resource is served locally.
  editorAssets ??= Promise.all([
    loadLocalScript('dist/js/lute/lute.min.js', 'vditorLuteScript'),
    loadLocalScript('dist/js/i18n/zh_CN.js', 'vditorI18nScriptzh_CN'),
    loadLocalScript('dist/js/icons/ant.js', 'chapterVditorIcons'),
    loadLocalScript('dist/js/highlight.js/highlight.min.js', 'vditorHljsScript'),
  ]).catch(error => { editorAssets = undefined; throw error; });
  return editorAssets;
}

function loadEditorRuntime() {
  editorRuntime ??= Promise.all([import('vditor'), loadEditorAssets()])
    .then(([{ default: Editor }]) => (editorConstructor = Editor))
    .catch(error => { editorRuntime = undefined; throw error; });
  return editorRuntime;
}

// Warm local assets while the workspace opens, rather than after a chapter's
// empty editor hosts have already been painted. Failures still retry on mount.
void loadEditorRuntime().catch(() => {});

export function ChapterEditor({ value, onChange, onSave, onCancel, autoFocus, label = '章节正文', placeholder = '从这里开始写…', mode = 'ir', live = false, initiallyDirty = false, allowEmpty = false, onCommit, onFocus, onLeaveEmpty }: ChapterEditorProps) {
  const library = useComponentLibrary();
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const targetId = useId();
  const highlightPrefix = `read-code-${targetId.replace(/[^a-z0-9-]/gi, '')}`;
  const highlightStyle = useRef<HTMLStyleElement | null>(null);
  const highlightCache = useRef(new WeakMap<HTMLElement, { source: string; language: string; tokens: CodeToken[]; nodes: Text[]; ranges: Map<string, Range[]> }>());
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Vditor | null>(null);
  const current = useRef(value);
  const callbacks = useRef({ onChange, onSave, onCancel, autoFocus: autoFocus ?? !live, label, mode, live, allowEmpty, onCommit, onFocus, onLeaveEmpty });
  callbacks.current = { onChange, onSave, onCancel, autoFocus: autoFocus ?? !live, label, mode, live, allowEmpty, onCommit, onFocus, onLeaveEmpty };
  const composing = useRef(false);
  const savingRef = useRef(false);
  const mounted = useRef(false);
  const dirty = useRef(initiallyDirty);
  const initialDraftPending = useRef(initiallyDirty);
  const committed = useRef(value);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCommits = useRef(0);
  const commitSequence = useRef(0);
  const confirmedSequence = useRef(0);
  const lastSubmitted = useRef<string | null>(null);
  const switchingMode = useRef(false);
  const selections = useRef<Partial<Record<'ir' | 'sv', { value: string; start: number; end: number }>>>({});
  const insertBookmark = useRef<{ mode: 'ir' | 'sv'; range?: Range; start?: number; end?: number } | null>(null);
  const insertSelectedText = useRef('');
  const insertActions = useRef({ capture: captureInsertSelection, insert: insertComponent, focus: restoreInsertSelection });
  insertActions.current = { capture: captureInsertSelection, insert: insertComponent, focus: restoreInsertSelection };
  const insertTarget = useRef({
    id: `chapter-editor-${targetId}`,
    element: () => host.current,
    capture: () => insertActions.current.capture(),
    insert: (item: MarkdownInsertion) => { if (mounted.current) insertActions.current.insert(item); },
    focus: () => { if (mounted.current) insertActions.current.focus(); },
    undo: () => { if (mounted.current) performUndo(false); },
    redo: () => { if (mounted.current) performUndo(true); },
  });
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editingHint, setEditingHint] = useState('');
  const [blockControl, setBlockControl] = useState<BlockControl | null>(null);
  const [flowEnd, setFlowEnd] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!editingHint) return;
    const timer = window.setTimeout(() => setEditingHint(''), 4000);
    return () => window.clearTimeout(timer);
  }, [editingHint]);

  function clearUndoTimer(instance: Vditor) {
    const state = instance.vditor;
    if (state.currentMode === 'wysiwyg') window.clearTimeout(state.wysiwyg?.afterRenderTimeoutId);
    else if (state.currentMode === 'sv') window.clearTimeout(state.sv?.processTimeoutId);
    else window.clearTimeout(state.ir?.processTimeoutId);
  }

  function editorTransaction(action: () => void) {
    const instance = editor.current;
    const field = activeField();
    if (!instance || !field || composing.current || (field instanceof HTMLTextAreaElement ? field.disabled : field.getAttribute('contenteditable') === 'false')) return;
    clearUndoTimer(instance);
    instance.vditor.undo?.addToUndoStack(instance.vditor);
    action();
    clearUndoTimer(instance);
    refreshEmptyBlocks();
    instance.vditor.undo?.addToUndoStack(instance.vditor);
    captureInsertSelection();
    renderCodeHighlights();
    syncBlockControl();
    publishCurrent(true);
  }

  function performUndo(redo: boolean) {
    const instance = editor.current;
    const field = restoreInsertSelection();
    if (!instance || !field || composing.current || (field instanceof HTMLTextAreaElement ? field.disabled : field.getAttribute('contenteditable') === 'false')) return;
    clearUndoTimer(instance);
    if (!redo) instance.vditor.undo?.addToUndoStack(instance.vditor);
    if (redo) instance.vditor.undo?.redo(instance.vditor);
    else instance.vditor.undo?.undo(instance.vditor);
    refreshEmptyBlocks();
    captureInsertSelection();
    renderCodeHighlights();
    syncBlockControl();
    publishCurrent(true);
  }

  function refreshEmptyBlocks() {
    const field = host.current?.querySelector<HTMLElement>(renderedFieldSelector);
    if (!field) return;
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const parent = anchor?.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor?.parentElement;
    const node = document.activeElement === field && selection?.isCollapsed && anchor && field.contains(anchor)
      ? parent?.closest<HTMLElement>('h1,h2,h3,h4,h5,h6,p,li,[data-type="code-block"] > pre > code')
      : null;
    // A placeholder belongs to the active writing position, not every blank
    // paragraph left by Markdown structures. Keep all user whitespace intact.
    const empty = node && field.contains(node) && !node.textContent?.replace(/\u200b/g, '').trim() && !node.querySelector('img,video,audio,iframe,table');
    let tail = empty ? node : null;
    while (tail && tail !== field) {
      let next = tail.nextElementSibling;
      while (next?.matches('wbr,.vditor-wysiwyg__preview')) next = next.nextElementSibling;
      if (next) { tail = null; break; }
      tail = tail.parentElement;
    }
    const visible = tail === field ? node : null;
    field.querySelectorAll<HTMLElement>('[data-editor-placeholder]').forEach(previous => {
      if (previous !== visible) previous.removeAttribute('data-editor-placeholder');
    });
    if (!visible) return;
    const isCode = visible.tagName === 'CODE';
    const isHeading = /^H[1-6]$/.test(visible.tagName);
    const listItem = visible.closest('li');
    visible.dataset.editorPlaceholder = isCode ? '输入或粘贴代码…' : isHeading ? '标题' : listItem ? listItem.classList.contains('vditor-task') ? '待办事项' : '列表项' : visible.closest('blockquote') ? '引用内容' : '开始输入…';
  }

  function syncBlockControl() {
    syncFlowEnd();
    const field = activeField();
    if (!field || field instanceof HTMLTextAreaElement || !host.current || !mounted.current) { setBlockControl(null); return; }
    const focused = document.activeElement;
    if (focused?.closest('.chapter-block-control')) return;
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    if (focused !== field || !anchor || !field.contains(anchor)) { setBlockControl(null); return; }
    const parent = anchor.nodeType === Node.ELEMENT_NODE ? anchor as HTMLElement : anchor.parentElement;
    const node = parent?.closest<HTMLElement>('[data-type="code-block"],h1,h2,h3,h4,h5,h6');
    if (!node || !field.contains(node)) { setBlockControl(null); return; }
    const kind = node.matches('[data-type="code-block"]') ? 'code' : 'heading';
    const bounds = node.getBoundingClientRect();
    const hostBounds = host.current.parentElement!.getBoundingClientRect();
    const language = Array.from(node.querySelector('pre > code')?.classList ?? []).find(name => name.startsWith('language-'))?.slice(9) ?? 'plaintext';
    const next: BlockControl = { kind, node, value: kind === 'heading' ? node.tagName.toLowerCase() : language, top: kind === 'code' ? bounds.bottom - hostBounds.top - 29 : bounds.top - hostBounds.top + 2, left: Math.max(0, bounds.right - hostBounds.left - (kind === 'code' ? 92 : 49)) };
    setBlockControl(previous => previous?.node === next.node && previous.value === next.value && previous.top === next.top && previous.left === next.left ? previous : next);
  }

  function changeBlockControl(value: string) {
    const control = blockControl;
    const field = restoreInsertSelection();
    if (!control?.node.isConnected || !field || field instanceof HTMLTextAreaElement) return;
    editorTransaction(() => {
      if (control.kind === 'heading') {
        host.current?.querySelector<HTMLButtonElement>(`.vditor-toolbar [data-tag="${value}"]`)?.click();
      } else {
        control.node.querySelectorAll('pre > code').forEach(code => {
          Array.from(code.classList).filter(name => name.startsWith('language-')).forEach(name => code.classList.remove(name));
          if (value !== 'plaintext') code.classList.add(`language-${value}`);
        });
      }
    });
    field.focus({ preventScroll: true });
    syncBlockControl();
  }

  function activeField() {
    return host.current?.querySelector<HTMLElement>(editor.current?.getCurrentMode() === 'sv' ? '.vditor-sv' : renderedFieldSelector);
  }

  function captureInsertSelection() {
    const field = activeField();
    if (!field || !editor.current) return insertSelectedText.current;
    if (field instanceof HTMLTextAreaElement) {
      if (document.activeElement !== field) return insertSelectedText.current;
      insertBookmark.current = { mode: 'sv', start: field.selectionStart, end: field.selectionEnd };
      insertSelectedText.current = field.value.slice(field.selectionStart, field.selectionEnd);
      return insertSelectedText.current;
    }
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (range && field.contains(range.startContainer) && field.contains(range.endContainer)) {
      insertBookmark.current = { mode: 'ir', range: range.cloneRange() };
      insertSelectedText.current = range.toString();
    }
    // Parameter inputs in the component library must not replace the last
    // document selection when another pointer event requests a capture.
    return insertSelectedText.current;
  }

  function captureContextSelection(): ChapterSelection | null {
    const instance = editor.current;
    const field = activeField();
    if (!instance || !field) return null;
    const snapshot = instance.getValue();
    const sourceMode = instance.getCurrentMode() === 'sv';
    // The installed Vditor 4 source editor is a textarea. Choose the path by
    // editor mode so source syntax never passes through rich-text conversion.
    if (sourceMode && !(field instanceof HTMLTextAreaElement)) return null;
    const source = sourceMode ? field as HTMLTextAreaElement : null;
    // Textareas retain their old offsets after focus moves to a different
    // editor. Only the current source field may supply a citation selection.
    if (source && document.activeElement !== source) return null;
    const rendered = sourceMode ? null : captureRenderedSelection(field, html => instance.vditor.lute.VditorDOM2Md(html), snapshot);
    const start = source?.selectionStart ?? 0;
    const end = source?.selectionEnd ?? 0;
    if (source ? start === end : !rendered) return null;
    const bookmark = source
      ? { mode: 'sv' as const, start, end }
      : { mode: 'ir' as const, range: rendered!.range };
    const canDelete = !composing.current && !savingRef.current && (field instanceof HTMLTextAreaElement ? !field.disabled : field.getAttribute('contenteditable') !== 'false');
    return {
      text: rendered?.text ?? source!.value.slice(start, end),
      markdown: rendered?.markdown ?? markdownForSourceSelection(source!.value, start, end),
      before: rendered?.before ?? snapshot.slice(0, start).slice(-300),
      after: rendered?.after ?? snapshot.slice(end, end + 300),
      context: rendered?.context ?? (source ? markdownSectionAt(source.value, start) : undefined),
      canDelete,
      deleteSelection: () => {
        // Never replace a stale/lost selection with an entire-content delete.
        if (!canDelete || !mounted.current || editor.current !== instance || !field.isConnected || activeField() !== field || instance.getValue() !== snapshot) return false;
        if (bookmark.range && (!field.contains(bookmark.range.startContainer) || !field.contains(bookmark.range.endContainer) || bookmark.range.collapsed)) return false;
        insertBookmark.current = bookmark;
        restoreInsertSelection();
        // Official Vditor deleteValue uses the editor's own input path, while
        // this transaction shares the same undo stack as typing and toolbar edits.
        editorTransaction(() => instance.deleteValue());
        return instance.getValue() !== snapshot;
      },
    };
  }

  function restoreInsertSelection() {
    const field = activeField();
    const bookmark = insertBookmark.current;
    if (!field || !editor.current) return null;
    field.focus({ preventScroll: true });
    if (field instanceof HTMLTextAreaElement) {
      const end = field.value.length;
      field.setSelectionRange(bookmark?.mode === 'sv' ? bookmark.start ?? end : end, bookmark?.mode === 'sv' ? bookmark.end ?? end : end);
    } else {
      const saved = bookmark?.mode === 'ir' && bookmark.range && field.contains(bookmark.range.startContainer) && field.contains(bookmark.range.endContainer) ? bookmark.range : null;
      const range = saved ? saved.cloneRange() : document.createRange();
      if (!saved) { range.selectNodeContents(field); range.collapse(false); }
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    return field;
  }

  function activateInsertTarget() {
    if (switchingMode.current || !editor.current) return;
    libraryRef.current.activate(insertTarget.current);
    callbacks.current.onFocus?.();
  }

  function selectInsertedContent(field: HTMLElement, item: MarkdownInsertion, previous: Set<Element>) {
    const selectors = { heading: 'h1,h2,h3', code: '[data-type="code-block"]', table: 'table', bullet: 'ul', numbered: 'ol', todo: 'ul', quote: 'blockquote', divider: 'hr', link: 'a', image: 'img', text: 'p' };
    const target = Array.from(field.querySelectorAll<HTMLElement>(selectors[item.kind])).find(node => !previous.has(node));
    if (!target) return;
    const editable = item.kind === 'code' ? target.querySelector('pre code') : item.kind === 'table' ? target.querySelector('th') : target;
    if (!editable) return;
    const range = document.createRange();
    const wanted = item.markdown.slice(item.selectionStart, item.selectionEnd);
    const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
    let matched = false;
    while (wanted && walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest('.vditor-wysiwyg__preview')) continue;
      const start = node.textContent?.indexOf(wanted) ?? -1;
      if (start < 0) continue;
      range.setStart(node, start);
      range.setEnd(node, start + wanted.length);
      matched = true;
      break;
    }
    if (!matched) { range.selectNodeContents(editable); range.collapse(true); }
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function focusBlockContent(node: HTMLElement, selectText = false) {
    const range = document.createRange();
    range.selectNodeContents(node);
    if (!selectText) range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function insertStructuredBlock(field: HTMLElement, block: HTMLElement) {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!field.contains(range.startContainer) || !field.contains(range.endContainer)) return;
    if (range.startContainer === field && range.collapsed) {
      range.insertNode(block);
      return;
    }

    const topLevel = (node: Node): Node | null => {
      let result = node;
      while (result.parentNode && result.parentNode !== field) result = result.parentNode;
      return result.parentNode === field ? result : null;
    };
    const first = range.startContainer === field ? field.childNodes[range.startOffset] : topLevel(range.startContainer);
    const last = range.endContainer === field ? field.childNodes[Math.max(0, range.endOffset - 1)] : topLevel(range.endContainer);
    if (!first || !last) { range.deleteContents(); range.insertNode(block); return; }

    // Split the containing structures, rather than deleting text and then
    // appending after an emptied list / quote / code frame. Cloning the two
    // untouched sides also preserves their inline formatting and nesting.
    const before = range.cloneRange();
    before.setStartBefore(first);
    before.setEnd(range.startContainer, range.startOffset);
    const after = range.cloneRange();
    after.setStart(range.endContainer, range.endOffset);
    after.setEndAfter(last);
    const leading = before.cloneContents();
    const trailing = after.cloneContents();
    const pruneEmptyFrames = (fragment: DocumentFragment) => {
      fragment.querySelectorAll('.vditor-wysiwyg__preview,wbr').forEach(node => node.remove());
      const frames = fragment.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,ul,ol,blockquote,pre,table,[data-type="code-block"]');
      Array.from(frames).reverse().forEach(node => {
        if (!node.textContent?.replace(/\u200b/g, '').trim() && !node.querySelector('img,video,audio,iframe,table,hr')) node.remove();
      });
      Array.from(fragment.childNodes).forEach(node => {
        if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) node.remove();
      });
    };
    pruneEmptyFrames(leading);
    pruneEmptyFrames(trailing);
    const replacement = document.createDocumentFragment();
    replacement.append(leading, block, trailing);
    const affected = document.createRange();
    affected.setStartBefore(first);
    affected.setEndAfter(last);
    affected.deleteContents();
    affected.insertNode(replacement);
  }

  function insertDirectComponent(field: HTMLElement, item: MarkdownInsertion) {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    let range = selection.getRangeAt(0);
    const parent = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as HTMLElement : range.startContainer.parentElement;
    const existingCode = parent?.closest<HTMLElement>('[data-type="code-block"]');
    const existingTable = parent?.closest<HTMLTableElement>('table');
    const leaf = existingCode?.querySelector<HTMLElement>('pre > code') ?? parent?.closest<HTMLElement>('p,h1,h2,h3,h4,h5,h6,li,td,th');
    const wasSelected = !range.collapsed;
    let caretOffset = 0;
    if (range.collapsed && leaf?.contains(range.startContainer)) {
      const beforeCaret = range.cloneRange();
      beforeCaret.selectNodeContents(leaf);
      beforeCaret.setEnd(range.startContainer, range.startOffset);
      caretOffset = beforeCaret.toString().length;
    }

    // Choosing the existing component keeps its contents and caret. In
    // particular, code -> code must not nest or leave the old empty frame.
    if ((item.kind === 'code' && existingCode?.contains(range.endContainer)) || (item.kind === 'table' && range.collapsed && existingTable)) return;
    const convertsCurrent = ['heading', 'text', 'bullet', 'numbered', 'todo', 'quote'].includes(item.kind) || Boolean(existingCode);
    if (range.collapsed && leaf && field.contains(leaf) && convertsCurrent) {
      range = document.createRange();
      range.selectNodeContents(leaf);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    const focusConvertedContent = (node: HTMLElement) => {
      const next = document.createRange();
      next.selectNodeContents(node);
      const checkbox = node.classList.contains('vditor-task') ? node.querySelector('input') : null;
      const spacer = checkbox?.nextSibling;
      if (checkbox) next.setStartAfter(spacer?.nodeType === Node.TEXT_NODE && !spacer.textContent?.trim() ? spacer : checkbox);
      if (!wasSelected) {
        next.collapse(true);
        if (convertsCurrent && leaf) {
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          let remaining = caretOffset;
          let last: Text | null = null;
          while (walker.nextNode()) {
            const text = walker.currentNode as Text;
            if (text === spacer) continue;
            last = text;
            if (remaining <= text.length) { next.setStart(text, remaining); next.collapse(true); last = null; break; }
            remaining -= text.length;
          }
          if (last) { next.setStart(last, last.length); next.collapse(true); }
        }
      }
      selection.removeAllRanges();
      selection.addRange(next);
    };
    let selected = selection.toString();
    if (item.kind === 'code') {
      const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement;
      const end = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer as Element : range.endContainer.parentElement;
      const codeSelector = 'code:not([data-type="html-inline"]),[data-type="code-block"]';
      // Vditor uses zero-width spaces to keep ordinary rich-text markers
      // editable, and Lute removes them when that prose becomes Markdown.
      // Match that behavior only for prose-to-code conversion. Existing
      // source/inline-code selections may contain intentional zero widths;
      // Vditor's html-inline wrapper is still a prose editing marker.
      if (!start?.closest(codeSelector) && !end?.closest(codeSelector) && !range.cloneContents().querySelector(codeSelector)) selected = selected.replace(/\u200b/g, '');
    }
    if (item.kind === 'code') {
      const block = document.createElement('div');
      block.className = 'vditor-wysiwyg__block';
      block.dataset.type = 'code-block';
      block.dataset.block = '0';
      block.dataset.marker = '`'.repeat(Math.max(3, ...(selected.match(/`+/g)?.map(run => run.length + 1) ?? [3])));
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      // Never interpolate selected code as HTML. The native toolbar does,
      // which would swallow a selected <tag> instead of keeping its source.
      code.textContent = selected || '\n';
      if (item.language && item.language !== 'plaintext') code.className = `language-${item.language}`;
      pre.append(code);
      block.append(pre);
      insertStructuredBlock(field, block);
      focusConvertedContent(code);
      return;
    }
    if (item.kind === 'table') {
      const table = document.createElement('table');
      table.dataset.block = '0';
      const head = table.createTHead().insertRow();
      const body = table.createTBody();
      for (let i = 0; i < 2; i += 1) {
        const th = document.createElement('th');
        th.append(document.createElement('br'));
        head.append(th);
      }
      for (let row = 0; row < 2; row += 1) {
        const cells = body.insertRow();
        for (let column = 0; column < 2; column += 1) {
          const cell = cells.insertCell();
          if (!row && !column && selected) cell.textContent = selected;
          else cell.append(document.createElement('br'));
        }
      }
      insertStructuredBlock(field, table);
      focusConvertedContent(selected ? body.rows[0].cells[0] : head.cells[0]);
      return;
    }
    if (item.kind === 'divider') {
      host.current?.querySelector<HTMLButtonElement>('.vditor-toolbar [data-type="line"]')?.click();
      return;
    }
    // Reuse selected inline nodes (bold, links, etc.) instead of flattening
    // rich content to text. Block boundaries become line breaks in the new
    // component; code source is literal text, never interpreted as HTML.
    const inline = document.createDocumentFragment();
    const addBreak = () => { if (inline.lastChild && !(inline.lastChild instanceof HTMLBRElement)) inline.append(document.createElement('br')); };
    const flatten = (node: Node) => {
      if (node instanceof Element && node.matches('.vditor-wysiwyg__preview,wbr,input')) return;
      if (node instanceof Element && node.matches('p,h1,h2,h3,h4,h5,h6,li,ul,ol,blockquote,div,pre,table,thead,tbody,tr,td,th')) {
        addBreak();
        Array.from(node.childNodes).forEach(flatten);
        addBreak();
      } else inline.append(node.cloneNode(true));
    };
    if (existingCode) {
      selected.split('\n').forEach((line, index) => {
        if (index) inline.append(document.createElement('br'));
        if (line) inline.append(document.createTextNode(line));
      });
    } else Array.from(range.cloneContents().childNodes).forEach(flatten);
    while (inline.lastChild instanceof HTMLBRElement) inline.lastChild.remove();

    let block: HTMLElement;
    let editable: HTMLElement;
    if (item.kind === 'bullet' || item.kind === 'numbered' || item.kind === 'todo') {
      block = document.createElement(item.kind === 'numbered' ? 'ol' : 'ul');
      block.dataset.block = '0';
      if (item.kind === 'todo') block.dataset.marker = '*';
      const appendItem = () => {
        const li = document.createElement('li');
        if (item.kind === 'todo') {
          li.className = 'vditor-task';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          li.append(checkbox, document.createTextNode(' '));
        }
        block.append(li);
        return li;
      };
      let li = appendItem();
      editable = li;
      Array.from(inline.childNodes).forEach(node => {
        if (node instanceof HTMLBRElement) {
          if (!li.textContent?.trim()) li.append(document.createElement('br'));
          li = appendItem();
        } else li.append(node);
      });
      if (!li.textContent?.trim()) li.append(document.createElement('br'));
    } else {
      editable = document.createElement(item.kind === 'heading' ? `h${item.level ?? 2}` : 'p');
      editable.dataset.block = '0';
      editable.append(inline.hasChildNodes() ? inline : document.createElement('br'));
      if (item.kind === 'quote') {
        block = document.createElement('blockquote');
        block.dataset.block = '0';
        block.append(editable);
      } else block = editable;
    }
    insertStructuredBlock(field, block);
    focusConvertedContent(editable);
  }

  function insertComponent(item: MarkdownInsertion) {
    const field = restoreInsertSelection();
    const instance = editor.current;
    if (!field || !instance) return;
    if (!(field instanceof HTMLTextAreaElement) && item.direct) {
      const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null;
      const inTable = (node?: Node) => (node?.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement)?.closest('table');
      // Markdown table cells cannot hold headings/lists/fenced blocks. Do
      // not split a partly selected table into invalid header fragments.
      if (inTable(range?.startContainer) || inTable(range?.endContainer)) {
        setEditingHint('表格内可调整文字格式；Ctrl+Enter 可在表格后继续正文。');
        return;
      }
    }
    setEditingHint('');
    editorTransaction(() => {
    if (field instanceof HTMLTextAreaElement) {
      const start = field.selectionStart;
      const before = field.value.slice(0, start);
      const after = field.value.slice(field.selectionEnd);
      const prefix = item.block && before && !before.endsWith('\n\n') ? before.endsWith('\n') ? '\n' : '\n\n' : '';
      const suffix = item.block && after && !after.startsWith('\n\n') ? after.startsWith('\n') ? '\n' : '\n\n' : '';
      instance.insertMD(prefix + item.markdown + suffix);
      field.setSelectionRange(start + prefix.length + item.selectionStart, start + prefix.length + item.selectionEnd);
    } else if (item.direct) {
      insertDirectComponent(field, item);
    } else {
      const previous = new Set(field.querySelectorAll('*'));
      const range = window.getSelection()?.getRangeAt(0);
      const parent = range?.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as HTMLElement : range?.startContainer.parentElement;
      const emptyParagraph = parent?.closest('p');
      instance.insertMD(item.markdown);
      // Native block insertion adds after the current paragraph; discard only
      // its now-empty placeholder, never an existing paragraph's text.
      if (item.block && emptyParagraph?.isConnected && !emptyParagraph.textContent?.replace(/\u200b/g, '').trim() && !emptyParagraph.querySelector('img,input,video,audio,iframe')) emptyParagraph.remove();
      selectInsertedContent(field, item, previous);
    }
    });
    captureInsertSelection();
    activateInsertTarget();
  }

  function isBlankSlashLine() {
    const field = activeField();
    if (!field) return false;
    if (field instanceof HTMLTextAreaElement) {
      if (field.selectionStart !== field.selectionEnd) return false;
      const start = field.value.lastIndexOf('\n', field.selectionStart - 1) + 1;
      const end = field.value.indexOf('\n', field.selectionStart);
      const lineText = field.value.slice(start, end < 0 ? undefined : end);
      if (lineText.trim() || /^( {4}|\t)/.test(lineText)) return false;
      let fence: { mark: string; length: number } | null = null;
      for (const line of field.value.slice(0, start).split('\n')) {
        const match = line.match(/^\s*(`{3,}|~{3,})/);
        if (!match) continue;
        if (!fence) fence = { mark: match[1][0], length: match[1].length };
        else if (match[1][0] === fence.mark && match[1].length >= fence.length) fence = null;
      }
      return !fence;
    }
    const selection = window.getSelection();
    if (!selection?.isCollapsed || !selection.rangeCount) return false;
    const range = selection.getRangeAt(0);
    if (!field.contains(range.startContainer)) return false;
    const parent = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as HTMLElement : range.startContainer.parentElement;
    if (parent?.closest('code,a,[data-type="code-block"],[data-type="math-block"],[data-type="a"]')) return false;
    const block = parent?.closest('p,li,h1,h2,h3,h4,h5,h6,td,th');
    return !((block ?? field).textContent ?? '').replace(/\u200b/g, '').trim();
  }

  useEffect(() => {
    if (!ready) return;
    const unregister = library.register(insertTarget.current);
    const field = activeField();
    if (field && document.activeElement === field) activateInsertTarget();
    return unregister;
  }, [ready, library.register]);

  useEffect(() => {
    if (!ready) return;
    const remember = () => {
      const field = activeField();
      if (field && document.activeElement === field) captureInsertSelection();
      refreshEmptyBlocks();
      syncBlockControl();
    };
    document.addEventListener('selectionchange', remember);
    window.addEventListener('resize', syncBlockControl);
    return () => { document.removeEventListener('selectionchange', remember); window.removeEventListener('resize', syncBlockControl); };
  }, [ready]);

  function renderCodeHighlights() {
    const element = host.current;
    const highlighter = (window as Window & { hljs?: LocalHighlighter }).hljs;
    const runtime = window as Window & HighlightRuntime;
    const registry = runtime.CSS?.highlights;
    if (!element || !highlighter || composing.current || !runtime.Highlight || !registry) return;
    if (!highlightStyle.current) {
      const style = document.createElement('style');
      style.textContent = Object.entries(codeColors).map(([kind, color]) => `::highlight(${highlightPrefix}-${kind}) { color: ${color}; }`).join('\n');
      document.head.appendChild(style);
      highlightStyle.current = style;
    }
    const groups = new Map(Object.keys(codeColors).map(kind => [kind, [] as Range[]]));
    element.querySelectorAll<HTMLElement>('.vditor-wysiwyg [data-type="code-block"] > pre > code').forEach(code => {
      const language = Array.from(code.classList).find(name => name.startsWith('language-'))?.slice(9);
      if (!language || !highlighter.getLanguage(language)) return;
      const text = code.textContent ?? '';
      const cached = highlightCache.current.get(code);
      const textNodes: Text[] = [];
      const currentWalker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      while (currentWalker.nextNode()) textNodes.push(currentWalker.currentNode as Text);
      if (cached?.source === text && cached.language === language && cached.nodes.length === textNodes.length && cached.nodes.every((node, index) => node === textNodes[index])) {
        for (const [kind, ranges] of cached.ranges) groups.get(kind)?.push(...ranges);
        return;
      }
      // Lute drops code after nested highlight spans. Color native text
      // ranges instead: no duplicate preview, DOM rewrite, or click-to-source.
      let tokenOffsets = cached?.source === text && cached.language === language ? cached.tokens : undefined;
      if (!tokenOffsets) {
        tokenOffsets = [];
        const parsed = document.createElement('template');
        parsed.innerHTML = highlighter.highlight(text, { language, ignoreIllegals: true }).value;
        const tokens = document.createTreeWalker(parsed.content, NodeFilter.SHOW_TEXT);
        let offset = 0;
        while (tokens.nextNode()) {
          const node = tokens.currentNode;
          const end = offset + (node.textContent?.length ?? 0);
          const classes = node.parentElement?.closest('[class]')?.className ?? '';
          const kind = /comment|quote/.test(classes) ? 'comment' : /string|regexp|doctag/.test(classes) ? 'string' : /number|literal/.test(classes) ? 'number' : /keyword|built_in|type/.test(classes) ? 'keyword' : /title|section/.test(classes) ? 'title' : /variable|attr|symbol/.test(classes) ? 'variable' : '';
          if (kind && end > offset) tokenOffsets.push({ start: offset, end, kind });
          offset = end;
        }
      }
      const nodes: { node: Text; start: number; end: number }[] = [];
      let sourceOffset = 0;
      for (const node of textNodes) {
        nodes.push({ node, start: sourceOffset, end: sourceOffset + node.length });
        sourceOffset += node.length;
      }
      const blockRanges = new Map<string, Range[]>();
      for (const { start, end, kind } of tokenOffsets) {
        const startNode = nodes.find(source => source.start <= start && source.end > start);
        const endNode = nodes.find(source => source.start < end && source.end >= end);
        if (startNode && endNode) {
          const range = document.createRange();
          range.setStart(startNode.node, start - startNode.start);
          range.setEnd(endNode.node, end - endNode.start);
          groups.get(kind)?.push(range);
          const ranges = blockRanges.get(kind) ?? [];
          ranges.push(range);
          blockRanges.set(kind, ranges);
        }
      }
      highlightCache.current.set(code, { source: text, language, tokens: tokenOffsets, nodes: textNodes, ranges: blockRanges });
    });
    for (const [kind, ranges] of groups) registry.set(`${highlightPrefix}-${kind}`, new runtime.Highlight(...ranges));
  }

  function handleEditorClick(event: MouseEvent<HTMLElement>) {
    const field = activeField();
    const last = field?.lastElementChild;
    if (field && !(field instanceof HTMLTextAreaElement) && event.target === field && last && event.clientY > last.getBoundingClientRect().bottom) {
      // Empty canvas below a structure means continuing the document, not
      // sending the user back into its final code line or list item.
      event.stopPropagation();
      field.focus({ preventScroll: true });
      if (last.matches('ul,ol,blockquote,table,[data-type="code-block"]')) {
        continueBody(last as HTMLElement);
        return;
      }
      const range = document.createRange();
      const end = last.matches('[data-type="code-block"]') ? last.querySelector('pre > code') : last.matches('table') ? last.querySelector('tr:last-child > :last-child') : last;
      range.selectNodeContents(end ?? last);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      captureInsertSelection();
      return;
    }
    queueMicrotask(() => { publishCurrent(); syncBlockControl(); });
  }

  function currentStructure() {
    const field = activeField();
    const selection = window.getSelection();
    if (!field || field instanceof HTMLTextAreaElement || !selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!field.contains(range.startContainer) || !field.contains(range.endContainer)) return null;
    let node = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as HTMLElement : range.startContainer.parentElement;
    let structure: HTMLElement | null = null;
    while (node && node !== field) {
      if (node.matches('ul,ol,blockquote,table,[data-type="code-block"]')) structure = node;
      node = node.parentElement;
    }
    return structure;
  }

  function syncFlowEnd() {
    if (document.activeElement?.closest('.chapter-flow-end')) return;
    const field = activeField();
    const selection = window.getSelection();
    const structure = document.activeElement === field && selection?.isCollapsed ? currentStructure() : null;
    if (!structure || structure !== field?.lastElementChild || !selection?.rangeCount) { setFlowEnd(null); return; }
    const caret = selection.getRangeAt(0);
    const remainder = caret.cloneRange();
    remainder.selectNodeContents(structure);
    remainder.setStart(caret.endContainer, caret.endOffset);
    setFlowEnd(remainder.toString().replace(/\u200b/g, '').replace(/\n$/, '') === '' ? structure : null);
  }

  function continueBody(structure = currentStructure()) {
    const field = activeField();
    if (!structure?.isConnected || !field || field instanceof HTMLTextAreaElement || !field.contains(structure)) return false;
    editorTransaction(() => {
      // Reuse an existing following paragraph. No repeated empty rows when
      // a user invokes the exit again, and never take text out of the block.
      let next = structure.nextElementSibling as HTMLElement | null;
      if (!next?.matches('p')) {
        next = document.createElement('p');
        next.dataset.block = '0';
        next.append(document.createElement('br'));
        structure.after(next);
      }
      // A trailing empty list item/quote paragraph is only an editing stub.
      let trailing = structure.lastElementChild as HTMLElement | null;
      while (trailing?.lastElementChild?.matches('ul,ol,blockquote,li,p')) trailing = trailing.lastElementChild as HTMLElement;
      if (trailing?.matches('li,p') && !trailing.textContent?.replace(/\u200b/g, '').trim() && !trailing.querySelector('img,video,audio,iframe,hr,table,[data-type="code-block"]')) {
        let parent = trailing.parentElement;
        trailing.remove();
        while (parent && parent !== field && parent !== structure && !parent.textContent?.replace(/\u200b/g, '').trim() && !parent.querySelector('img,video,audio,iframe,hr,table,[data-type="code-block"]')) {
          const ancestor = parent.parentElement;
          parent.remove();
          parent = ancestor;
        }
      }
      if (!structure.matches('table') && !structure.textContent?.replace(/\u200b/g, '').trim() && !structure.querySelector('img,video,audio,iframe,hr,table')) structure.remove();
      field.focus({ preventScroll: true });
      focusBlockContent(next);
    });
    return true;
  }

  function handleWritingKeys(event: KeyboardEvent<HTMLElement>) {
    const field = activeField();
    if (!field || !field.contains(event.target as Node)) return false;
    const mod = event.ctrlKey || event.metaKey;
    const consume = () => { event.preventDefault(); event.stopPropagation(); captureInsertSelection(); };
    if (mod && !event.altKey && event.key === 'Enter' && !event.shiftKey && currentStructure()) {
      consume();
      continueBody();
      return true;
    }
    if (mod && !event.altKey && event.shiftKey && /^Digit[0-689]$/.test(event.code)) {
      // Native source syntax remains literal; rich mode shares the exact
      // same conversion transaction as the floating component buttons.
      const digit = Number(event.code.slice(-1));
      const kinds: Record<number, MarkdownInsertKind> = { 0: 'text', 1: 'heading', 2: 'heading', 3: 'heading', 4: 'todo', 5: 'bullet', 6: 'numbered', 8: 'code', 9: 'quote' };
      const kind = kinds[digit] as Exclude<MarkdownInsertKind, 'link' | 'image'>;
      consume();
      insertComponent(createDirectInsertion(kind, insertSelectedText.current, digit >= 1 && digit <= 3 ? digit as 1 | 2 | 3 : 2));
      return true;
    }
    if (mod && !event.altKey && !event.shiftKey && event.code === 'KeyK') {
      consume(); activateInsertTarget(); libraryRef.current.showComponent('link'); return true;
    }
    const inlineCommand = mod && !event.altKey ? !event.shiftKey ? ({ KeyB: 'bold', KeyI: 'italic', KeyE: 'inline-code' } as Record<string, string>)[event.code] : event.code === 'KeyS' ? 'strike' : null : null;
    if (inlineCommand) {
      // Code is literal input: browser/UI formatting must not turn code
      // characters into emphasis nodes or swallow a shortcut into Chrome.
      consume();
      const selection = window.getSelection();
      const parent = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode as Element : selection?.anchorNode?.parentElement;
      if (!(field instanceof HTMLTextAreaElement) && parent?.closest('[data-type="code-block"]')) return true;
      editorTransaction(() => host.current?.querySelector<HTMLButtonElement>(`.vditor-toolbar [data-type="${inlineCommand}"]`)?.click());
      return true;
    }
    if (field instanceof HTMLTextAreaElement || mod || event.altKey) return false;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return false;
    const range = selection.getRangeAt(0);
    const parent = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as HTMLElement : range.startContainer.parentElement;
    if (event.key === 'Tab' && parent?.closest('li') && !parent.closest('table,[data-type="code-block"]')) {
      consume();
      editorTransaction(() => {
        const button = host.current?.querySelector<HTMLButtonElement>(`.vditor-toolbar [data-type="${event.shiftKey ? 'outdent' : 'indent'}"]`);
        // Toolbar highlighting is debounced. The current DOM selection has
        // already established eligibility; a stale disabled class must not
        // drop the first key immediately after clicking / changing mode.
        button?.classList.remove('vditor-menu--disabled');
        button?.click();
      });
      return true;
    }
    const code = parent?.closest('[data-type="code-block"] pre > code');
    if (event.key === 'Tab' && code && code.contains(range.endContainer)) {
      consume();
      editorTransaction(() => {
        const text = code.textContent ?? '';
        const prefix = range.cloneRange();
        prefix.selectNodeContents(code);
        prefix.setEnd(range.startContainer, range.startOffset);
        const start = prefix.toString().length;
        prefix.setEnd(range.endContainer, range.endOffset);
        const end = prefix.toString().length;
        let next: string;
        let nextStart: number;
        let nextEnd: number;
        if (range.collapsed && !event.shiftKey) {
          next = text.slice(0, start) + '    ' + text.slice(end);
          nextStart = nextEnd = start + 4;
        } else {
          const lineStart = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
          const through = end > start && text[end - 1] === '\n' ? end - 1 : end;
          const newline = text.indexOf('\n', through);
          const lineEnd = newline < 0 ? text.length : newline;
          let delta = 0;
          let firstDelta = 0;
          const lines = text.slice(lineStart, lineEnd).split('\n').map((line, index) => {
            const removed = event.shiftKey ? line.match(/^(?:\t| {1,4})/)?.[0].length ?? 0 : 0;
            const change = event.shiftKey ? -removed : 4;
            if (!index) firstDelta = change;
            delta += change;
            return event.shiftKey ? line.slice(removed) : '    ' + line;
          }).join('\n');
          next = text.slice(0, lineStart) + lines + text.slice(lineEnd);
          nextStart = Math.max(lineStart, start + firstDelta);
          nextEnd = Math.max(nextStart, end + delta);
        }
        code.textContent = next;
        if (!code.firstChild) code.append(document.createTextNode(''));
        const caret = document.createRange();
        caret.setStart(code.firstChild!, Math.min(nextStart, next.length));
        caret.setEnd(code.firstChild!, Math.min(nextEnd, next.length));
        selection.removeAllRanges(); selection.addRange(caret);
      });
      return true;
    }
    if (event.key === 'ArrowDown' && !event.shiftKey && range.collapsed && code) {
      const after = range.cloneRange();
      after.selectNodeContents(code);
      after.setStart(range.endContainer, range.endOffset);
      if (after.toString().replace(/\u200b/g, '').replace(/\n$/, '') === '') {
        consume(); continueBody(); return true;
      }
    }
    return false;
  }

  function exitEmptyBlock(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Backspace' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
    const field = activeField();
    const selection = window.getSelection();
    if (!field || field instanceof HTMLTextAreaElement || !selection?.isCollapsed || !selection.anchorNode || !field.contains(selection.anchorNode)) return false;
    const parent = selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode as HTMLElement : selection.anchorNode.parentElement;
    const block = parent?.closest<HTMLElement>('h1,h2,h3,h4,h5,h6,[data-type="code-block"]');
    if (!block || block.textContent?.replace(/\u200b/g, '').trim() || block.querySelector('img,input,video,audio,iframe,table')) return false;
    event.preventDefault();
    event.stopPropagation();
    editorTransaction(() => {
      const paragraph = document.createElement('p');
      paragraph.dataset.block = '0';
      paragraph.append(document.createElement('br'));
      block.replaceWith(paragraph);
      focusBlockContent(paragraph);
    });
    return true;
  }

  useLayoutEffect(() => {
    mounted.current = true;
    let disposed = false;
    let instance: Vditor | undefined;
    let initialized = false;
    const element = host.current;
    if (!element) return;
    const unregisterSelection = registerChapterSelection(element, captureContextSelection, () => editor.current?.getValue() ?? null);
    const flushBeforeNavigation = (event: PointerEvent) => {
      if (!element.parentElement?.contains(event.target as Node)) {
        rememberSelection();
        publishCurrent(true);
        void commitLatest();
        leaveEmptyDraft(event.target);
      }
    };
    const flushBeforeUnload = () => { publishCurrent(true); void commitLatest(); };
    const dismissEmptyAfterFocus = (event: FocusEvent) => {
      if (callbacks.current.onLeaveEmpty && !element.parentElement?.contains(event.target as Node)) {
        publishCurrent(true);
        leaveEmptyDraft(event.target);
      }
    };
    // Run before the destination's React click handler can unmount this page.
    // This also covers navigation items that intentionally do not take focus.
    document.addEventListener('pointerdown', flushBeforeNavigation, true);
    document.addEventListener('focusin', dismissEmptyAfterFocus);
    window.addEventListener('pagehide', flushBeforeUnload);

    const initialize = (Editor: typeof Vditor) => {
      if (disposed) return;
      instance = new Editor(element, {
        value: current.current,
        mode: nativeMode(callbacks.current.mode),
        cdn: assetRoot,
        i18n: window.VditorI18n,
        // Icons have already been loaded; omit Vditor's synchronous XHR loader.
        icon: undefined,
        cache: { enable: false },
        height: 'auto',
        minHeight: callbacks.current.live ? 36 : 180,
        placeholder,
        // Vditor 4 has no public changeMode API. Keep its own mode controls
        // mounted (hidden) so switching uses the package's conversion path.
        toolbar: ['headings', 'bold', 'italic', 'strike', 'inline-code', 'link', '|', 'list', 'ordered-list', 'check', 'outdent', 'indent', '|', 'quote', 'code', 'line', '|', 'undo', 'redo', '|', 'edit-mode'],
        toolbarConfig: { pin: false, hide: callbacks.current.live },
        preview: {
          mode: 'editor',
          maxWidth: 10000,
          hljs: { enable: false },
          markdown: { codeBlockPreview: false, mathBlockPreview: false, sanitize: true },
          theme: { current: '', path: '' },
        },
        hint: { emoji: {}, parse: false },
        link: { isOpen: false },
        input: next => {
          renderCodeHighlights();
          refreshEmptyBlocks();
          syncBlockControl();
          if (disposed || !initialized || composing.current || switchingMode.current || next === current.current) return;
          publishValue(next);
        },
        focus: activateInsertTarget,
        after: () => {
          initialized = true;
          if (disposed) { cancelRenderedToolbarTimers(instance); instance?.destroy(); return; }
          editor.current = instance ?? null;
          renderCodeHighlights();
          refreshEmptyBlocks();
          // Markdown serialization can normalize a final newline at startup.
          // This is not a user edit and must not create a save activity.
          current.current = instance?.getValue() ?? current.current;
          if (!initialDraftPending.current) committed.current = current.current;
          dirty.current = hasUnsavedChanges(current.current);
          element.querySelectorAll<HTMLElement>('[contenteditable="true"], textarea').forEach(field => {
            field.setAttribute('role', 'textbox');
            field.setAttribute('aria-label', callbacks.current.label);
            field.setAttribute('aria-multiline', 'true');
          });
          element.querySelector('.vditor-toolbar')?.setAttribute('aria-label', '文本格式');
          element.querySelector('.vditor-toolbar')?.setAttribute('role', 'toolbar');
          const sourceMode = element.querySelector('[data-mode="sv"]');
          if (sourceMode) sourceMode.textContent = 'Markdown 源码';
          // Vditor's after callback runs in its Lute-ready microtask. Remove the
          // loading row in the same paint as the populated editor, not one later.
          flushSync(() => setReady(true));
          if (dirty.current) scheduleCommit();
          if (callbacks.current.autoFocus) instance?.focus();
        },
      });
    };
    const fail = () => { if (!disposed) setError('编辑器未能加载。内容仍保留，请关闭后重试。'); };
    if (editorConstructor) {
      try { initialize(editorConstructor); } catch { fail(); }
    } else {
      void loadEditorRuntime().then(initialize).catch(fail);
    }

    return () => {
      unregisterSelection();
      document.removeEventListener('pointerdown', flushBeforeNavigation, true);
      document.removeEventListener('focusin', dismissEmptyAfterFocus);
      window.removeEventListener('pagehide', flushBeforeUnload);
      clearCommitTimer();
      if (initialized && instance) {
        const next = instance.getValue();
        if (next !== current.current) {
          current.current = next;
          dirty.current = hasUnsavedChanges(next);
          callbacks.current.onChange(next);
        }
        void commitLatest();
      }
      disposed = true;
      mounted.current = false;
      editor.current = null;
      if (initialized) { cancelRenderedToolbarTimers(instance); instance?.destroy(); }
      const registry = (window as Window & HighlightRuntime).CSS?.highlights;
      Object.keys(codeColors).forEach(kind => registry?.delete(`${highlightPrefix}-${kind}`));
      highlightStyle.current?.remove();
      highlightStyle.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    // The parent echoes each edit. Only an external replacement should reset
    // the document and undo stack; normal typing must retain its caret. Only
    // autosaved notes need stale-store protection. Explicitly saved composers
    // must accept their parent's successful reset to an empty draft.
    if (value === current.current || savingRef.current || (callbacks.current.live && callbacks.current.onCommit && dirty.current)) return;
    current.current = value;
    committed.current = value;
    initialDraftPending.current = false;
    dirty.current = false;
    insertBookmark.current = null;
    insertSelectedText.current = '';
    selections.current = {};
    editor.current?.setValue(value, true);
    renderCodeHighlights();
  }, [value, saving]);

  useEffect(() => {
    host.current?.querySelectorAll('[role="textbox"]').forEach(field => field.setAttribute('aria-label', label));
  }, [label]);

  useEffect(() => {
    // A freshly created draft gains an id after its first save. If its text
    // was cleared while that write was pending, persist the clearing once
    // the parent confirms that empty updates are now allowed.
    if (ready && allowEmpty && dirty.current) scheduleCommit();
  }, [allowEmpty, ready]);

  useEffect(() => {
    const instance = editor.current;
    const element = host.current;
    if (!ready || !instance || !element || instance.getCurrentMode() === nativeMode(mode)) return;
    publishCurrent();
    rememberSelection();
    const active = document.activeElement as HTMLElement | null;
    const hadFocus = Boolean(active && element.contains(active));
    const nextField = element.querySelector<HTMLElement>(mode === 'sv' ? '.vditor-sv' : renderedFieldSelector);
    const nativeFocus = nextField?.focus;
    switchingMode.current = true;
    // Invoke the real Vditor control; unlike reconstructing the editor this
    // preserves the instance and its undo history.
    // Vditor's control always calls focus(). A page can contain many editors;
    // inactive ones must not briefly steal focus, scroll, or blur the active
    // editor while the global source switch updates them all.
    if (!hadFocus && nextField) nextField.focus = () => {};
    cancelRenderedToolbarTimers(instance);
    try {
      element.querySelector<HTMLButtonElement>(`[data-mode="${nativeMode(mode)}"]`)?.click();
      instance.setPreviewMode('editor');
      if (mode === 'ir') renderCodeHighlights();
      if (hadFocus) restoreSelection(mode);
    } finally {
      // The native mode control may synchronously schedule another toolbar
      // update while transferring focus. Source mode cannot retain it.
      if (instance.getCurrentMode() === 'sv') cancelRenderedToolbarTimers(instance);
      if (nextField && nativeFocus) nextField.focus = nativeFocus;
      switchingMode.current = false;
    }
  }, [mode, ready]);

  function clearCommitTimer() {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = null;
  }

  function leaveEmptyDraft(target: EventTarget | null) {
    // Read the editor snapshot, not textContent: media and empty Markdown
    // structures are deliberate content even when they contain no prose.
    if (!target || composing.current || switchingMode.current || savingRef.current || current.current.trim()) return;
    callbacks.current.onLeaveEmpty?.(target);
  }

  function scheduleCommit() {
    clearCommitTimer();
    if (!callbacks.current.live || !dirty.current || (!callbacks.current.allowEmpty && !current.current.trim())) return;
    commitTimer.current = setTimeout(() => { void commitLatest(); }, 900);
  }

  function publishValue(next: string, synchronous = false) {
    if (next !== current.current) window.dispatchEvent(new Event('read:editing-action'));
    current.current = next;
    dirty.current = hasUnsavedChanges(next);
    if (mounted.current) setError('');
    if (synchronous) flushSync(() => callbacks.current.onChange(next));
    else callbacks.current.onChange(next);
    scheduleCommit();
  }

  function hasUnsavedChanges(next: string) {
    return initialDraftPending.current || next !== committed.current || (pendingCommits.current > 0 && next !== lastSubmitted.current);
  }

  async function commitLatest() {
    clearCommitTimer();
    if (!callbacks.current.live || !callbacks.current.onCommit || !dirty.current || (!callbacks.current.allowEmpty && !current.current.trim())) return;
    const next = current.current;
    if (pendingCommits.current && lastSubmitted.current === next) return;
    const commit = callbacks.current.onCommit;
    const sequence = ++commitSequence.current;
    lastSubmitted.current = next;
    pendingCommits.current += 1;
    savingRef.current = true;
    if (mounted.current) { setSaving(true); setError(''); }
    try {
      // Enqueue immediately, even when an older save is outstanding. In
      // particular, unmount must enqueue its final text before a replacement
      // editor can submit a newer revision of the same note.
      const succeeded = await commit(next);
      if (succeeded && sequence > confirmedSequence.current) {
        confirmedSequence.current = sequence;
        committed.current = next;
        initialDraftPending.current = false;
        dirty.current = hasUnsavedChanges(current.current);
      } else if (!succeeded && sequence === commitSequence.current && mounted.current) setError('修改尚未保存');
    } catch {
      if (sequence === commitSequence.current && mounted.current) setError('修改尚未保存');
    } finally {
      pendingCommits.current -= 1;
      savingRef.current = pendingCommits.current > 0;
      dirty.current = hasUnsavedChanges(current.current);
      if (mounted.current) setSaving(savingRef.current);
      // New input already owns its debounce timer. Never resubmit a snapshot
      // from an unmounted editor after a newer instance has started editing.
    }
  }

  function rememberSelection() {
    const instance = editor.current;
    const element = host.current;
    if (!instance || !element) return;
    const currentMode = instance.getCurrentMode();
    const field = element.querySelector<HTMLElement>(currentMode === 'sv' ? '.vditor-sv' : renderedFieldSelector);
    if (!field) return;
    if (field instanceof HTMLTextAreaElement) {
      selections.current.sv = { value: current.current, start: field.selectionStart, end: field.selectionEnd };
      return;
    }
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!field.contains(range.startContainer) || !field.contains(range.endContainer)) return;
    const prefix = document.createRange();
    prefix.selectNodeContents(field);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().length;
    prefix.setEnd(range.endContainer, range.endOffset);
    selections.current.ir = { value: current.current, start, end: prefix.toString().length };
  }

  function restoreSelection(nextMode: 'ir' | 'sv') {
    const selection = selections.current[nextMode];
    const field = host.current?.querySelector<HTMLElement>(nextMode === 'sv' ? '.vditor-sv' : renderedFieldSelector);
    if (!selection || selection.value !== current.current || !field) return;
    if (field instanceof HTMLTextAreaElement) {
      field.setSelectionRange(selection.start, selection.end);
      return;
    }
    const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let offset = 0;
    let started = false;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const length = node.textContent?.length ?? 0;
      if (!started && offset + length >= selection.start) {
        range.setStart(node, Math.max(0, selection.start - offset));
        started = true;
      }
      if (started && offset + length >= selection.end) {
        range.setEnd(node, Math.max(0, selection.end - offset));
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
        break;
      }
      offset += length;
    }
  }

  function publishCurrent(synchronous = false) {
    if (!mounted.current || !editor.current || switchingMode.current || (!synchronous && composing.current) || (!callbacks.current.live && savingRef.current)) return;
    const next = editor.current.getValue();
    if (synchronous) {
      // Even an already-published value may still be awaiting React's commit.
      // Finish that commit before a different workspace is allowed to mount.
      if (next !== current.current) publishValue(next, true);
      else if (dirty.current) flushSync(() => callbacks.current.onChange(next));
      return;
    }
    if (next === current.current) return;
    publishValue(next);
  }

  function moveAcrossEditors(event: KeyboardEvent<HTMLElement>) {
    if (!callbacks.current.live || callbacks.current.mode !== 'ir' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const field = host.current?.querySelector<HTMLElement>(renderedFieldSelector);
    const selection = window.getSelection();
    if (!field || !selection?.isCollapsed || !selection.rangeCount) return;
    const caret = selection.getRangeAt(0);
    if (!field.contains(caret.startContainer)) return;
    const down = event.key === 'ArrowDown';
    const textRects: DOMRect[] = [];
    const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      textRects.push(...Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0));
    }
    const edge = down ? textRects.at(-1) : textRects[0];
    let caretRect = caret.getClientRects()[0];
    // Chromium returns no collapsed rectangle beside an empty paragraph.
    if (!caretRect?.height && caret.startContainer.nodeType === Node.TEXT_NODE) {
      const probe = caret.cloneRange();
      const length = caret.startContainer.textContent?.length ?? 0;
      probe.setStart(caret.startContainer, Math.max(0, caret.startOffset - 1));
      probe.setEnd(caret.startContainer, Math.min(length, caret.startOffset + 1));
      caretRect = probe.getClientRects()[0];
    }
    if (edge) {
      if (!caretRect?.height) return;
      const caretCenter = (caretRect.top + caretRect.bottom) / 2;
      const edgeCenter = (edge.top + edge.bottom) / 2;
      const tolerance = Math.min(caretRect.height, edge.height) / 2;
      if (down ? caretCenter < edgeCenter - tolerance : caretCenter > edgeCenter + tolerance) return;
    }
    const workspace = field.closest('.cw-workspace');
    const fields = Array.from(workspace?.querySelectorAll<HTMLElement>(`.chapter-editor-live:not([data-source-mode="true"]) ${renderedFieldSelector}`) ?? []).filter(item => item.getClientRects().length > 0);
    const index = fields.indexOf(field);
    const next = fields[index + (down ? 1 : -1)];
    if (index < 0 || !next) return;
    const nextWalker = document.createTreeWalker(next, NodeFilter.SHOW_TEXT);
    const positions: Text[] = [];
    while (nextWalker.nextNode()) {
      const text = nextWalker.currentNode as Text;
      const parent = text.parentElement;
      if (!parent || parent.closest('.vditor-wysiwyg__preview')) continue;
      positions.push(text);
    }
    event.preventDefault();
    event.stopPropagation();
    publishCurrent(true);
    void commitLatest();
    next.focus({ preventScroll: true });
    const target = down ? positions[0] : positions.at(-1);
    const range = document.createRange();
    if (target) {
      range.setStart(target, down ? 0 : target.length);
      range.collapse(true);
    } else {
      range.selectNodeContents(next);
      range.collapse(down);
    }
    selection.removeAllRanges();
    selection.addRange(range);
    const targetRect = range.getBoundingClientRect();
    const viewport = workspace?.getBoundingClientRect();
    if (targetRect.top < Math.max(60, viewport?.top ?? 0) || targetRect.bottom > window.innerHeight - 24) target?.parentElement?.scrollIntoView({ block: 'nearest' });
  }

  async function save() {
    if (callbacks.current.live && callbacks.current.onCommit) { publishCurrent(true); await commitLatest(); return; }
    if (!editor.current || composing.current || savingRef.current) return;
    const next = editor.current.getValue();
    if (next !== current.current) {
      current.current = next;
      flushSync(() => callbacks.current.onChange(next));
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    editor.current.disabled();
    try {
      const succeeded = await callbacks.current.onSave(next);
      if (succeeded) {
        committed.current = next;
        initialDraftPending.current = false;
        dirty.current = hasUnsavedChanges(current.current);
      } else if (mounted.current) setError('未能保存，修改仍保留在这里。');
    } catch {
      if (mounted.current) setError('保存失败，修改仍保留在这里。');
    } finally {
      savingRef.current = false;
      if (mounted.current) {
        setSaving(false);
        editor.current?.enable();
      }
    }
  }

  return <section className={`chapter-editor${live ? ' chapter-editor-live' : ''}`} data-source-mode={mode === 'sv'} aria-label={`编辑${label}`} aria-busy={!ready}
    // Vditor debounces its input callback with the undo stack. Publish after
    // each DOM edit too, so navigating immediately cannot lose the last word.
    onInputCapture={() => queueMicrotask(() => { if (composing.current) return; renderCodeHighlights(); refreshEmptyBlocks(); syncBlockControl(); publishCurrent(); })}
    onClickCapture={handleEditorClick}
    onKeyUpCapture={() => queueMicrotask(() => { publishCurrent(); syncBlockControl(); })}
    onFocusCapture={event => {
      if (activeField()?.contains(event.target as Node)) activateInsertTarget();
      queueMicrotask(() => { refreshEmptyBlocks(); syncBlockControl(); });
    }}
    onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !switchingMode.current) {
        rememberSelection();
        publishCurrent(true);
        void commitLatest();
        leaveEmptyDraft(event.relatedTarget);
      }
      queueMicrotask(refreshEmptyBlocks);
      if (!(event.relatedTarget as HTMLElement | null)?.closest('.chapter-block-control,.chapter-flow-end')) queueMicrotask(syncBlockControl);
    }}
    onCompositionStartCapture={() => { composing.current = true; }}
    onCompositionEndCapture={() => {
      queueMicrotask(() => { composing.current = false; renderCodeHighlights(); refreshEmptyBlocks(); syncBlockControl(); publishCurrent(); });
    }}
    onKeyDownCapture={event => {
      if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
      const field = activeField();
      const inDocument = field?.contains(event.target as Node);
      if (inDocument && event.key === 'Escape' && callbacks.current.onLeaveEmpty && !current.current.trim() && !savingRef.current) {
        event.preventDefault();
        event.stopPropagation();
        callbacks.current.onLeaveEmpty(null);
        return;
      }
      if (inDocument && (event.ctrlKey || event.metaKey) && !event.altKey && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
        event.preventDefault();
        event.stopPropagation();
        captureInsertSelection();
        performUndo(event.key.toLowerCase() === 'y' || event.shiftKey);
        return;
      }
      if (inDocument && exitEmptyBlock(event)) return;
      if (inDocument && handleWritingKeys(event)) return;
      if (live && event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && isBlankSlashLine()) {
        event.preventDefault();
        event.stopPropagation();
        publishCurrent(true);
        captureInsertSelection();
        activateInsertTarget();
        libraryRef.current.show(true);
        return;
      }
      moveAcrossEditors(event);
      if (event.defaultPrevented) return;
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        void save();
      }
    }}>
    {!ready && !error && <div className="chapter-editor-loading" role="status">正在打开编辑器…</div>}
    <div ref={host} className="chapter-editor-host" />
    {editingHint && <div className="chapter-editor-hint" role="status">{editingHint}</div>}
    {flowEnd && mode !== 'sv' && <div className="chapter-flow-end"><button type="button" aria-label="继续正文" title="离开当前结构，继续正文 · Ctrl+Enter" aria-keyshortcuts="Control+Enter Meta+Enter" onPointerDown={event => { event.preventDefault(); captureInsertSelection(); }} onClick={() => continueBody(flowEnd)}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M5 3v7a3 3 0 0 0 3 3h8m-4-4 4 4-4 4" /></svg><span>继续正文</span><kbd>Ctrl ↵</kbd></button></div>}
    {blockControl && mode !== 'sv' && <div className={`chapter-block-control chapter-block-control-${blockControl.kind}`} style={{ top: blockControl.top, left: blockControl.left }} onPointerDownCapture={captureInsertSelection}>
      <select aria-label={blockControl.kind === 'heading' ? '标题层级' : '代码语言'} value={blockControl.value} onChange={event => changeBlockControl(event.target.value)}>
        {blockControl.kind === 'heading' ? <>{['h1', 'h2', 'h3'].map(level => <option key={level} value={level}>{level.toUpperCase()}</option>)}{!['h1', 'h2', 'h3'].includes(blockControl.value) && <option value={blockControl.value}>{blockControl.value.toUpperCase()}</option>}</> : <>{codeLanguages.map(([language, name]) => <option key={language} value={language}>{name}</option>)}{!codeLanguages.some(([language]) => language === blockControl.value) && <option value={blockControl.value}>{blockControl.value}</option>}</>}
      </select>
    </div>}
    {live ? <div className={`chapter-editor-live-status${error ? ' has-error' : ''}`} aria-live="polite" role="status">
      {error ? <><span>{error}</span><button type="button" onClick={() => void commitLatest()}>重试</button></> : !allowEmpty && !current.current.trim() && !saving ? null : <span className="chapter-editor-sr-only">{saving ? '正在保存' : dirty.current ? '尚未保存' : ready ? '已保存' : ''}</span>}
    </div> : <footer className="chapter-editor-footer">
      <span className="chapter-editor-error" role={error ? 'alert' : undefined}>{error}</span>
      <button type="button" className="chapter-editor-cancel" disabled={saving} onClick={() => callbacks.current.onCancel()}>取消</button>
      <button type="button" className="chapter-editor-save" disabled={!ready || saving} title="保存 · Ctrl+Enter" onClick={() => void save()}>{saving ? '保存中…' : '完成'}</button>
    </footer>}
  </section>;
}
