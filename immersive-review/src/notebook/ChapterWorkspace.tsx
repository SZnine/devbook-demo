import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Markdown } from '../Markdown';
import { Icon } from '../manual-demo/icons';
import { ChapterEditor } from './ChapterEditor';
import { ChapterSummary } from './ChapterSummary';
import { LiveNoteBody } from './LiveNoteBody';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { captureChapterSelection, readChapterMarkdown, type ChapterSelection } from './editor-selection';
import { motionChange } from './motion';
import * as store from './store';
import { bodyFor, collectionKind, collectionPath, parentFor, previewFor, refKey, rootCollections, titleFor } from './content';
import './chapter-workspace.css';

type Props = {
  state: store.NotebookState;
  chapterId: string | null;
  query: string;
  busy: boolean;
  commitContent: (input: { id?: string; markdown: string; collectionId?: string }) => Promise<store.Note>;
  commitSummary: (id: string, summary: string) => Promise<store.Collection>;
  run: <T>(operation: () => Promise<T>, acceptStoredDraft?: boolean) => Promise<T | undefined>;
  onNavigate: (id: string | null) => void;
  onAddExisting: (id: string) => void;
  onQuoteMemo: (source: store.MemoSource) => void;
  onDeleteCollection: (id: string) => void;
  renderMemory: (ref: store.Ref) => ReactNode;
  toolbarTarget?: HTMLElement | null;
};
type Draft = { token?: string; id?: string; owner: string; markdown: string; committed?: string; before?: store.ContentRef };
type Popup = { kind: 'new' | 'group'; parent?: string } | { kind: 'move'; refs: store.ContentRef[]; from?: string };
type View = 'page' | 'cards' | 'reading';
type Clipboard = { from: string; refs: store.ContentRef[]; mode: 'copy' | 'move' };
type SurfaceMenu = { x: number; y: number; owner: store.Collection } & ({ kind: 'collection' } | { kind: 'summary' | 'content'; ref?: store.Ref; source: store.MemoSource; selected: boolean; selection: ChapterSelection | null });
const clipboardKey = 'read-chapter-clipboard';
const pendingDraftNotes = new Map<string, Promise<store.Note>>();

function Sheet({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef(document.activeElement as HTMLElement);
  useEffect(() => {
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => { dialog.current?.close(); if (opener.current?.isConnected) opener.current.focus(); };
  }, []);
  return <dialog ref={dialog} className="nb-dialog cw-dialog" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}><header><h2>{title}</h2><button className="nb-icon" aria-label="关闭" onClick={close}>×</button></header>{children}</dialog>;
}

const ancestors = collectionPath;

export function ChapterWorkspace({ state, chapterId, query, busy, run, commitContent, commitSummary, onNavigate, onAddExisting, onQuoteMemo, onDeleteCollection, renderMemory, toolbarTarget }: Props) {
  const chapter = state.collections.find(item => item.id === chapterId);
  const parent = chapter ? parentFor(chapter.id, state) : undefined;
  const isBook = Boolean(chapter && collectionKind(chapter.id, state) === 'book');
  const entityName = isBook ? '书籍' : '章节';
  const [sourceMode, setSourceMode] = useState(false);
  const [activeContent, setActiveContent] = useState<store.Ref | null>(null);
  const [clickedReference, setClickedReference] = useState<string | null>(null);
  const keyboardFocus = useRef(false);
  const activeOwner = useRef<string | null>(null);
  const newNoteId = useRef<string | undefined>(undefined);
  const newNoteWrite = useRef<Promise<store.Note> | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [name, setName] = useState('');
  const [destinationQuery, setDestinationQuery] = useState('');
  const [menu, setMenu] = useState(false);
  const [viewMenu, setViewMenu] = useState(false);
  const [archive, setArchive] = useState(false);
  const [message, setMessage] = useState('');
  const [surfaceMenu, setSurfaceMenu] = useState<SurfaceMenu | null>(null);
  const [summaryRevision, setSummaryRevision] = useState(0);
  const [clipboard, setClipboard] = useState<Clipboard | null>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(clipboardKey) || 'null') as Clipboard | null;
      if (!saved || typeof saved.from !== 'string' || !['copy', 'move'].includes(saved.mode) || !Array.isArray(saved.refs) || !saved.refs.length) return null;
      if (saved.refs.some(ref => !ref || typeof ref.id !== 'string' || !['note', 'section', 'chapter'].includes(ref.kind)) || saved.mode === 'copy' && saved.refs.some(ref => ref.kind === 'chapter')) return null;
      return saved;
    } catch { return null; }
  });
  const draftKey = `read-chapter-draft:${chapterId ?? 'home'}`;
  const [draft, setDraft] = useState<Draft | null>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(draftKey) || 'null') as Draft | null;
      if (saved?.id && (saved.markdown === saved.committed || saved.markdown === state.notes.find(note => note.id === saved.id)?.markdown)) return null;
      const recoverable = saved && (saved.id || saved.markdown.trim()) ? saved : null;
      return recoverable;
    } catch { return null; }
  });
  const [view, setView] = useState<View>(draft && draft.owner !== chapterId ? 'reading' : 'page');
  const [drag, setDrag] = useState<{ ref: store.ContentRef; x: number; y: number } | null>(null);
  const [drop, setDrop] = useState('');
  const cleanupDrag = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);
  const surface = useRef<HTMLDivElement>(null);
  const writeContentButton = useRef<HTMLButtonElement>(null);
  const dragGhost = useRef<HTMLDivElement>(null);
  const editorIdentities = useRef(new Map<string, string>());
  useEffect(() => () => cleanupDrag.current?.(), []);
  useEffect(() => {
    const pointer = () => { keyboardFocus.current = false; setClickedReference(null); };
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Tab') keyboardFocus.current = true; };
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('keydown', keyboard, true);
    return () => { document.removeEventListener('pointerdown', pointer, true); document.removeEventListener('keydown', keyboard, true); };
  }, []);
  useEffect(() => { setClickedReference(null); }, [chapterId, view, sourceMode]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if ((menu || viewMenu) && !(event.target as HTMLElement).closest('.cw-menu-anchor,.cw-view-menu')) void motionChange(() => { setMenu(false); setViewMenu(false); }, 'popover');
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (menu || viewMenu)) void motionChange(() => { setMenu(false); setViewMenu(false); }, 'popover');
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [menu, viewMenu]);
  useEffect(() => {
    if (draft && (draft.id || draft.markdown.trim()) && draft.markdown !== draft.committed) sessionStorage.setItem(draftKey, JSON.stringify(draft)); else sessionStorage.removeItem(draftKey);
  }, [draft, draftKey]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 3000); return () => clearTimeout(timer); }, [message]);
  const visible = (chapter?.items ?? []).filter(ref => {
    if (ref.kind === 'chapter' && (state.collections.find(item => item.id === ref.id)?.archivedAt || store.isCollectionDeleted(ref.id, state))) return false;
    if (draft?.id === ref.id && draft.owner === chapterId) return false;
    return `${titleFor(ref, state)} ${bodyFor(ref, state)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  });
  const chosen = (chapter?.items ?? []).filter(ref => selected.includes(refKey(ref)));
  const archived = Boolean(chapter && ancestors(chapter.id, state).some(item => item.archivedAt));
  const showDirectory = view === 'page' && (visible.some(ref => ref.kind === 'chapter') || (isBook && !query && !archived));
  const locked = busy || archived;
  const displayTitle = (ref: store.ContentRef, owner = chapter) => owner?.titles?.[refKey(ref)] ?? titleFor(ref, state);
  const openNew = (parentId?: string) => { void motionChange(() => { setName(''); setPopup({ kind: 'new', parent: parentId }); setMenu(false); }, 'popover'); };
  const createBlankBook = async () => {
    if (busy) return;
    const result = await run(() => store.createCollection('未命名书籍'));
    if (result) onNavigate(result.id);
  };
  const openCollectionMenu = (event: ReactMouseEvent, owner: store.Collection) => {
    event.preventDefault(); event.stopPropagation();
    setSurfaceMenu({ kind: 'collection', x: event.clientX, y: event.clientY, owner });
  };
  const openContentMenu = (event: ReactMouseEvent<HTMLElement>, owner: store.Collection, ref?: store.Ref) => {
    event.preventDefault(); event.stopPropagation();
    const root = event.currentTarget;
    const body = readChapterMarkdown(root) ?? (ref ? bodyFor(ref, state) : owner.summary ?? '');
    const selection = captureChapterSelection(root, body);
    // A selection outside this editor must never turn into deletion of this whole body.
    const selected = Boolean(selection || window.getSelection()?.toString());
    const markdown = selected ? selection?.markdown ?? '' : body;
    const source: store.MemoSource = { kind: ref ? 'content' : 'summary', collectionId: owner.id, ref,
      title: selection?.context?.title || (ref ? titleFor(ref, state) : '摘要'), path: collectionPath(owner.id, state).map(item => item.title),
      quote: markdown.trim(), quoteFormat: 'markdown', contextMarkdown: selection?.context?.markdown,
      contextTitle: selection?.context?.title, capturedAt: Date.now() };
    setSurfaceMenu({ kind: ref ? 'content' : 'summary', x: event.clientX, y: event.clientY, owner, ref, source, selected, selection });
  };
  const deleteSurface = async (target: Exclude<SurfaceMenu, { kind: 'collection' }>) => {
    if (target.selected) {
      if (target.selection?.canDelete && target.selection.deleteSelection()) window.dispatchEvent(new Event('read:editing-action'));
      else setMessage('请重新选择可编辑内容');
      return;
    }
    const result = await run(() => target.kind === 'summary' ? store.deleteCollectionSummary(target.owner.id) : store.deleteContent(target.owner.id, target.ref!));
    if (!result) return;
    if (target.kind === 'summary') { sessionStorage.removeItem(`read-chapter-summary:${target.owner.id}`); setSummaryRevision(value => value + 1); }
    else if (draft?.id === target.ref?.id) { sessionStorage.removeItem(draftKey); setDraft(null); newNoteId.current = undefined; newNoteWrite.current = null; }
    setActiveContent(null); setMessage('已删除 · Ctrl+Z 撤销');
  };
  const surfaceItems: ContextMenuItem[] = !surfaceMenu ? [] : surfaceMenu.kind === 'collection' ? [
    { label: '打开', icon: 'book', onSelect: () => onNavigate(surfaceMenu.owner.id) },
    { label: '删除', danger: true, disabled: busy, separatorBefore: true, onSelect: () => onDeleteCollection(surfaceMenu.owner.id) },
  ] : [
    { label: '写随笔', icon: 'note', disabled: busy || !surfaceMenu.source.quote, onSelect: () => onQuoteMemo(surfaceMenu.source) },
    { label: '复制', icon: 'copy', disabled: !surfaceMenu.source.quote, onSelect: () => { void navigator.clipboard.writeText(surfaceMenu.selection?.text ?? surfaceMenu.source.quote).catch(() => setMessage('复制失败，请使用 Ctrl+C')); } },
    { label: '删除', danger: true, separatorBefore: true, disabled: busy || Boolean(surfaceMenu.owner.archivedAt) || (surfaceMenu.selected ? !surfaceMenu.selection?.canDelete : surfaceMenu.kind === 'summary' && !surfaceMenu.source.quote), onSelect: () => { void deleteSurface(surfaceMenu); } },
  ];
  const requestEditor = async (owner: string, ref?: store.Ref, before?: store.ContentRef) => {
    if (ref?.kind === 'note') {
      const focusContent = () => requestAnimationFrame(() => surface.current?.querySelector<HTMLElement>(`[data-cw-key="${refKey(ref)}"] [contenteditable="true"]`)?.focus());
      if (view === 'page') { focusContent(); return; }
      void motionChange(() => {
        setView('page');
        focusContent();
      });
      return;
    }
    if (draft) {
      if (!draft.markdown.trim()) { surface.current?.querySelector<HTMLElement>(sourceMode ? '.cw-new-editor .vditor-sv' : '.cw-new-editor .vditor-wysiwyg [contenteditable="true"]')?.focus(); return; }
      if (!await saveDraftContent(draft.markdown)) return;
    }
    if (draft?.token) pendingDraftNotes.delete(draft.token);
    newNoteId.current = undefined; newNoteWrite.current = null;
    const next: Draft = { token: crypto.randomUUID(), owner, markdown: ref ? `## ${titleFor(ref, state)}\n\n${bodyFor(ref, state)}` : '', before };
    if (next.markdown.trim()) sessionStorage.setItem(draftKey, JSON.stringify(next)); else sessionStorage.removeItem(draftKey);
    void motionChange(() => { setView(current => current === 'cards' ? 'page' : current); setDraft(next); });
  };
  const saveDraftContent = async (markdown: string) => {
    if (!draft || (!markdown.trim() && !draft.id && !newNoteId.current && !newNoteWrite.current)) return true;
    try {
    const latestDraft = JSON.parse(sessionStorage.getItem(draftKey) || 'null') as Draft | null;
    const id = newNoteId.current ?? draft.id ?? (latestDraft?.token === draft.token ? latestDraft?.id : undefined);
    let result: store.Note;
    if (id) result = await commitContent({ id, collectionId: draft.owner, markdown });
    else {
      newNoteWrite.current ??= (draft.token && pendingDraftNotes.get(draft.token)) || commitContent({ collectionId: draft.owner, markdown });
      if (draft.token) pendingDraftNotes.set(draft.token, newNoteWrite.current);
      result = await newNoteWrite.current;
      newNoteId.current = result.id;
      // Joining the initial creation can race with another pending edit. Queue
      // this exact snapshot even when it matches the creation's first value.
      result = await commitContent({ id: result.id, collectionId: draft.owner, markdown });
    }
    // Keep the created identity even if navigation has already unmounted this
    // workspace. Reopening a pending draft must update it, never create a copy.
    const persisted = JSON.parse(sessionStorage.getItem(draftKey) || 'null') as Draft | null;
    if (persisted && persisted.owner === draft.owner && persisted.token === draft.token) {
      if (persisted.markdown === result.markdown) sessionStorage.removeItem(draftKey);
      else sessionStorage.setItem(draftKey, JSON.stringify({ ...persisted, id: result.id, committed: result.markdown }));
    }
    setDraft(current => current && current.owner === draft.owner && current.token === draft.token ? { ...current, id: result.id, committed: result.markdown } : current);
    setActiveContent({ kind: 'note', id: result.id }); activeOwner.current = draft.owner;
    return true;
    } catch {
      if (draft.token) pendingDraftNotes.delete(draft.token);
      newNoteWrite.current = null;
      setMessage('修改尚未保存，请重试');
      return false;
    }
  };
  const discardEmptyDraft = (target: EventTarget | null) => {
    if (!draft || draft.id || newNoteId.current || newNoteWrite.current || draft.markdown.trim()) return;
    // These controls continue the same editing session. In particular, an
    // empty target must survive choosing its first Markdown component.
    if (target instanceof Element && target.closest('.cw-new-editor,.cw-toolbar,.component-library,.nb-components-trigger,.nb-assistant-trigger,.nb-theme-toggle,.na-panel')) return;
    if (draft.token) pendingDraftNotes.delete(draft.token);
    sessionStorage.removeItem(draftKey);
    setDraft(null);
    if (target === null) requestAnimationFrame(() => writeContentButton.current?.focus({ preventScroll: true }));
  };
  const editor = draft && <ChapterEditor key={`new-${draft.token ?? draft.owner}`} value={draft.markdown} initiallyDirty={draft.id ? draft.markdown !== state.notes.find(note => note.id === draft.id)?.markdown : Boolean(draft.markdown.trim())} allowEmpty={Boolean(draft.id)} mode={sourceMode ? 'sv' : 'ir'} live onLeaveEmpty={discardEmptyDraft} onFocus={() => { if (draft.id) { setActiveContent({ kind: 'note', id: draft.id }); activeOwner.current = draft.owner; } }} onChange={markdown => {
    const next = { ...draft, id: newNoteId.current ?? draft.id, markdown };
    if (next.id || markdown.trim()) sessionStorage.setItem(draftKey, JSON.stringify(next)); else sessionStorage.removeItem(draftKey);
    setDraft(current => current?.token === draft.token ? next : current);
  }} onCommit={saveDraftContent} onSave={() => saveDraftContent(draft.markdown)} onCancel={() => { sessionStorage.removeItem(draftKey); void motionChange(() => setDraft(null)); }} autoFocus label="新正文" />;
  const switchView = async (next: View) => {
    if (draft) {
      if (draft.markdown.trim() && !await saveDraftContent(draft.markdown)) return;
      sessionStorage.removeItem(draftKey);
      if (draft.token) pendingDraftNotes.delete(draft.token);
      newNoteId.current = undefined; newNoteWrite.current = null;
    }
    void motionChange(() => { if (draft) setDraft(null); setView(next); setViewMenu(false); setSelected([]); setActiveContent(null); });
  };
  const moveRefs = async (refs: store.ContentRef[], from: string | undefined, to: string | null) => {
    if (to === from) return;
    const result = await run(() => store.moveContent({ from, to, refs }));
    if (result) void motionChange(() => { setPopup(null); setSelected([]); setMessage('已移动'); if (refs.some(ref => ref.kind === 'chapter' && ref.id === chapterId)) onNavigate(to); });
  };
  const copySelection = (mode: 'copy' | 'move') => {
    if (!chapter || locked || draft || !chosen.length || mode === 'copy' && chosen.some(ref => ref.kind === 'chapter')) return;
    const next: Clipboard = { from: chapter.id, refs: chosen.map(ref => ({ ...ref })), mode };
    try { sessionStorage.setItem(clipboardKey, JSON.stringify(next)); }
    catch { setMessage('未能保留剪贴内容，请重试'); return; }
    void motionChange(() => {
      setClipboard(next);
      setMessage(mode === 'move' ? `已剪切 ${chosen.length} 项，前往目标章节粘贴` : `已复制 ${chosen.length} 项引用`);
    }, 'popover');
  };
  const paste = async () => {
    if (!chapter || !clipboard || locked || Boolean(draft?.markdown.trim() && !draft.id)) return;
    const clip = clipboard;
    const origin = state.collections.find(item => item.id === clip.from);
    if (!origin) { setMessage('来源章节已不存在，请重新选择内容'); return; }
    if (ancestors(origin.id, state).some(item => item.archivedAt)) { setMessage('请先恢复归档的来源章节'); return; }
    if (clip.from === chapter.id) { setMessage('内容已在当前章节'); return; }
    const result = await run(() => clip.mode === 'move'
      ? store.moveContent({ from: clip.from, to: chapter.id, refs: clip.refs })
      : store.transferItems({ from: clip.from, to: chapter.id, refs: clip.refs.filter((ref): ref is store.Ref => ref.kind !== 'chapter'), mode: 'copy' }));
    if (!result) return;
    if (clip.mode === 'move') sessionStorage.removeItem(clipboardKey);
    void motionChange(() => {
      if (clip.mode === 'move') setClipboard(null);
      setSelected(clip.refs.map(refKey));
      setMessage(clip.mode === 'move' ? `已移动 ${clip.refs.length} 项` : `已加入 ${clip.refs.length} 项引用`);
    });
  };
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || !chapter || locked || Boolean(draft?.markdown.trim() && !draft.id) || popup || document.querySelector('dialog[open]')) return;
      const target = event.target as HTMLElement | null;
      if (!target || target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]')) return;
      if (target !== document.body && !surface.current?.contains(target)) return;
      if (window.getSelection()?.toString()) return;
      const key = event.key.toLowerCase();
      if (key === 'a' && view !== 'reading' && visible.length) { event.preventDefault(); void motionChange(() => setSelected(visible.map(refKey)), 'popover'); }
      else if (key === 'x' && chosen.length) { event.preventDefault(); copySelection('move'); }
      else if (key === 'c' && chosen.length && chosen.every(ref => ref.kind !== 'chapter')) { event.preventDefault(); copySelection('copy'); }
      else if (key === 'v' && clipboard) { event.preventDefault(); void paste(); }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  });
  const startDrag = (event: ReactPointerEvent, ref: store.ContentRef) => {
    if (locked || draft || !chapter || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('input,button:not(.cw-grip):not(.cw-card-open):not(.cw-child-open)')) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY };
    let started = false;
    let target: { key: string; inside: boolean; after: boolean } | null = null;
    const move = (pointer: PointerEvent) => {
      if (!started && Math.hypot(pointer.clientX - start.x, pointer.clientY - start.y) < 5) return;
      pointer.preventDefault();
      if (!started) { started = true; setDrag({ ref, x: start.x, y: start.y }); }
      if (dragGhost.current) dragGhost.current.style.transform = `translate3d(${Math.min(pointer.clientX + 16, innerWidth - 268)}px,${pointer.clientY + 14}px,0)`;
      const element = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest<HTMLElement>('[data-cw-key]');
      target = null;
      if (element && surface.current?.contains(element) && element.dataset.cwKey !== refKey(ref)) {
        const bounds = element.getBoundingClientRect();
        const center = (pointer.clientY - bounds.top) / bounds.height;
        const inside = element.dataset.cwChapter === 'true' && center > .25 && center < .75;
        target = { key: element.dataset.cwKey!, inside, after: center > .5 };
      }
      setDrop(target ? `${target.inside ? 'inside' : target.after ? 'after' : 'before'}:${target.key}` : '');
      const scroller = surface.current?.closest<HTMLElement>('.nb-main');
      if (scroller) { const rect = scroller.getBoundingClientRect(); if (pointer.clientY > rect.bottom - 55) scroller.scrollBy(0, 14); else if (pointer.clientY < rect.top + 90) scroller.scrollBy(0, -14); }
    };
    const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key); window.removeEventListener('blur', cancel); setDrag(null); setDrop(''); cleanupDrag.current = null; };
    const cancel = () => { cleanup(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    const finish = () => {
      cleanup();
      if (!started) return;
      suppressClick.current = true; setTimeout(() => { suppressClick.current = false; }, 100);
      if (!target) return;
      const destination = chapter.items.find(item => refKey(item) === target!.key);
      if (!destination) return;
      if (target.inside && destination.kind === 'chapter') { void moveRefs([ref], chapter.id, destination.id); return; }
      const ordered = chapter.items.filter(item => refKey(item) !== refKey(ref));
      const index = ordered.findIndex(item => refKey(item) === target!.key) + (target.after ? 1 : 0);
      ordered.splice(index, 0, ref);
      void run(() => store.reorderContent(chapter.id, ordered));
    };
    cleanupDrag.current?.(); cleanupDrag.current = cleanup;
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key); window.addEventListener('blur', cancel);
  };
  const blockTools = (ref: store.ContentRef, owner: store.Collection) => <div className="cw-block-tools">
    {!chapter?.archivedAt && !owner.archivedAt && <><button className="cw-grip" title="拖动排序" aria-label={`拖动：${displayTitle(ref, owner)}`} onPointerDown={event => startDrag(event, ref)}>⠿</button><input type="checkbox" aria-label={`选择：${displayTitle(ref, owner)}`} checked={selected.includes(refKey(ref))} onChange={event => { const checked = event.target.checked; void motionChange(() => setSelected(current => checked ? [...current, refKey(ref)] : current.filter(key => key !== refKey(ref))), 'popover'); }} /></>}
    <span />
    {ref.kind !== 'chapter' && renderMemory(ref)}
    {!chapter?.archivedAt && !owner.archivedAt && ref.kind !== 'chapter' && <button className="nb-icon" disabled={busy || Boolean(state.notes.find(note => note.id === ref.id)?.archivedAt)} aria-label={`${ref.kind === 'section' ? '创建可编辑副本' : '编辑'}：${displayTitle(ref, owner)}`} title={ref.kind === 'section' ? '创建可编辑副本' : '编辑内容'} onClick={() => requestEditor(owner.id, ref)}><Icon name="note" /></button>}
  </div>;
  const renderBlock = (ref: store.ContentRef, owner: store.Collection, reading = false, path = ''): ReactNode => {
    const key = refKey(ref);
    if (ref.kind === 'chapter') {
      const child = state.collections.find(item => item.id === ref.id);
      if (!child || child.archivedAt || store.isCollectionDeleted(child.id, state)) return null;
      if (reading) return <section className="cw-reading-chapter" key={`${path}/${key}`}><div className="cw-reading-origin"><button onClick={() => onNavigate(child.id)}><Icon name="book" />{child.title}<span>↗</span></button></div><h2>{child.title}</h2>{child.summary?.trim() && <div className="cw-reading-summary cw-prose" data-ai-owner={child.id}><Markdown body={child.summary} /></div>}{child.items.map(item => renderBlock(item, child, true, `${path}/${key}`))}{!child.items.length && !child.summary?.trim() && <button className="cw-reading-empty" onClick={() => onNavigate(child.id)}>打开空白章节 →</button>}{draft && draft.owner === child.id && <div className="cw-new-editor" data-ai-owner={draft.owner} data-ai-ref={draft.id ? `note:${draft.id}` : undefined}>{editor}</div>}</section>;
      const excerpt = view === 'cards' ? child.items.filter(item => item.kind !== 'chapter').slice(0, 2).map(item => titleFor(item, state)).join(' · ') : '';
      return <article key={key} data-cw-key={key} data-cw-chapter="true" onContextMenu={event => openCollectionMenu(event, child)} className={`cw-child ${view === 'cards' ? 'is-card' : ''} ${selected.includes(key) ? 'is-selected' : ''} ${drop.endsWith(`:${key}`) ? `drop-${drop.split(':')[0]}` : ''} ${drag && refKey(drag.ref) === key ? 'is-dragging' : ''}`} onPointerDown={event => startDrag(event, ref)}>
        {view === 'cards' && blockTools(ref, owner)}<button className="cw-child-open" onClick={() => onNavigate(child.id)}><span className="cw-page-symbol"><Icon name="note" /></span><span><strong>{displayTitle(ref, owner)}</strong>{excerpt && <small>{excerpt}</small>}<em>{child.items.length} 项内容</em></span><Icon name="chevron" /></button>
      </article>;
    }
    if (draft?.id === ref.id && draft.owner === owner.id) return null;
    const note = ref.kind === 'note' ? state.notes.find(item => item.id === ref.id) : undefined;
    const isReference = ref.kind === 'section' || Boolean(note?.sourceSectionId || note?.copiedFrom || note?.source);
    const isActive = activeContent && refKey(activeContent) === key && activeOwner.current === owner.id;
    const noteKey = `${owner.id}:${note?.id ?? ref.id}`;
    const editorIdentity = editorIdentities.current.get(noteKey)
      ?? (note?.editingOriginId ? editorIdentities.current.get(`${owner.id}:${note.editingOriginId}`) ?? note.editingOriginId : ref.id);
    if (note) editorIdentities.current.set(noteKey, editorIdentity);
    const referenceIdentity = `${path}/${owner.id}/${ref.kind}:${editorIdentity}`;
    const clearReferenceBorder = () => setClickedReference(current => current === referenceIdentity ? null : current);
    return <article key={referenceIdentity} data-ai-owner={owner.id} data-ai-ref={key} data-cw-key={!reading ? key : undefined} data-reading-key={view !== 'cards' && !sourceMode ? key : undefined} onContextMenu={event => openContentMenu(event, owner, ref)} className={`cw-content ${isReference ? 'is-reference' : ''} ${isReference && clickedReference === referenceIdentity ? 'is-reference-selected' : ''} ${isActive ? 'is-active' : ''} ${view === 'cards' && !reading ? 'is-card' : ''} ${selected.includes(key) ? 'is-selected' : ''} ${drop.endsWith(`:${key}`) ? `drop-${drop.split(':')[0]}` : ''} ${drag && refKey(drag.ref) === key ? 'is-dragging' : ''}`} onPointerDown={event => { if (isReference && event.button === 0) setClickedReference(referenceIdentity); if (view === 'cards' && !reading) startDrag(event, ref); }} onPointerLeave={isReference ? clearReferenceBorder : undefined} onFocusCapture={event => { if (isReference && keyboardFocus.current && event.target.matches(':focus-visible')) setClickedReference(referenceIdentity); }} onBlurCapture={event => { if (isReference && !event.currentTarget.contains(event.relatedTarget as Node | null)) clearReferenceBorder(); }}>
      {isReference && <span className="cw-reference-mark" data-selection-ignore title={note?.sourceSectionId || ref.kind === 'section' ? '引入的参考资料' : '从随笔引入'}><Icon name="link" />引入</span>}
      {view === 'cards' && !reading ? blockTools(ref, owner) : <div className="cw-passive-memory">{renderMemory(ref)}</div>}
      {view === 'cards' && !reading ? <button className="cw-card-open" onClick={() => void motionChange(() => { setView('page'); requestAnimationFrame(() => surface.current?.querySelector(`[data-cw-key="${key}"]`)?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })); })}><span className="cw-card-type"><Icon name={ref.kind === 'section' ? 'book' : 'note'} />{ref.kind === 'section' ? '原文' : '正文'}</span><strong>{displayTitle(ref, owner)}</strong><p>{previewFor(ref, state)}</p></button>
        : note && !note.archivedAt && !owner.archivedAt && !chapter?.archivedAt && state.draft.editingId !== note.id
          ? <LiveNoteBody key={`${owner.id}:${editorIdentity}`} collectionId={owner.id} note={note} mode={sourceMode ? 'sv' : 'ir'} onFocus={() => { setActiveContent(ref); activeOwner.current = owner.id; }} commit={commitContent} />
          : <div className="cw-prose" data-reading-core tabIndex={0} onFocus={() => { setActiveContent(ref); activeOwner.current = owner.id; }} onClick={() => { setActiveContent(ref); activeOwner.current = owner.id; }}>{ref.kind === 'section' && <h3>{displayTitle(ref, owner)}</h3>}<Markdown body={bodyFor(ref, state)} /></div>}
      {note?.archivedAt && <div className="cw-archived-note">已归档<button disabled={busy} onClick={() => void run(() => store.restoreNote(note.id))}>恢复</button></div>}
    </article>;
  };
  const toolbar = chapter ? <div className="cw-toolbar"><nav aria-label="书籍与章节路径"><button onClick={() => onNavigate(null)}>我的阅读</button>{ancestors(chapter.id, state).map(item => <span key={item.id}><b>›</b><button aria-current={item.id === chapter.id ? 'page' : undefined} onClick={() => onNavigate(item.id)}>{item.title}</button></span>)}</nav>{clipboard && <button className="nb-icon" aria-label="粘贴" title={`粘贴 ${clipboard.refs.length} 项内容 · Ctrl+V`} disabled={locked || Boolean(draft?.markdown.trim() && !draft.id)} onClick={() => void paste()}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3" /><rect x="9" y="2" width="6" height="6" rx="1.5" /><path d="M8 12h8M8 16h6" /></svg></button>}<div className="cw-view-menu"><button className="cw-view-trigger" aria-label={`切换视图：${view === 'page' ? '正文' : view === 'cards' ? '编排' : '连读'}`} aria-haspopup="menu" aria-expanded={viewMenu} onClick={() => void motionChange(() => { setViewMenu(current => !current); setMenu(false); }, 'popover')}>{view === 'page' ? '正文' : view === 'cards' ? '编排' : '连读'}<Icon name="chevron" /></button>{viewMenu && <div className="cw-menu cw-view-options" role="menu" aria-label="内容视图">{([{ id: 'page', label: '正文', detail: '直接阅读与书写', icon: 'note' }, { id: 'cards', label: '编排', detail: '移动与组织内容', icon: 'organize' }, { id: 'reading', label: '连读', detail: '展开全部子章节', icon: 'book' }] as const).map(mode => <button key={mode.id} role="menuitemradio" aria-checked={view === mode.id} disabled={busy} onClick={() => { void switchView(mode.id); }}><Icon name={mode.icon} /><span>{mode.label}<small>{mode.detail}</small></span>{view === mode.id && <i>✓</i>}</button>)}</div>}</div><button className="cw-source-toggle" aria-label={sourceMode ? '关闭源码模式' : '源码模式'} aria-pressed={sourceMode} title={sourceMode ? '关闭源码模式' : '源码模式'} disabled={view === 'cards'} onClick={() => void motionChange(() => setSourceMode(current => !current))}><Icon name="code" /><span className="cw-control-label">{sourceMode ? '关闭源码模式' : '源码模式'}</span></button><div className="cw-menu-anchor"><button className="nb-icon" aria-label={`${entityName}与内容操作`} aria-expanded={menu} onClick={() => void motionChange(() => { setMenu(current => !current); setViewMenu(false); }, 'popover')}>···</button>{menu && <div className="cw-menu"><div className="cw-menu-heading">{entityName} · {chapter.items.filter(item => item.kind === 'chapter').length} 个章节 · {chapter.items.filter(item => item.kind !== 'chapter').length} 条内容</div>{activeContent && <div className="cw-current-content"><small>{titleFor(activeContent, state)}</small>{renderMemory(activeContent)}{activeContent.kind === 'section' && <button onClick={() => { void motionChange(() => setMenu(false), 'popover'); void requestEditor(activeOwner.current ?? chapter.id, activeContent); }}>创建可编辑副本</button>}</div>}<button disabled={locked || Boolean(draft?.markdown.trim() && !draft.id)} onClick={() => void motionChange(() => { setPopup({ kind: 'move', refs: [{ kind: 'chapter', id: chapter.id }] }); setMenu(false); }, 'popover')}>{isBook ? '作为章节移入…' : '移动章节…'}</button>{parent && <button disabled={locked || Boolean(draft?.markdown.trim() && !draft.id)} onClick={async () => { const result = await run(() => store.ungroupChapter(chapter.id)); if (result) onNavigate(result.id); }}>展开到上级</button>}<button disabled={busy || Boolean(draft?.markdown.trim() && !draft.id)} onClick={async () => { const result = await run(() => chapter.archivedAt ? store.restoreCollection(chapter.id) : store.archiveCollection(chapter.id)); if (result) void motionChange(() => { setMenu(false); if (!chapter.archivedAt) onNavigate(null); }); }}>{chapter.archivedAt ? `恢复${entityName}` : `归档${entityName}`} </button></div>}</div></div> : null;
  return <div ref={surface} className={`cw-workspace is-${view} ${isBook ? 'is-book' : 'is-chapter'} ${sourceMode ? 'is-source' : ''}`} onMouseDownCapture={event => { if (event.button === 2 && window.getSelection()?.toString()) event.preventDefault(); }} onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); } }}>
    {!chapter ? <div className="cw-home"><header><div><span className="cw-eyebrow">个人空间</span><h2>我的阅读</h2></div><button className="cw-primary" disabled={busy} onClick={() => void createBlankBook()}><Icon name="plus" />新建书籍</button></header><div className="cw-home-label"><span>{archive ? '已归档' : '书籍'}</span><button onClick={() => void motionChange(() => setArchive(current => !current))}>{archive ? '返回书架' : '归档'}</button></div><div className="cw-books">{(archive ? state.collections.filter(item => item.archivedAt && !store.isCollectionDeleted(item.id, state)) : rootCollections(state)).filter(item => item.title.includes(query)).map(item => <button className="cw-book" key={item.id} onContextMenu={event => openCollectionMenu(event, item)} onClick={() => onNavigate(item.id)}><span className="cw-book-preview"><strong>{item.title}</strong>{item.items.filter(ref => ref.kind !== 'chapter' || !store.isCollectionDeleted(ref.id, state)).slice(0, 3).map(ref => <span key={refKey(ref)}><Icon name={ref.kind === 'chapter' ? 'book' : 'note'} />{titleFor(ref, state)}</span>)}{!item.items.length && <span className="cw-blank-lines" aria-hidden="true"><i /><i /><i /></span>}</span><span className="cw-book-caption"><Icon name="book" /><strong>{item.title}</strong><small>{parentFor(item.id, state) ? '章节' : '书籍'}{archive && parentFor(item.id, state) ? ` · ${ancestors(item.id, state).slice(0, -1).map(entry => entry.title).join(" / ")}` : ''}</small></span></button>)}{!archive && <button className="cw-book cw-new-book" disabled={busy} onClick={() => void createBlankBook()}><span className="cw-book-preview"><Icon name="plus" /><span>摘要与章节</span></span><span className="cw-book-caption">空白书籍</span></button>}</div></div> : <>
      {toolbarTarget && toolbar ? createPortal(toolbar, toolbarTarget) : toolbar}
      <div className="cw-page"><div className="cw-page-heading"><input key={chapter.id + chapter.title} className="cw-title" aria-label={isBook ? '书名' : '章节标题'} defaultValue={chapter.title} readOnly={locked} maxLength={120} onBlur={event => { const title = event.target.value.trim(); if (!title) event.target.value = chapter.title; else if (title !== chapter.title) void run(() => store.renameCollection(chapter.id, title)); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value = chapter.title; event.currentTarget.blur(); } }} />{chapter.archivedAt && <div className="cw-archive-state">已归档<button disabled={busy} onClick={() => void run(() => store.restoreCollection(chapter.id))}>恢复</button></div>}</div>
      {chosen.length > 0 && view !== 'reading' && <div className="cw-selection-bar"><span>{chosen.length} 项</span><button disabled={locked || Boolean(draft?.markdown.trim() && !draft.id)} onClick={() => void motionChange(() => { setName(displayTitle(chosen[0])); setPopup({ kind: 'group' }); }, 'popover')}><Icon name="book" />{isBook ? '组成章节' : '组成子章节'}</button><button disabled={locked || Boolean(draft?.markdown.trim() && !draft.id)} onClick={() => void motionChange(() => { setDestinationQuery(''); setPopup({ kind: 'move', refs: chosen, from: chapter.id }); }, 'popover')}>移动到…</button><button disabled={locked || Boolean(draft?.markdown.trim() && !draft.id)} title="剪切 · Ctrl+X" onClick={() => copySelection('move')}>剪切</button><button disabled={locked || Boolean(draft?.markdown.trim() && !draft.id) || chosen.some(ref => ref.kind === 'chapter')} title={chosen.some(ref => ref.kind === 'chapter') ? '章节请使用剪切移动' : '复制引用 · Ctrl+C'} onClick={() => copySelection('copy')}>复制引用</button><button disabled={locked || Boolean(draft?.markdown.trim() && !draft.id) || !clipboard} title="粘贴 · Ctrl+V" onClick={() => void paste()}>粘贴</button><button aria-label="取消选择" onClick={() => void motionChange(() => setSelected([]), 'popover')}>×</button></div>}
      <div onContextMenu={event => openContentMenu(event, chapter)}><ChapterSummary key={`${chapter.id}:${summaryRevision}`} chapter={chapter} isBook={isBook} readOnly={archived} mode={sourceMode && view !== 'cards' ? 'sv' : 'ir'} onFocus={() => { setActiveContent(null); activeOwner.current = null; }} commit={commitSummary} /></div>
        {showDirectory && <nav className="cw-chapter-directory" aria-label={isBook ? '章节目录' : '子章节目录'}>
          <header><h2>{isBook ? '章节' : '子章节'}</h2>
            {!archived && <button className="cw-directory-add" disabled={busy} onClick={() => openNew(chapter.id)}><Icon name="plus" />{isBook ? '新建章节' : '新建子章节'}</button>}
          </header>
          <div className="cw-directory-list">{visible.filter(ref => ref.kind === 'chapter').map(ref => renderBlock(ref, chapter))}</div>
        </nav>}
      <div className={`cw-blocks ${view === 'cards' ? 'cw-card-grid' : ''}`}>{visible.filter(ref => view !== 'page' || ref.kind !== 'chapter').map(ref => renderBlock(ref, chapter, view === 'reading'))}</div>
      {draft && draft.owner === chapter.id && <div className="cw-new-editor" onContextMenu={draft.id ? event => openContentMenu(event, chapter, { kind: 'note', id: draft.id! }) : undefined}>{editor}</div>}
      {!archived && <div className="cw-insert">
        <div className="cw-insert-actions" aria-label="添加内容">
          <button ref={writeContentButton} disabled={busy} onClick={() => requestEditor(chapter.id)}><Icon name="note" />{draft?.markdown.trim() ? '继续写下一段' : '添加正文'}</button>
          {!showDirectory && <button disabled={busy} onClick={() => openNew(chapter.id)}><Icon name="plus" />{isBook ? '新建章节' : '新建子章节'}</button>}
          <button disabled={busy} onClick={() => onAddExisting(chapter.id)}><Icon name="link" />从随笔加入</button>
        </div>
      </div>}
      {query && !visible.length && <p className="cw-no-results">这个章节没有匹配的内容</p>}
      </div>
    </>}
    {popup && <Sheet title={popup.kind === 'move' ? '移动到' : popup.kind === 'group' ? (isBook ? '组成章节' : '组成子章节') : popup.parent ? (isBook ? '新建章节' : '新建子章节') : '新建书籍'} close={() => void motionChange(() => setPopup(null), 'popover')}>{popup.kind !== 'move' ? <form className="cw-name-form" onSubmit={async event => { event.preventDefault(); const result = await run(() => popup.kind === 'group' && chapter ? store.groupIntoChapter(chapter.id, chosen, name) : store.createCollection(name, popup.kind === 'new' ? popup.parent : undefined)); if (result) void motionChange(() => { setPopup(null); setSelected([]); onNavigate(result.id); }); }}><input aria-label={popup.kind === 'new' && !popup.parent ? '书名' : '章节名称'} placeholder={popup.kind === 'new' && !popup.parent ? '书名' : '章节名称'} value={name} maxLength={120} onChange={event => setName(event.target.value)} /><footer><button type="button" onClick={() => void motionChange(() => setPopup(null), 'popover')}>取消</button><button className="cw-primary" disabled={busy || !name.trim()}>{popup.kind === 'group' ? '组成章节' : '创建'}</button></footer></form> : <div className="cw-destinations"><label><Icon name="search" /><input aria-label="搜索目标章节" placeholder="搜索章节" value={destinationQuery} onChange={event => setDestinationQuery(event.target.value)} /></label>{popup.refs.every(ref => ref.kind === 'chapter') && <button disabled={busy} onClick={() => void moveRefs(popup.refs, popup.from, null)}><Icon name="book" /><span>独立为书籍</span><small>移至书架</small></button>}{state.collections.filter(item => !ancestors(item.id, state).some(ancestor => ancestor.archivedAt || ancestor.deletedAt) && item.id !== popup.from && item.title.includes(destinationQuery) && !popup.refs.some(ref => ref.kind === 'chapter' && ancestors(item.id, state).some(ancestor => ancestor.id === ref.id))).map(item => <button key={item.id} disabled={busy} onClick={() => void moveRefs(popup.refs, popup.from, item.id)}><Icon name="book" /><span>{item.title}<small>{ancestors(item.id, state).slice(0, -1).map(ancestor => ancestor.title).join(' / ') || '书籍'}</small></span><Icon name="chevron" /></button>)}</div>}</Sheet>}
    {surfaceMenu && <ContextMenu x={surfaceMenu.x} y={surfaceMenu.y} label="内容操作" items={surfaceItems} onClose={() => setSurfaceMenu(null)} />}
    {drag && <div ref={dragGhost} className="cw-drag-ghost" aria-hidden="true" style={{ transform: `translate3d(${drag.x + 16}px,${drag.y + 14}px,0)` }}><Icon name={drag.ref.kind === 'chapter' ? 'book' : 'note'} /><strong>{titleFor(drag.ref, state)}</strong><p>{previewFor(drag.ref, state) || '移动章节与其中的内容'}</p></div>}
    {message && <div className="cw-status" role="status">{message}</div>}
  </div>;
}
