import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Markdown } from '../Markdown';
import { Icon, type IconName } from '../manual-demo/icons';
import { CuratedContent } from '../manual-demo/CuratedContent';
import { MemoComposer } from './MemoComposer';
import { ChapterWorkspace } from './ChapterWorkspace';
import { TrashPanel } from './TrashPanel';
import { ArchivePanel } from './ArchivePanel';
import { ContextMenu } from './ContextMenu';
import { recoverLegacyQuoteMarkdown } from './editor-selection';
import './memo-source.css';
import { AssistantPanel, AssistantSettingsIcon } from './AssistantPanel';
import { SettingsPanel, type SettingsCategory } from './SettingsPanel';
import { IS_DEMO_MODE } from '../demo';
import { GlobalSearch } from './GlobalSearch';
import type { GlobalSearchResult } from './global-search';
import { useAssistantSelection } from './useAssistantSelection';
import { ReferenceOutline } from './ReferenceOutline';
import { FloatingComponentLibrary, ComponentLibraryProvider, useComponentLibrary } from './ComponentLibrary';
import { ContentPicker, DestinationPicker } from './CollectionPicker';
import { useNotebook } from './useNotebook';
import { useReadingActivity } from './useReadingActivity';
import { MemoryLibrary } from './MemoryLibrary';
import { memoryScoringContext } from './memory-context';
import { motionChange, useMotionState } from './motion';
import * as store from './store';
import { bodyFor, collectionPath, isCollectionArchived, manual, memoryExcerptFor, noteTitle, previewFor, refKey, rootCollections, sectionMap, shortTitle, tagsFor, titleFor } from './content';
import './notebook.css';
import './organizer-interactions.css';
import './craft-desktop.css';
import './craft-editor.css';
import './notebook-navigation.css';
import './start-writing.css';
import './markdown-appearance.css';
import './dark-markdown.css';
import './dark-surfaces.css';
import './appearance-toggle.css';
import './reference-outline.css';
import './reference-answers.css';
import './motion.css';

type Page = 'home' | 'notes' | 'reading' | 'memory';
type Modal = { kind: 'create' } | { kind: 'compose' } | { kind: 'trash' } | { kind: 'archive' } | { kind: 'rename'; collection: string; ref?: store.Ref } | { kind: 'file'; ref: store.Ref } | { kind: 'transfer'; refs: store.Ref[]; from: string; mode: 'copy' | 'move' } | { kind: 'add'; collection: string } | { kind: 'detail'; ref: store.Ref } | { kind: 'drafts' };
type NavigationEdit = { kind: 'rename'; id: string; value: string } | { kind: 'create'; parentId?: string; value: string };
const NAV_EXPANSION_KEY = 'read-navigation-expanded';
function savedNavigationExpansion(): Record<string, boolean> {
  try { return JSON.parse(sessionStorage.getItem(NAV_EXPANSION_KEY) ?? '{}') as Record<string, boolean>; } catch { return {}; }
}
function ChapterSymbol() {
  return <svg data-icon="chapter" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h6" /></svg>;
}
function SmallButton({ icon, label, onClick, disabled }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="nb-icon" title={label} aria-label={label} onClick={onClick} disabled={disabled}><Icon name={icon} /></button>;
}
function Dialog({ title, children, close, className = '', headerActions }: { title: string; children: ReactNode; close: () => void; className?: string; headerActions?: ReactNode }) {
  const element = useRef<HTMLDialogElement>(null);
  const opener = useRef(document.activeElement as HTMLElement);
  useEffect(() => {
    element.current?.showModal();
    const initialFocus = className.includes('nb-compose-dialog')
      ? element.current?.querySelector<HTMLElement>('.nb-global-composer textarea, .nb-global-composer [contenteditable="true"]')
      : element.current?.querySelector<HTMLElement>('textarea,input');
    initialFocus?.focus({ preventScroll: true });
    return () => { element.current?.close(); if (opener.current?.isConnected) opener.current.focus(); };
  }, []);
  return <dialog className={`nb-dialog ${className}`} ref={element} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <header><h2>{title}</h2>{headerActions}<button type="button" className="nb-icon" aria-label="关闭" onClick={close}>×</button></header>{children}
  </dialog>;
}
function SourceBody({ id, recall = false }: { id: string; recall?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const answerId = useId();
  useLayoutEffect(() => { setRevealed(false); }, [id, recall]);
  const section = sectionMap.get(id);
  if (!section) return null;
  const answers = section.parts.filter(part => part.role === 'answer' || section.layout === 'recall' && part.role === 'note');
  const primary = section.parts.filter(part => !answers.includes(part));
  const visible = !recall || revealed;
  return <div className="nb-source-body">
    <div data-reading-core>
    {primary.map(part => <Markdown key={part.id} body={part.markdown} />)}
    {answers.length > 0 && <>
      {recall && <button type="button" className="nb-answer-reveal" aria-expanded={visible} aria-controls={answerId} aria-label={`${visible ? '收起答案' : '查看答案'}：${shortTitle(section.title)}`} onClick={() => void motionChange(() => setRevealed(value => !value))}><Icon name="eye" /><span>{visible ? '收起答案' : '查看答案'}</span><Icon name="chevron" /></button>}
      <section id={answerId} className="nb-answer-sheet" aria-label={`答案与检查点：${shortTitle(section.title)}`} hidden={!visible}>
        <header className="nb-answer-heading"><Icon name="list" /><h4>答案与检查点</h4></header>
        {visible && answers.map(part => <div className="nb-answer-part" key={part.id}>{part.role === 'note' && <p className="nb-answer-part-label">{part.label}</p>}<Markdown body={part.markdown} /></div>)}
      </section>
    </>}
    </div>
    {(answers.length === 0 || visible) && <CuratedContent sectionId={id} />}
  </div>;
}

export function NotebookApp() {
  return <ComponentLibraryProvider><NotebookWorkspace /></ComponentLibraryProvider>;
}

function NotebookWorkspace() {
  const [appearance, setAppearance] = useMotionState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('read-appearance') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
  }, 'theme');
  useLayoutEffect(() => {
    document.documentElement.dataset.readTheme = appearance;
    document.documentElement.style.colorScheme = appearance;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', appearance === 'dark' ? '#101113' : '#eeeef0');
    try { localStorage.setItem('read-appearance', appearance); } catch { /* Session choice still works if storage is unavailable. */ }
  }, [appearance]);
  useEffect(() => {
    const syncAppearance = (event: StorageEvent) => {
      if (event.key === 'read-appearance' || event.key === null) setAppearance(event.newValue === 'dark' ? 'dark' : 'light');
    };
    window.addEventListener('storage', syncAppearance);
    return () => window.removeEventListener('storage', syncAppearance);
  }, []);
  const componentLibrary = useComponentLibrary();
  const business = useNotebook();
  const { state, busy, now } = business;
  useReadingActivity(state, business.reportError);
  const [page, setPage] = useState<Page>('home');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTarget, setSearchTarget] = useState<string | null>(null);
  const [assistantWidth, setAssistantWidth] = useState(400);
  const [tag, setTag] = useMotionState('');
  const [archived, setArchived] = useMotionState(false);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [topicId, setTopicId] = useMotionState<string | null>(null);
  const [assistantOpen, setAssistantOpen] = useMotionState(false, 'layout');
  const [assistantSettingsOpen, setAssistantSettingsOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('general');
  const openSettings = (category: SettingsCategory = 'general') => { setSettingsCategory(category); setAssistantSettingsOpen(true); };
  const [assistantConfigVersion, setAssistantConfigVersion] = useState(0);
  const [answerMode, setAnswerMode] = useMotionState<'read' | 'recall'>(() => {
    try { return sessionStorage.getItem('read-reference-answer-mode') === 'recall' ? 'recall' : 'read'; } catch { return 'read'; }
  });
  useEffect(() => {
    try { sessionStorage.setItem('read-reference-answer-mode', answerMode); } catch { /* Keep the current reading choice without storage. */ }
  }, [answerMode]);
  const [referenceOutlineOpen, setReferenceOutlineOpen] = useMotionState(() => {
    try { return sessionStorage.getItem('read-reference-outline-open') !== 'false'; } catch { return true; }
  }, 'layout');
  const referenceOutlineTrigger = useRef<HTMLButtonElement>(null);
  const isReference = page === 'reading' && collectionId === 'manual';
  const referenceOutlineVisible = isReference && Boolean(topicId) && referenceOutlineOpen && !assistantOpen;
  useEffect(() => {
    try { sessionStorage.setItem('read-reference-outline-open', String(referenceOutlineOpen)); } catch { /* Keep the in-session choice when storage is unavailable. */ }
  }, [referenceOutlineOpen]);
  const [modal, setModal] = useMotionState<Modal | null>(null, 'popover');
  const [dialogName, setDialogName] = useState('');
  const [dragOver, setDragOver] = useState('');
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useMotionState<string | null>(null, 'popover');
  const [mobileNav, setMobileNav] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useMotionState(() => sessionStorage.getItem('read-sidebar-collapsed') === 'true', 'layout');
  const [expandedNodes, setExpandedNodes] = useMotionState<Record<string, boolean>>(savedNavigationExpansion, 'layout');
  const [navigationMenu, setNavigationMenu] = useMotionState<string | null>(null, 'popover');
  const [navigationPoint, setNavigationPoint] = useState({ x: 240, y: 100 });
  const [navigationEdit, setNavigationEdit] = useState<NavigationEdit | null>(null);
  const [workspaceToolbar, setWorkspaceToolbar] = useState<HTMLElement | null>(null);
  const navigationInput = useRef<HTMLInputElement>(null);
  const navigationSaving = useRef(false);
  const [notice, setNotice] = useMotionState('', 'popover');
  const [libraryView, setLibraryView] = useMotionState<'grid' | 'list'>('grid');
  const [sortByTitle, setSortByTitle] = useMotionState(false);
  const dragCleanup = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);
  const [dragCard, setDragCard] = useState<{ refs: store.Ref[]; title: string; excerpt: string; from?: string } | null>(null);
  const dragOverlay = useRef<HTMLDivElement>(null);
  const dragCaption = useRef<HTMLDivElement>(null);
  const [landed, setLanded] = useState('');
  const main = useRef<HTMLElement>(null);
  const assistantSelection = useAssistantSelection(state, { page, collectionId, topicId }, main);
  useEffect(() => {
    const search = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f' && !event.altKey && !document.querySelector('dialog[open]')) {
        event.preventDefault(); setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', search);
    return () => window.removeEventListener('keydown', search);
  }, []);
  useEffect(() => {
    if (!searchTarget) return;
    let frame = 0, attempts = 0;
    let marked: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const locate = () => {
      const target = main.current?.querySelector<HTMLElement>(searchTarget);
      if (!target && attempts++ < 45) { frame = requestAnimationFrame(locate); return; }
      if (target) { target.scrollIntoView({ block: 'start', behavior: 'instant' }); target.classList.add('nb-search-hit'); marked = target; }
      timer = setTimeout(() => { marked?.classList.remove('nb-search-hit'); setSearchTarget(null); }, 1600);
    };
    frame = requestAnimationFrame(locate);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); marked?.classList.remove('nb-search-hit'); };
  }, [searchTarget, collectionId, topicId]);
  const referencePosition = useRef<{ element: HTMLElement; top: number; topicId: string } | null>(null);
  const rememberReferencePosition = (sectionOnly = false) => {
    const root = main.current;
    if (!isReference || !topicId || !root) return;
    root.style.overflowAnchor = 'none';
    root.scrollTo({ top: root.scrollTop, behavior: 'instant' });
    const sections = Array.from(root.querySelectorAll<HTMLElement>(sectionOnly ? '.nb-source' : '.nb-source, .nb-source h3, .nb-source p, .nb-source pre, .nb-source li, .nb-source summary')).filter(item => item.getBoundingClientRect().height > 0 && (!item.closest('details:not([open])') || item.tagName === 'SUMMARY'));
    const readingLine = root.getBoundingClientRect().top + 84;
    const element = [...sections].reverse().find(item => item.getBoundingClientRect().top <= readingLine) ?? sections[0];
    if (element) referencePosition.current = { element, top: sectionOnly && element.getBoundingClientRect().bottom > readingLine && element.getBoundingClientRect().top < readingLine ? 76 : element.getBoundingClientRect().top, topicId };
  };
  useLayoutEffect(() => {
    const position = referencePosition.current;
    const root = main.current;
    referencePosition.current = null;
    if (!root) return;
    if (position?.element.isConnected && isReference && position.topicId === topicId) root.scrollTo({ top: root.scrollTop + position.element.getBoundingClientRect().top - position.top, behavior: 'instant' });
    // Re-enable native anchoring after this layout change, for late-loading content.
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => { root.style.overflowAnchor = ''; }); });
    return () => { cancelAnimationFrame(frame); root.style.overflowAnchor = ''; };
  }, [referenceOutlineVisible, assistantOpen, sidebarCollapsed, isReference, topicId, answerMode]);
  const nav = useRef<HTMLElement>(null);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const lastRead = useRef(0);
  const lastEditingAction = useRef(0);
  const undoRequest = useRef<(target: EventTarget | null) => boolean>(() => false);
  const undoQueue = useRef(Promise.resolve());
  const undoActive = useRef(false);
  useEffect(() => {
    const edited = () => { lastEditingAction.current = Date.now(); };
    const keyboard = (event: KeyboardEvent) => {
      if (!event.isComposing && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'z' && undoRequest.current(event.target)) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    };
    const toolbarUndo = (event: Event) => { if (undoRequest.current(document.activeElement)) event.preventDefault(); };
    document.addEventListener('beforeinput', edited, true);
    window.addEventListener('read:editing-action', edited);
    window.addEventListener('keydown', keyboard, true);
    window.addEventListener('read:undo', toolbarUndo);
    return () => {
      document.removeEventListener('beforeinput', edited, true);
      window.removeEventListener('read:editing-action', edited);
      window.removeEventListener('keydown', keyboard, true);
      window.removeEventListener('read:undo', toolbarUndo);
    };
  }, []);
  const assistantTrigger = useRef<HTMLButtonElement>(null);
  const canUseComponents = page === 'notes' || page === 'reading' && Boolean(collectionId && collectionId !== 'manual');
  const ancestorIds = state && collectionId && collectionId !== 'manual' ? collectionPath(collectionId, state).slice(0, -1).map(item => item.id).join('|') : '';

  useEffect(() => { sessionStorage.setItem(NAV_EXPANSION_KEY, JSON.stringify(expandedNodes)); }, [expandedNodes]);
  useEffect(() => { sessionStorage.setItem('read-sidebar-collapsed', String(sidebarCollapsed)); }, [sidebarCollapsed]);
  useEffect(() => {
    const ids = ancestorIds ? ancestorIds.split('|') : [];
    if (collectionId === 'manual' && topicId) ids.push('manual');
    if (ids.length) setExpandedNodes(current => ids.every(id => current[id]) ? current : { ...current, ...Object.fromEntries(ids.map(id => [id, true])) });
  }, [ancestorIds, collectionId, topicId]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const current = nav.current?.querySelector<HTMLElement>('.nb-tree-open[aria-current="page"]');
      if (current && !current.closest('[inert]')) current.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [collectionId, topicId, ancestorIds]);
  useEffect(() => {
    if (!navigationEdit) return;
    navigationInput.current?.focus(); navigationInput.current?.select();
  }, [navigationEdit?.kind, navigationEdit && 'id' in navigationEdit ? navigationEdit.id : undefined, navigationEdit && 'parentId' in navigationEdit ? navigationEdit.parentId : undefined]);
  useEffect(() => {
    if (!navigationMenu) return;
    const dismiss = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest('.nb-context-menu,.nb-tree-more')) setNavigationMenu(null); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [navigationMenu]);

  useEffect(() => () => dragCleanup.current?.(), []);
  useLayoutEffect(() => { main.current?.scrollTo({ top: 0, behavior: 'instant' }); setMenu(null); }, [page, collectionId, topicId]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 2500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { if (!landed) return; const timer = setTimeout(() => setLanded(''), 800); return () => clearTimeout(timer); }, [landed]);
  useEffect(() => {
    if (!mobileNav) return;
    nav.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNav(false);
      if (event.key === 'Tab') {
        const controls = Array.from(nav.current?.querySelectorAll<HTMLElement>('button,input') ?? []).filter(item => item.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); mobileTrigger.current?.focus(); };
  }, [mobileNav]);

  if (!state) return <div className="nb-loading">{business.error || '正在打开笔记…'}</div>;
  const activeNotes = state.notes.filter(note => store.isMemo(note) && !note.archivedAt);
  const allTags = [...new Set(activeNotes.flatMap(note => tagsFor(note.markdown)))].sort();
  const collection = state.collections.find(item => item.id === collectionId);
  const topic = manual.topics.find(item => item.id === topicId);
  const visibleSectionIds = topic?.sectionIds.filter(id => !query || bodyFor({ kind: 'section', id }, state).includes(query) || titleFor({ kind: 'section', id }, state).includes(query)) ?? [];
  const topicHasAnswers = topic?.sectionIds.some(id => {
    const section = sectionMap.get(id);
    return section?.parts.some(part => part.role === 'answer' || section.layout === 'recall' && part.role === 'note');
  }) ?? false;
  const folderColors = ['#3c91ed', '#a46aca', '#dd9d35', '#53a48d', '#e17686', '#54a6bb'];
  const topicIcons: IconName[] = ['code', 'organize', 'link', 'organize', 'code', 'memory', 'experiment', 'code', 'code', 'experiment', 'code', 'code', 'note', 'code', 'code', 'code', 'list', 'organize', 'code', 'list', 'organize', 'book', 'history', 'note', 'book', 'link', 'book'];
  const visibleTopics = manual.topics.filter(item => item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  if (sortByTitle) visibleTopics.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  const pageTitle = page === 'home' ? '开始' : page === 'notes' ? archived ? '归档' : tag ? `#${tag}` : '随笔' : page === 'memory' ? '记忆库' : topic?.title ?? collection?.title ?? (collectionId === 'manual' ? 'AI 应用与 Agent' : '阅读站');
  const assistantContext = page !== 'reading' ? '' : (isReference ? (topic?.sectionIds ?? []).map(id => ({ kind: 'section' as const, id })) : collection?.items ?? [])
    .filter(ref => ref.kind !== 'chapter').map(ref => `## ${titleFor(ref, state)}\n\n${bodyFor(ref, state)}`).join('\n\n');
  const matchesNote = (note: store.Note) => `${note.markdown}\n${note.source?.quote ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  const notes = state.notes.filter(note => store.isMemo(note) && Boolean(note.archivedAt) === archived && (!tag || tagsFor(note.markdown).includes(tag)) && matchesNote(note)).sort((a, b) => b.createdAt - a.createdAt);
  const memoryRefs: store.Ref[] = state.entries.filter(entry => entry.active).map(entry => ({ kind: entry.documentId === 'read-notebook' ? 'note' as const : 'section' as const, id: entry.sectionId })).filter(ref => {
    if (ref.kind === 'section') return sectionMap.has(ref.id);
    const note = state.notes.find(item => item.id === ref.id);
    return note && (store.isMemo(note) || state.collections.some(owner => !store.isCollectionDeleted(owner.id, state) && owner.items.some(item => item.kind === 'note' && item.id === note.id)));
  });
  const memory = memoryRefs.map(ref => ({ ref, projection: store.getProjection(ref, state, now) }));
  const ownBooks = rootCollections(state);
  const recentNotes = [...activeNotes].sort((a, b) => b.updatedAt - a.updatedAt).filter(matchesNote).slice(0, 6);
  const matchingBooks = ownBooks.filter(book => book.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const ownerOf = (note: store.Note) => state.collections.find(item => !isCollectionArchived(item.id, state) && item.items.some(ref => ref.kind === 'note' && ref.id === note.id));
  const modifiedLabel = (at: number) => {
    const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86400000);
    return days === 0 ? '今天' : days === 1 ? '昨天' : new Date(at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };
  const discardUnusedQuote = () => {
    if (state.draft.source && !state.draft.editingId && !state.draft.markdown.trim()) business.draft({ markdown: '' });
  };
  const go = (next: Page, id: string | null = null) => { if (busy) return; if (next === 'notes') discardUnusedQuote(); void motionChange(() => { setPage(next); setCollectionId(id); setTopicId(null); setQuery(''); setTag(''); setMobileNav(false); setNavigationMenu(null); setNavigationEdit(null); }); };
  undoRequest.current = target => {
    const pending = store.peekDeletionUndo();
    if (!pending || modal || navigationEdit) return false;
    const editing = target instanceof Element && Boolean(target.closest('input,textarea,[contenteditable="true"]'));
    if (editing && lastEditingAction.current > pending.deletedAt) return false;
    if (busy && !undoActive.current) return true;
    undoActive.current = true;
    undoQueue.current = undoQueue.current.then(async () => {
      const restored = await business.run(() => store.undoLastDeletion());
      if (restored) { setPage('reading'); setCollectionId(restored.collectionId); setTopicId(null); setNavigationMenu(null); setNotice('已撤销删除'); }
    }).finally(() => { undoActive.current = false; });
    return true;
  };
  const createBlankBook = async () => {
    const result = await business.run(() => store.createCollection('未命名书籍'));
    if (result) go('reading', result.id);
  };
  const openModal = (next: Modal) => {
    setMenu(null);
    setDialogName(next.kind === 'rename' ? next.ref ? collection?.titles?.[refKey(next.ref)] ?? titleFor(next.ref, state) : state.collections.find(item => item.id === next.collection)?.title ?? '' : '');
    setModal(next);
  };
  const newMemo = () => { discardUnusedQuote(); openModal({ kind: 'compose' }); };
  const openSearchResult = (result: GlobalSearchResult) => {
    const target = result.target;
    setSearchOpen(false);
    if (target.kind === 'memo') { openModal({ kind: 'detail', ref: { kind: 'note', id: target.memoId } }); return; }
    if (target.kind === 'manual') {
      go('reading', 'manual'); setTopicId(target.topicId ?? null); setAnswerMode('read');
      setSearchTarget(target.sectionId ? `#source-${CSS.escape(target.sectionId)}` : null);
    } else {
      go('reading', target.collectionId);
      setSearchTarget(target.ref ? `[data-ai-ref="${CSS.escape(refKey(target.ref))}"]` : target.summary ? '.cw-summary' : null);
    }
  };
  const closeModal = () => { if (modal?.kind === 'compose') discardUnusedQuote(); setModal(null); };
  const save = async (markdown = state.draft.markdown) => Boolean(await business.run(() => store.saveNote({ id: state.draft.editingId, markdown, source: state.draft.source }), true));
  const quoteMemo = (source: store.MemoSource) => {
    if (state.draft.editingId || (state.draft.markdown.trim() && !state.draft.source)) { setNotice('请先保存或取消当前随笔草稿'); return; }
    // Preserve authored thoughts when replacing a quote; unused quote-only drafts
    // are discarded on close or ordinary memo entry.
    business.draft({ markdown: state.draft.markdown, source });
    if (state.draft.markdown.trim()) setNotice('已更换引用，随笔草稿保留');
    openModal({ kind: 'compose' });
  };
  const deleteCollection = async (id: string) => {
    const result = await business.run(() => store.trashCollection(id));
    if (!result) return;
    setNavigationMenu(null);
    if (collectionId && collectionPath(collectionId, state).some(item => item.id === id)) go('reading');
    setNotice('已删除 · Ctrl+Z 撤销');
  };
  const sourceCitation = (source: store.MemoSource) => {
    const sourceNote = source.ref?.kind === 'note' ? state.notes.find(item => item.id === source.ref!.id) : undefined;
    // A legacy plain-text quote can borrow formatting only from an unchanged source.
    const original = source.kind === 'summary' ? state.collections.find(item => item.id === source.collectionId)?.summary ?? ''
      : sourceNote ? sourceNote.updatedAt <= source.capturedAt ? sourceNote.markdown : ''
      : source.ref?.kind === 'section' ? bodyFor(source.ref, state) : '';
    const markdown = source.quoteFormat === 'markdown' ? source.quote : recoverLegacyQuoteMarkdown(source.quote, original);
    const quote = () => markdown !== null ? <Markdown body={markdown} /> : <p className="nb-memo-plain-quote">{source.quote}</p>;
    return <aside className="nb-memo-source" aria-label="随笔来源">
    <button type="button" onClick={() => {
      if (store.isCollectionDeleted(source.collectionId, state) || !state.collections.some(item => item.id === source.collectionId)) { setNotice('来源已删除，引用快照仍保留'); return; }
      setModal(null); go('reading', source.collectionId);
    }}><Icon name="link" /><span>{source.path.join(' / ')} · {source.kind === 'summary' ? '摘要' : source.title}</span><Icon name="chevron" /></button>
    <div className="nb-memo-quote">{quote()}</div>
    {source.contextMarkdown && source.contextMarkdown.trim() !== (markdown ?? source.quote).trim() && <details><summary>上下文{source.contextTitle ? ` · ${source.contextTitle}` : ''}</summary><div className="nb-memo-context-selection"><Markdown body={source.contextMarkdown} /></div></details>}
  </aside>;
  };
  const edit = (note: store.Note) => {
    if (state.draft.markdown.trim() || state.draft.editingId || state.draft.source) { setNotice('请先保存或取消当前草稿'); return; }
    void motionChange(() => {
      business.draft({ markdown: note.markdown, editingId: note.id, source: note.source }); go('notes'); setArchived(false); setModal(null); setMenu(null);
      requestAnimationFrame(() => document.getElementById(`note-${note.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    });
  };
  const record = async (ref: store.Ref) => {
    if (Date.now() - lastRead.current < 600) return;
    lastRead.current = Date.now();
    const result = await business.run(() => store.recordRef(ref, { source: 'manual', sessionId: crypto.randomUUID() }));
    if (result) setNotice(result.recorded ? '已补记本次阅读' : '已合并到最近一次阅读');
  };
  const startDrag = (event: ReactPointerEvent, refs: store.Ref[], from?: string) => {
    if (event.button !== 0 || event.pointerType === 'touch' || busy || !refs.length) return;
    if ((event.target as HTMLElement).closest('input,.nb-file-row-actions,button:not(.nb-file-name):not(.nb-card-grip)')) return;
    const startX = event.clientX, startY = event.clientY;
    let started = false, x = startX, y = startY, copyModifier = event.ctrlKey || event.metaKey, frame = 0, marker = '';
    const title = (from ? state.collections.find(item => item.id === from)?.titles?.[refKey(refs[0])] : undefined) ?? titleFor(refs[0], state);
    const targetAt = () => {
      const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-collection]');
      const to = element?.dataset.dropCollection;
      if (!element || !to) return null;
      const targetCollection = state.collections.find(item => item.id === to);
      if (!targetCollection || isCollectionArchived(targetCollection.id, state)) return null;
      const key = element.dataset.dropBefore;
      let before = key ? targetCollection.items.find(item => refKey(item) === key) : undefined;
      let side = 'before';
      if (key && y > element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2) {
        side = 'after';
        const index = targetCollection.items.findIndex(item => refKey(item) === key);
        before = targetCollection.items.slice(index + 1).find(item => from !== to || !refs.some(ref => refKey(ref) === refKey(item)));
      }
      return { element, to, before, targetCollection, marker: key ? `${side}:${key}` : element.classList.contains('nb-file-list') ? `end:${to}` : to };
    };
    const tick = () => {
      if (!started) return;
      const target = targetAt();
      if ((target?.marker ?? '') !== marker) { marker = target?.marker ?? ''; setDragOver(marker); }
      const overlay = dragOverlay.current;
      if (overlay) {
        const left = Math.max(8, Math.min(x + 18, window.innerWidth - 290));
        const top = Math.max(8, Math.min(y + 16, window.innerHeight - overlay.offsetHeight - 8));
        overlay.style.transform = `translate3d(${left}px,${top}px,0)`;
        overlay.dataset.valid = String(Boolean(target));
      }
      if (dragCaption.current) {
        const mode = from === target?.to ? '调整顺序' : from && !copyModifier ? '移动到' : '加入';
        const duplicate = target && refs.every(ref => target.targetCollection.items.some(item => refKey(item) === refKey(ref)));
        dragCaption.current.textContent = target ? `${mode} · ${target.targetCollection.title}${duplicate && from !== target.to ? '（已有引用）' : ''}` : '拖到阅读合集';
      }
      const scroller = document.elementFromPoint(x, y)?.closest<HTMLElement>('.nb-main,.nb-sidebar-scroll');
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        const delta = y < r.top + 52 ? -Math.ceil((r.top + 52 - y) / 4) : y > r.bottom - 52 ? Math.ceil((y - r.bottom + 52) / 4) : 0;
        if (delta) scroller.scrollBy({ top: Math.max(-16, Math.min(16, delta)), behavior: 'instant' });
      }
      frame = requestAnimationFrame(tick);
    };
    const move = (pointer: PointerEvent) => {
      x = pointer.clientX; y = pointer.clientY; copyModifier = pointer.ctrlKey || pointer.metaKey;
      if (!started && Math.hypot(x - startX, y - startY) < 6) return;
      pointer.preventDefault();
      if (!started) {
        started = true; setDragging(true); setDragCard({ refs, title, excerpt: previewFor(refs[0], state), from });
        frame = requestAnimationFrame(tick);
      }
    };
    const cleanup = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', keydown); window.removeEventListener('blur', cancel);
      setDragging(false); setDragCard(null); setDragOver(''); dragCleanup.current = null;
    };
    const swallowClick = () => { suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false; }, 120); };
    const cancel = () => { if (started) swallowClick(); cleanup(); };
    const keydown = (key: KeyboardEvent) => { copyModifier = key.ctrlKey || key.metaKey; if (key.key === 'Escape') { key.preventDefault(); cancel(); } };
    const finish = (pointer: PointerEvent) => {
      x = pointer.clientX; y = pointer.clientY; copyModifier = pointer.ctrlKey || pointer.metaKey;
      const target = targetAt(); cleanup();
      if (!started) return;
      swallowClick();
      if (!target) return;
      void business.run<store.Collection | store.Collection[]>(() => from ? store.transferItems({ from, refs, to: target.to, before: target.before, mode: !copyModifier ? 'move' : 'copy' }) : store.copyIntoCollection({ refs, to: target.to, before: target.before })).then(result => {
        if (result) { setLanded(target.to); setNotice(`${from === target.to ? '已调整顺序' : from && !copyModifier ? '已移到' : '已加入'} ${target.targetCollection.title}`); }
      });
    };
    dragCleanup.current?.(); dragCleanup.current = cleanup;
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', keydown); window.addEventListener('blur', cancel);
  };
  const renderNote = (note: store.Note) => {
    const ref: store.Ref = { kind: 'note', id: note.id };
    return <article className={`nb-memo ${dragCard?.refs.some(item => refKey(item) === refKey(ref)) ? 'nb-drag-source' : ''}`} data-reading-key={state.draft.editingId !== note.id ? refKey(ref) : undefined} id={`note-${note.id}`} key={note.id}>
      {state.draft.editingId === note.id && modal?.kind !== 'compose' ? <MemoComposer allowEmpty={Boolean(state.draft.source)} tags={allTags} value={state.draft.markdown} onChange={markdown => business.draft({ markdown, editingId: note.id, source: note.source })} onSave={save} onCancel={() => business.draft({ markdown: '' })} editing disabled={busy} autoFocus /> : <>
        <header className="nb-memo-header nb-drag-handle" onPointerDown={event => startDrag(event, [ref])}><button className="nb-card-grip" title="拖入阅读合集" aria-label={`整理随笔：${noteTitle(note.markdown || note.source?.quote || '')}`} onClick={() => openModal({ kind: 'file', ref })}><svg viewBox="0 0 16 20" aria-hidden="true">{[5,10,15].map(y => <g key={y}><circle cx="5" cy={y} r="1.2" /><circle cx="11" cy={y} r="1.2" /></g>)}</svg></button><button className="nb-time" onClick={() => openModal({ kind: 'detail', ref })} title={`创建于 ${new Date(note.createdAt).toLocaleString()}${note.updatedAt > note.createdAt ? ` · 修改于 ${new Date(note.updatedAt).toLocaleString()}` : ''}`}><time>{new Date(note.createdAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></button>
          <div className="nb-card-actions"><SmallButton icon="book" label={`放入合集：${noteTitle(note.markdown || note.source?.quote || '')}`} onClick={() => openModal({ kind: 'file', ref })} /><button className="nb-icon" aria-label={`更多：${noteTitle(note.markdown || note.source?.quote || '')}`} aria-expanded={menu === note.id} onClick={() => setMenu(menu === note.id ? null : note.id)}>···</button></div>
          {menu === note.id && <div className="nb-menu" onKeyDown={event => { if (event.key === 'Escape') setMenu(null); }}>
            {note.archivedAt ? <button disabled={busy} onClick={() => void business.run(() => store.restoreNote(note.id))}>恢复随笔</button> : <><button onClick={() => edit(note)}>编辑</button><button onClick={() => openModal({ kind: 'file', ref })}>加入阅读站</button><button disabled={busy} onClick={() => { void business.run(() => store.archiveNote(note.id)); setMenu(null); }}>归档</button></>}
          </div>}
        </header>{note.source && sourceCitation(note.source)}<Markdown body={note.markdown} />
        {(tagsFor(note.markdown).length > 0 || note.sourceSectionId) && <footer className="nb-memo-tags">{tagsFor(note.markdown).map(item => <button key={item} onClick={() => { setTag(item); setQuery(''); }}>#{item}</button>)}{note.sourceSectionId && <button onClick={() => openModal({ kind: 'detail', ref: { kind: 'section', id: note.sourceSectionId! } })}><Icon name="link" />原文</button>}</footer>}
      </>}
    </article>;
  };

  const toggleNavigation = (id: string) => setExpandedNodes(current => ({ ...current, [id]: !current[id] }));
  const focusNavigation = (id: string) => {
    const target = nav.current?.querySelector<HTMLButtonElement>(`[data-nav-id="${CSS.escape(id)}"]`);
    if (target && !target.closest('[inert]')) target.focus();
  };
  const startNavigationCreate = (parentId?: string) => {
    setNavigationMenu(null);
    if (!parentId) { void createBlankBook(); return; }
    if (parentId) setExpandedNodes(current => ({ ...current, [parentId]: true }));
    setNavigationEdit({ kind: 'create', parentId, value: '' });
  };
  const saveNavigationEdit = async () => {
    if (!navigationEdit || !navigationEdit.value.trim() || navigationSaving.current) return;
    navigationSaving.current = true;
    const edit = navigationEdit;
    const result = await business.run(() => edit.kind === 'rename' ? store.renameCollection(edit.id, edit.value) : store.createCollection(edit.value, edit.parentId));
    navigationSaving.current = false;
    if (!result) return;
    setNavigationEdit(null);
    if (edit.kind === 'create') go('reading', result.id);
    requestAnimationFrame(() => focusNavigation(result.id));
  };
  const navigationKeys = (event: ReactKeyboardEvent<HTMLButtonElement>, id: string, children: string[], parentId?: string, item?: store.Collection) => {
    const key = event.key;
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
      event.preventDefault();
      const rows = Array.from(nav.current?.querySelectorAll<HTMLButtonElement>('.nb-tree-open') ?? []).filter(row => row.getClientRects().length && !row.closest('[inert]'));
      const index = rows.indexOf(event.currentTarget);
      rows[key === 'Home' ? 0 : key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (key === 'ArrowDown' ? 1 : -1)))]?.focus();
    } else if (key === 'ArrowRight' && children.length) {
      event.preventDefault();
      if (!expandedNodes[id]) setExpandedNodes(current => ({ ...current, [id]: true })); else focusNavigation(children[0]);
    } else if (key === 'ArrowLeft') {
      event.preventDefault();
      if (expandedNodes[id] && children.length) setExpandedNodes(current => ({ ...current, [id]: false })); else if (parentId) focusNavigation(parentId);
    } else if (key === 'F2' && item) {
      event.preventDefault(); setNavigationEdit({ kind: 'rename', id, value: item.title });
    } else if (key === 'Escape') setNavigationMenu(null);
  };
  const navigationForm = (depth: number, label: string) => <form className="nb-tree-edit" style={{ '--chapter-depth': depth } as CSSProperties} onSubmit={event => { event.preventDefault(); void saveNavigationEdit(); }}>
    <span className="nb-tree-disclosure-space" />{depth === 0 ? <Icon name="book" /> : <ChapterSymbol />}<input ref={navigationInput} aria-label={label} placeholder={depth === 0 ? '书名' : '章节名称'} value={navigationEdit?.value ?? ''} disabled={busy} maxLength={120} onChange={event => setNavigationEdit(current => current ? { ...current, value: event.target.value } : current)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); const id = navigationEdit?.kind === 'rename' ? navigationEdit.id : navigationEdit?.parentId; setNavigationEdit(null); if (id) requestAnimationFrame(() => focusNavigation(id)); } }} /><button type="submit" title="确认名称" aria-label="确认名称" disabled={busy || !navigationEdit?.value.trim()}>↵</button>
  </form>;
  const renderChapterNav = (item: store.Collection, depth = 0, parentId?: string): ReactNode => {
    const children = item.items.filter(ref => ref.kind === 'chapter').map(ref => state.collections.find(child => child.id === ref.id)).filter((child): child is store.Collection => Boolean(child && !child.archivedAt && !store.isCollectionDeleted(child.id, state)));
    const expanded = Boolean(expandedNodes[item.id]);
    const creatingChild = navigationEdit?.kind === 'create' && navigationEdit.parentId === item.id;
    const renaming = navigationEdit?.kind === 'rename' && navigationEdit.id === item.id;
    const current = page === 'reading' && collectionId === item.id;
    return <div className="nb-tree-branch" key={item.id}>
      {renaming ? navigationForm(depth, depth === 0 ? '重命名书籍' : '重命名章节') : <div className={`nb-tree-row ${current ? 'active' : ''} ${dragOver === item.id ? 'drop-target' : landed === item.id ? 'nb-drop-landed' : ''}`} style={{ '--chapter-depth': depth } as CSSProperties} data-drop-collection={item.id} onContextMenu={event => { event.preventDefault(); setNavigationPoint({ x: event.clientX, y: event.clientY }); setNavigationMenu(item.id); }}>
        {children.length || creatingChild ? <button className="nb-tree-disclosure" aria-label={`${expanded ? '收起' : '展开'}：${item.title}`} aria-expanded={expanded} aria-controls={`nav-children-${item.id}`} onClick={() => toggleNavigation(item.id)}><Icon name="chevron" /></button> : <span className="nb-tree-disclosure-space" />}
        <button className="nb-tree-open" data-nav-id={item.id} aria-current={current ? 'page' : undefined} title={item.title} onClick={() => go('reading', item.id)} onKeyDown={event => navigationKeys(event, item.id, children.map(child => child.id), parentId, item)}>{depth === 0 ? <Icon name="book" /> : <ChapterSymbol />}<span>{item.title}</span></button>
        <button className="nb-tree-more" aria-label={`操作：${item.title}`} title="更多操作" aria-expanded={navigationMenu === item.id} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setNavigationPoint({ x: rect.right + 6, y: rect.top }); setNavigationMenu(navigationMenu === item.id ? null : item.id); }}>···</button>
      </div>}
      <div id={`nav-children-${item.id}`} className="nb-tree-children" data-open={expanded} inert={!expanded} aria-hidden={!expanded}><div className="nb-tree-children-content">{children.map(child => renderChapterNav(child, depth + 1, item.id))}{creatingChild && navigationForm(depth + 1, '新章节名称')}</div></div>
    </div>;
  };
  const renderManualNav = () => <div className="nb-tree-branch">
    <div className={`nb-tree-row ${page === 'reading' && collectionId === 'manual' && !topicId ? 'active' : ''}`}>
      <button className="nb-tree-disclosure" aria-label={`${expandedNodes.manual ? '收起' : '展开'}：AI 应用与 Agent`} aria-expanded={Boolean(expandedNodes.manual)} aria-controls="nav-manual-chapters" onClick={() => toggleNavigation('manual')}><Icon name="chevron" /></button>
      <button className="nb-tree-open" data-nav-id="manual" title="AI 应用与 Agent" aria-current={page === 'reading' && collectionId === 'manual' && !topicId ? 'page' : undefined} onClick={() => go('reading', 'manual')} onKeyDown={event => navigationKeys(event, 'manual', manual.topics.map(item => `manual:${item.id}`))}><Icon name="book" /><span>AI 应用与 Agent</span></button><span className="nb-tree-more-space" />
    </div>
    <div className="nb-tree-children" id="nav-manual-chapters" data-open={Boolean(expandedNodes.manual)} inert={!expandedNodes.manual} aria-hidden={!expandedNodes.manual}><div className="nb-tree-children-content">{manual.topics.map(item => <div className={`nb-tree-row ${page === 'reading' && topicId === item.id ? 'active' : ''}`} style={{ '--chapter-depth': 1 } as CSSProperties} key={item.id}><span className="nb-tree-disclosure-space" /><button className="nb-tree-open" data-nav-id={`manual:${item.id}`} aria-current={page === 'reading' && topicId === item.id ? 'page' : undefined} title={item.title} onClick={() => { go('reading', 'manual'); setTopicId(item.id); }} onKeyDown={event => navigationKeys(event, `manual:${item.id}`, [], 'manual')}><ChapterSymbol /><span>{item.title}</span></button><span className="nb-tree-more-space" /></div>)}</div></div>
  </div>;

  return <div data-theme={appearance} style={{ '--assistant-width': `${assistantWidth}px` } as CSSProperties} className={`notebook nb-craft nb-native-workspace ${assistantOpen ? 'has-assistant' : ''} ${isReference && topic && !assistantOpen ? 'has-reference-navigation' : ''} ${referenceOutlineVisible ? 'has-reference-outline' : ''} ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''}`} onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}>
    {mobileNav && <button className="nb-backdrop" aria-label="关闭导航" onClick={() => setMobileNav(false)} />}
    <aside className={`nb-sidebar ${mobileNav ? 'is-open' : ''}`} ref={nav} aria-label="主导航" aria-hidden={sidebarCollapsed || undefined} inert={sidebarCollapsed}>
      <div className="nb-brand"><span className="nb-brand-mark">R</span><span>Read</span>{IS_DEMO_MODE && <span className="nb-demo-label" title="内容仅保存在当前浏览器；AI 服务在演示中关闭">演示</span>}</div>
      <nav className="nb-primary" aria-label="工作区">{([{ id: 'home', title: '开始' }, { id: 'notes', title: '随笔' }, { id: 'reading', title: '阅读站' }, { id: 'memory', title: '记忆库' }] as const).map(item => <button key={item.id} data-page={item.id} data-section-active={page === item.id || undefined} aria-current={page === item.id && (item.id === 'reading' ? !collectionId : item.id === 'notes' ? !tag : true) ? 'page' : undefined} onClick={() => go(item.id)}>
        <Icon name={item.id === 'home' ? 'organize' : item.id === 'notes' ? 'note' : item.id === 'reading' ? 'book' : 'memory'} /><span>{item.title}</span></button>)}</nav>
      <button type="button" className="nb-search nb-global-search-trigger" aria-label="搜索全部内容" onClick={() => setSearchOpen(true)}><Icon name="search" /><span>搜索</span><kbd>Ctrl ⇧ F</kbd></button>
      <div className="nb-sidebar-scroll">
        {page !== 'memory' && <nav className="nb-book-navigation" aria-label="书籍与章节"><div className="nb-sidebar-label">书籍<SmallButton icon="plus" label="新建书籍" disabled={busy} onClick={() => startNavigationCreate()} /></div>{ownBooks.map(item => renderChapterNav(item))}{!ownBooks.length && <button className="nb-sidebar-empty" disabled={busy} onClick={() => void createBlankBook()}>创建第一本书</button>}{navigationEdit?.kind === 'create' && !navigationEdit.parentId && navigationForm(0, '新书籍名称')}</nav>}
        {page === 'notes' && allTags.length > 0 && <><div className="nb-sidebar-label">标签</div><button className={`nb-sidebar-item ${!tag ? 'active' : ''}`} onClick={() => setTag('')}><span>#</span>全部随笔</button>{allTags.map(item => <button key={item} className={`nb-sidebar-item ${tag === item ? 'active' : ''}`} aria-current={tag === item ? 'page' : undefined} onClick={() => setTag(item)}><span>#</span>{item}</button>)}</>}
        <details className="nb-reference-navigation"><summary><Icon name="chevron" /><span>参考资料</span></summary>{renderManualNav()}</details>
      </div>
      <button className="nb-craft-sidebar-create" onClick={() => { setMobileNav(false); newMemo(); }}><Icon name="plus" /><span>新建随笔</span></button>
      <button type="button" className="nb-ai-settings-entry" aria-label="设置" onClick={() => openSettings()}><AssistantSettingsIcon /><span>设置</span></button>
      <button className="nb-ai-settings-entry" onClick={() => openModal({ kind: 'archive' })}><Icon name="archive" /><span>归档</span></button>
      <button className="nb-ai-settings-entry" onClick={() => openModal({ kind: 'trash' })}><Icon name="trash" /><span>回收站</span></button>
      {state.legacyDrafts.length > 0 && <button className="nb-sidebar-recovery" onClick={() => openModal({ kind: 'drafts' })}><Icon name="history" />恢复旧草稿</button>}
    </aside>

    <main className="nb-main" ref={main}>
      <header className="nb-page-header"><button className="nb-icon nb-sidebar-toggle" ref={mobileTrigger} aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'} title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'} aria-expanded={!sidebarCollapsed} onClick={() => { rememberReferencePosition(); setSidebarCollapsed(value => !value); }}><Icon name="sidebar" /></button>{page === 'reading' && collectionId && collectionId !== 'manual' ? <div className="nb-workspace-toolbar-slot" ref={setWorkspaceToolbar} /> : <div className="nb-craft-title-path"><h1>{pageTitle}</h1></div>}
        {page === 'notes' && <button className="nb-text-button" onClick={() => { setArchived(!archived); setTag(''); setQuery(''); }}>{archived ? '返回随笔' : '归档'}</button>}
        {page === 'reading' && collectionId === 'manual' && !topic && <div className="nb-craft-view-controls"><div><button aria-label="网格视图" title="网格视图" aria-pressed={libraryView === 'grid'} onClick={() => setLibraryView('grid')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg></button><button aria-label="列表视图" title="列表视图" aria-pressed={libraryView === 'list'} onClick={() => setLibraryView('list')}><Icon name="list" /></button></div><button aria-label={sortByTitle ? '恢复原文顺序' : '按名称排序'} title={sortByTitle ? '恢复原文顺序' : '按名称排序'} aria-pressed={sortByTitle} onClick={() => setSortByTitle(value => !value)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M8 4v16m-4-4 4 4 4-4M16 20V4m-4 4 4-4 4 4" /></svg></button><SmallButton icon="search" label="搜索全部内容" onClick={() => setSearchOpen(true)} /></div>}
        {canUseComponents && <button type="button" className="nb-icon nb-components-trigger" aria-label="组件库" title="组件库 · Ctrl + Alt + M" aria-pressed={componentLibrary.open} onClick={() => componentLibrary.toggle()}><Icon name="organize" /></button>}
        {isReference && topicHasAnswers && <div className="nb-answer-mode" role="group" aria-label="答案显示方式"><button type="button" aria-pressed={answerMode === 'read'} title="连续阅读，显示全部答案" onClick={() => { if (answerMode !== 'read') { rememberReferencePosition(true); setAnswerMode('read'); } }}>阅读</button><button type="button" aria-pressed={answerMode === 'recall'} title="先回忆，再按节查看答案" onClick={() => { if (answerMode !== 'recall') { rememberReferencePosition(true); setAnswerMode('recall'); } }}>回忆</button></div>}
        {isReference && topic && <button type="button" className="nb-icon nb-reference-trigger" ref={referenceOutlineTrigger} aria-label={referenceOutlineVisible ? '收起目录' : '展开目录'} title={referenceOutlineVisible ? '收起目录' : '展开目录'} aria-controls="reference-outline" aria-expanded={referenceOutlineVisible} onClick={() => { if (assistantOpen) rememberReferencePosition(); setReferenceOutlineOpen(!referenceOutlineVisible); if (!referenceOutlineVisible) setAssistantOpen(false); }}><Icon name="list" /></button>}
        <button className="nb-icon nb-assistant-trigger" ref={assistantTrigger} aria-label="智能助手" title="智能助手" aria-controls="notebook-assistant" aria-expanded={assistantOpen} onClick={() => { rememberReferencePosition(); setAssistantOpen(value => !value); }}><Icon name="optimize" /></button>
        <button type="button" className="nb-icon nb-theme-toggle" aria-label="暗色模式" aria-pressed={appearance === 'dark'} title={appearance === 'dark' ? '切换为浅色' : '切换为暗色'} onPointerDown={event => event.preventDefault()} onClick={() => setAppearance(current => current === 'dark' ? 'light' : 'dark')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{appearance === 'dark' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></> : <path d="M20.3 15.3A8.5 8.5 0 0 1 8.7 3.7a8.5 8.5 0 1 0 11.6 11.6Z" />}</svg>
        </button>
      </header>
      {canUseComponents && modal?.kind !== 'compose' && <FloatingComponentLibrary />}
      {canUseComponents && <div className="nb-components-safe-area" aria-hidden="true" style={{ height: componentLibrary.open && modal?.kind !== 'compose' ? componentLibrary.showSyntax ? 80 : componentLibrary.compact ? 60 : 64 : 0 }} />}

      {page === 'home' && <div className="nb-start-writing">
        <header className="nb-start-heading"><h2>从一个想法开始</h2><div className="nb-start-actions"><button type="button" className="nb-start-create-book" disabled={busy} onClick={() => void createBlankBook()}><span className="nb-start-action-symbol"><Icon name="book" /></span><span>空白书籍</span><Icon name="plus" /></button><button type="button" className="nb-start-create-note" onClick={newMemo}><span className="nb-start-action-symbol"><Icon name="note" /></span><span>新随笔</span><Icon name="plus" /></button></div></header>
        {state.draft.markdown.trim() && <button className="nb-start-draft" onClick={() => openModal({ kind: 'compose' })}><Icon name="note" /><span><strong>继续草稿</strong><span>{noteTitle(state.draft.markdown)}</span></span><Icon name="chevron" /></button>}
        {(activeNotes.length > 0 || query) && <section className="nb-start-section"><header><h3>最近修改</h3><button onClick={() => go('notes')}>全部随笔<Icon name="chevron" /></button></header><div className="nb-start-list">{recentNotes.map(note => {
          const owner = ownerOf(note);
          return <button className="nb-start-recent" key={note.id} onClick={() => { if (owner) { void motionChange(() => { go('reading', owner.id); requestAnimationFrame(() => main.current?.querySelector(`[data-cw-key="note:${CSS.escape(note.id)}"]`)?.scrollIntoView({ block: 'center' })); }); } else openModal({ kind: 'detail', ref: { kind: 'note', id: note.id } }); }}><span className="nb-start-file-icon"><ChapterSymbol /></span><span className="nb-start-recent-name"><strong>{noteTitle(note.markdown || note.source?.quote || '')}</strong><small>{owner ? collectionPath(owner.id, state).map(item => item.title).join(' / ') : '随笔'}</small></span><time dateTime={new Date(note.updatedAt).toISOString()} title={`修改于 ${new Date(note.updatedAt).toLocaleString('zh-CN')}`}>{modifiedLabel(note.updatedAt)}</time><Icon name="chevron" /></button>;
        })}{!recentNotes.length && <p className="nb-start-no-results">没有匹配的随笔</p>}</div></section>}
        {ownBooks.length > 0 && <section className="nb-start-section"><header><h3>我的书籍</h3><button onClick={() => go('reading')}>阅读站<Icon name="chevron" /></button></header><div className="nb-start-books">{matchingBooks.slice(0, 6).map(book => <button key={book.id} onClick={() => go('reading', book.id)}><span className="nb-start-book-spine"><Icon name="book" /></span><span><strong>{book.title}</strong><small>{book.items.filter(ref => ref.kind === 'chapter' && !store.isCollectionDeleted(ref.id, state)).map(ref => state.collections.find(item => item.id === ref.id)?.title).filter(Boolean).slice(0, 3).join(' · ') || (book.items.length ? '打开正文' : '空白书籍')}</small></span><Icon name="chevron" /></button>)}{!matchingBooks.length && <p className="nb-start-no-results">没有匹配的书籍</p>}</div></section>}
        {!activeNotes.length && !ownBooks.length && !query && <div className="nb-start-empty"><span /><p>这里还没有内容</p><span /></div>}
      </div>}

      {page === 'notes' && <div className="nb-feed">
        {!archived && !state.draft.editingId && modal?.kind !== 'compose' && state.draft.source && sourceCitation(state.draft.source)}
        {!archived && !state.draft.editingId && modal?.kind !== 'compose' && <MemoComposer allowEmpty={Boolean(state.draft.source)} tags={allTags} value={state.draft.markdown} onChange={markdown => business.draft({ ...state.draft, markdown })} onSave={save} disabled={busy} />}
        {!archived && modal?.kind !== 'compose' && state.draft.editingId && !notes.some(note => note.id === state.draft.editingId) && <MemoComposer allowEmpty={Boolean(state.draft.source)} tags={allTags} value={state.draft.markdown} onChange={markdown => business.draft({ ...state.draft, markdown })} onSave={save} onCancel={() => business.draft({ markdown: '' })} editing disabled={busy} />}
        {notes.map(renderNote)}
        {!notes.length && <div className="nb-empty"><Icon name={archived ? 'history' : 'note'} /><p>{query || tag ? '没有匹配的随笔' : archived ? '没有归档的随笔' : '想法，从这里留下。'}</p></div>}
      </div>}

      {page === 'reading' && collectionId !== 'manual' && <ChapterWorkspace key={collectionId ?? 'home'} state={state} chapterId={collectionId} query={query} busy={busy} run={business.run} commitContent={business.commitContent} commitSummary={business.commitSummary} toolbarTarget={workspaceToolbar} onNavigate={id => go('reading', id)} onAddExisting={id => openModal({ kind: 'add', collection: id })} onQuoteMemo={quoteMemo} onDeleteCollection={id => void deleteCollection(id)} renderMemory={() => null} />}

      {page === 'reading' && collectionId === 'manual' && <div key={topicId ?? 'index'} className={`nb-reader ${topic ? '' : 'nb-craft-manual-index'}`}>
        {topic && <div className="nb-reading-heading"><h2>{topic.title}</h2><p>{topic.sectionIds.length} 节</p></div>}
        {!topic && <div className={`nb-craft-library-grid ${libraryView === 'list' ? 'is-list' : ''}`}>{visibleTopics.map(item => {
          const index = manual.topics.indexOf(item);
          const previewSections = item.sectionIds.slice(0, 2).map(id => sectionMap.get(id)).filter(Boolean);
          const primaryText = previewSections[0]?.parts.filter(part => part.role === 'prompt' || part.role === 'body').map(part => part.markdown).join('\n') ?? '';
          const codePreview = primaryText.match(/```[^\n]*\n([\s\S]*?)```/);
          const cleanPreview = (text: string) => text.replace(/```[\s\S]*?```/g, '').replace(/!\[[^\]]*\]\([^)]+\)/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[#*`>]/g, '').trim();
          return <button className="nb-craft-topic" aria-label={`${item.title} ${item.sectionIds.length} 节`} style={{ '--folder-color': folderColors[index % folderColors.length] } as CSSProperties} key={item.id} onClick={() => { setTopicId(item.id); setQuery(''); }}>
            <span className={`nb-native-preview ${codePreview ? 'has-code' : ''}`} aria-hidden="true">
              <span className="nb-native-preview-content">
                <b>{shortTitle(previewSections[0]?.title ?? item.title)}</b>
                <span className="nb-native-preview-prose">{cleanPreview(codePreview ? primaryText.split('```')[0] : primaryText).slice(0, 230)}</span>
                {codePreview ? <span className="nb-native-preview-code">{codePreview[1].trim().split('\n').slice(0, 7).join('\n')}</span> : previewSections[1] && <><b>{shortTitle(previewSections[1].title)}</b><span className="nb-native-preview-prose">{cleanPreview(previewSections[1].parts.filter(part => part.role === 'prompt' || part.role === 'body').map(part => part.markdown).join('\n')).slice(0, 130)}</span></>}
              </span>
            </span>
            <span className="nb-native-caption"><span className="nb-craft-tile-icon"><Icon name={topicIcons[index] ?? 'book'} /></span><strong>{item.title}</strong><small>{item.sectionIds.length} 节</small></span>
            <span className="nb-native-list-excerpt" aria-hidden="true">{previewSections.map(section => shortTitle(section!.title)).join(' · ')}</span>
          </button>;
        })}{!visibleTopics.length && <p className="nb-empty">没有匹配的章节</p>}</div>}
        {topic && <>{visibleSectionIds.map(id => { const ref: store.Ref = { kind: 'section', id }; return <article className={`nb-source ${dragCard?.refs.some(item => refKey(item) === refKey(ref)) ? 'nb-drag-source' : ''}`} id={`source-${id}`} data-reading-key={answerMode === 'read' ? refKey(ref) : undefined} key={id}><header><span className="nb-source-index nb-drag-handle" title="拖入阅读合集" onPointerDown={event => startDrag(event, [ref])}>{String(topic.sectionIds.indexOf(id) + 1).padStart(2, '0')}</span><h3>{titleFor(ref, state)}</h3><SmallButton icon="book" label={`加入阅读站：${titleFor(ref, state)}`} onClick={() => openModal({ kind: 'file', ref })} /></header><SourceBody id={id} recall={answerMode === 'recall'} /></article>; })}</>}
      </div>}

      {page === 'memory' && <MemoryLibrary items={memory.map(({ ref, projection }) => ({ ref, projection, entry: projection.entry!, title: titleFor(ref, state), scoringContext: memoryScoringContext(ref, state), excerpt: memoryExcerptFor(ref, state), markdown: bodyFor(ref, state), contentHash: store.readingReference(ref, state).contentHash,
        source: ref.kind === 'section' ? manual.title : state.notes.find(note => note.id === ref.id)?.kind === 'document' ? '书籍正文' : state.notes.find(note => note.id === ref.id)?.archivedAt ? '已归档随笔' : '随笔' }))}
        now={now} query={query} settings={state.settings} onSaveSettings={async settings => { await store.setReadingSettings(settings); }} busy={busy} configVersion={assistantConfigVersion}
        onOpen={ref => openModal({ kind: 'detail', ref })} onRead={record}
        onUndo={async (ref, eventId) => { await store.undoRef(ref, eventId); }}
        onPriority={async (ref, value) => { await store.setRefPriority(ref, value); }}
        onAIResults={async results => { await store.applyAiPriorities(results); }}
        onSettings={() => openSettings('ai')} />}
    </main>
    {isReference && !assistantOpen && <ReferenceOutline open={referenceOutlineVisible} topicId={topicId} sectionIds={visibleSectionIds} scrollRoot={main} onOpen={() => setReferenceOutlineOpen(true)} onClose={() => { setReferenceOutlineOpen(false); requestAnimationFrame(() => referenceOutlineTrigger.current?.focus({ preventScroll: true })); }} />}
    <AssistantPanel contextSelection={assistantSelection} onWidthChange={setAssistantWidth} open={assistantOpen} contextTitle={pageTitle} contextKey={`${page}:${collectionId}:${topicId}`} contextText={assistantContext} contentRoot={main} configVersion={assistantConfigVersion} onSettings={() => openSettings('ai')} onClose={() => { rememberReferencePosition(); setAssistantOpen(false); requestAnimationFrame(() => assistantTrigger.current?.focus({ preventScroll: true })); }} />
    {searchOpen && <GlobalSearch state={state} onSelect={openSearchResult} onClose={() => setSearchOpen(false)} />}
    {assistantSettingsOpen && <SettingsPanel initialCategory={settingsCategory} appearance={appearance} onAppearanceChange={setAppearance} onClose={() => setAssistantSettingsOpen(false)} onSaved={() => setAssistantConfigVersion(value => value + 1)} />}

    {navigationMenu && state.collections.some(item => item.id === navigationMenu) && <ContextMenu x={navigationPoint.x} y={navigationPoint.y} label="书籍与章节操作" onClose={() => setNavigationMenu(null)} items={[
      { label: collectionPath(navigationMenu, state).length > 1 ? '新建子章节' : '新建章节', icon: 'plus', disabled: busy, onSelect: () => startNavigationCreate(navigationMenu) },
      { label: '重命名', icon: 'note', disabled: busy, onSelect: () => setNavigationEdit({ kind: 'rename', id: navigationMenu, value: state.collections.find(item => item.id === navigationMenu)!.title }) },
      { label: '归档', icon: 'archive', disabled: busy, onSelect: () => { void business.run(() => store.archiveCollection(navigationMenu)).then(result => { if (result) { if (collectionId && collectionPath(collectionId, state).some(item => item.id === result.id)) go('reading'); setNotice('已归档'); } }); } },
      { label: '删除', icon: 'trash', danger: true, separatorBefore: true, disabled: busy, onSelect: () => void deleteCollection(navigationMenu) },
    ]} />}
    {modal && <Dialog className={modal.kind === 'compose' ? 'nb-compose-dialog' : ''} headerActions={modal.kind === 'compose' ? <button type="button" className="nb-icon nb-dialog-components-toggle" aria-label="随笔组件库" title="组件库 · Ctrl + Alt + M" aria-pressed={componentLibrary.open} onClick={() => componentLibrary.toggle()}><Icon name="organize" /></button> : undefined} title={modal.kind === 'compose' ? state.draft.editingId ? '编辑随笔' : '新随笔' : modal.kind === 'transfer' ? '移动到' : modal.kind === 'create' ? '新建书籍' : modal.kind === 'rename' ? modal.ref ? '重命名阅读标题' : '重命名合集' : modal.kind === 'file' ? '加入阅读站' : modal.kind === 'add' ? '添加内容' : modal.kind === 'drafts' ? '原手册草稿' : modal.kind === 'trash' ? '回收站' : modal.kind === 'archive' ? '归档' : titleFor(modal.ref, state)} close={closeModal}>
      {business.error && <p className="np-error" role="alert">{business.error}</p>}
      {(modal.kind === 'create' || modal.kind === 'rename') && <form className="nb-name-form" onSubmit={async event => { event.preventDefault(); const result = await business.run(() => modal.kind === 'create' ? store.createCollection(dialogName) : modal.ref ? store.renameItem(modal.collection, modal.ref, dialogName) : store.renameCollection(modal.collection, dialogName)); if (result) { setModal(null); if (modal.kind === 'create') go('reading', result.id); } }}><label>{modal.kind === 'rename' && modal.ref ? '阅读标题' : '书名'}<input autoFocus value={dialogName} maxLength={120} onChange={event => setDialogName(event.target.value)} /></label>{modal.kind === 'rename' && modal.ref && <small>仅更改在此合集中的显示名称。</small>}<button className="nb-save" disabled={!dialogName.trim() || busy}>保存</button></form>}
      {modal.kind === 'compose' && <div className="nb-compose-layout"><FloatingComponentLibrary /><div className="nb-compose-toolbar-space" aria-hidden="true" /><div className="nb-global-composer">{state.draft.source && <>{sourceCitation(state.draft.source)}<button className="nb-text-button nb-discard-quote" onClick={() => { business.draft({ markdown: '' }); setModal(null); }}>取消这篇随笔</button></>}<MemoComposer allowEmpty={Boolean(state.draft.source)} tags={allTags} value={state.draft.markdown} onChange={markdown => business.draft({ ...state.draft, markdown })} onSave={async markdown => { const ok = await save(markdown); if (ok) { setModal(null); setNotice('已保存随笔'); } return ok; }} editing={Boolean(state.draft.editingId)} disabled={busy} autoFocus /></div></div>}
      {(modal.kind === 'file' || modal.kind === 'transfer') && <DestinationPicker state={state} refs={modal.kind === 'file' ? [modal.ref] : modal.refs} from={modal.kind === 'transfer' ? modal.from : undefined} mode={modal.kind === 'transfer' ? modal.mode : 'copy'} busy={busy} onClose={() => setModal(null)} onCreate={async title => (await business.run(() => store.createCollection(title))) || undefined} onConfirm={async to => {
        const ok = await business.run<store.Collection | store.Collection[]>(() => modal.kind === 'file' ? store.copyIntoCollection({ to, refs: [modal.ref] }) : store.transferItems({ to, refs: modal.refs, from: modal.from, mode: modal.mode }));
        if (ok) { setModal(null); setLanded(to); setNotice(`已${modal.kind === 'transfer' ? '移到' : '加入'} ${state.collections.find(item => item.id === to)?.title ?? '合集'}`); } return Boolean(ok);
      }} />}
      {modal.kind === 'add' && <ContentPicker state={state} collection={modal.collection} busy={busy} onClose={() => setModal(null)} onConfirm={async refs => { const ok = await business.run(() => store.copyIntoCollection({ to: modal.collection, refs })); if (ok) { setModal(null); setLanded(modal.collection); setNotice(`已添加 ${refs.length} 项`); } return Boolean(ok); }} />}
      {modal.kind === 'detail' && <div className="nb-detail" data-reading-key={refKey(modal.ref)}>{modal.ref.kind === 'note' ? <>{state.notes.find(note => note.id === modal.ref.id)?.source && sourceCitation(state.notes.find(note => note.id === modal.ref.id)!.source!)}<Markdown body={bodyFor(modal.ref, state)} /></> : <SourceBody id={modal.ref.id} />}<footer><SmallButton icon="book" label="加入阅读站" onClick={() => openModal({ kind: 'file', ref: modal.ref })} />{modal.ref.kind === 'note' && state.notes.find(note => note.id === modal.ref.id)?.kind !== 'document' && !state.notes.find(note => note.id === modal.ref.id)?.archivedAt && <SmallButton icon="note" label="编辑随笔" onClick={() => edit(state.notes.find(note => note.id === modal.ref.id)!)} />}</footer></div>}
      {modal.kind === 'trash' && <TrashPanel state={state} busy={busy}
        onRestoreCollection={id => { void business.run(() => store.restoreDeletedCollection(id)).then(result => { if (result) setNotice('已恢复'); }); }}
        onRestoreContent={id => { void business.run(() => store.restoreDeletedContent(id)).then(result => { if (result) setNotice('已恢复'); }); }} />}
      {modal.kind === 'archive' && <ArchivePanel state={state} busy={busy}
        onOpenMemo={id => openModal({ kind: 'detail', ref: { kind: 'note', id } })}
        onOpenCollection={id => { setModal(null); go('reading', id); }}
        onRestoreMemo={id => { void business.run(() => store.restoreNote(id)).then(result => { if (result) setNotice('已恢复'); }); }}
        onRestoreCollection={id => { void business.run(() => store.restoreCollection(id)).then(result => { if (result) setNotice('已恢复'); }); }} />}
      {modal.kind === 'drafts' && <div className="nb-picker">{state.legacyDrafts.map(draft => <button key={draft.sectionId} disabled={busy} onClick={() => { if (state.draft.markdown.trim() || state.draft.editingId) { setNotice('请先保存当前草稿'); return; } business.draft({ markdown: draft.markdown, editingId: state.notes.some(note => note.id === draft.editingId && !note.archivedAt) ? draft.editingId : undefined }); setModal(null); setArchived(false); go('notes'); }}><Icon name="note" /><span>{shortTitle(sectionMap.get(draft.sectionId)?.title ?? '草稿')}</span><small>恢复编辑</small></button>)}</div>}
    </Dialog>}
    {dragging && dragCard && <div className={`nb-drag-card ${dragCard.refs.length > 1 ? 'is-stack' : ''}`} ref={dragOverlay} aria-hidden="true"><div className="nb-drag-card-face"><div className="nb-drag-card-title"><Icon name={dragCard.refs[0].kind === 'note' ? 'note' : 'book'} /><strong>{dragCard.title}</strong>{dragCard.refs.length > 1 && <b>{dragCard.refs.length}</b>}</div><p>{dragCard.excerpt}</p><div className="nb-drag-caption" ref={dragCaption}>拖到阅读合集</div></div></div>}
    {(business.error || notice) && <div className={`nb-toast ${business.error ? 'error' : ''}`} role={business.error ? 'alert' : 'status'}>{business.error || notice}<button aria-label="关闭提示" onClick={() => { business.dismissError(); setNotice(''); }}>×</button></div>}
  </div>;
}
