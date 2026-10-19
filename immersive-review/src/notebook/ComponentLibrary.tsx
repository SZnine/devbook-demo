import { t } from '../i18n';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Context as ReactContext, type ReactNode } from 'react';
import { MarkdownInsertMenu, type MarkdownComponentRequest, type MarkdownInsertion } from './MarkdownInsertMenu';
import { motionChange } from './motion';
import { peekDeletionUndo, subscribeDeletionUndo } from './store';
import './component-library.css';

export type ComponentTarget = {
  id: string;
  capture: () => string;
  insert: (item: MarkdownInsertion) => void;
  focus: () => void;
  undo?: () => void;
  redo?: () => void;
  element: () => HTMLElement | null;
};

type Library = {
  open: boolean;
  available: boolean;
  undoAvailable: boolean;
  selectedText: string;
  targetId: string;
  focusRequest: number;
  componentRequest: MarkdownComponentRequest | null;
  compact: boolean;
  showSyntax: boolean;
  register: (target: ComponentTarget) => () => void;
  activate: (target: ComponentTarget) => void;
  capture: () => void;
  insert: (item: MarkdownInsertion) => void;
  undo: () => void;
  show: (focusSearch?: boolean) => void;
  showComponent: (kind: 'link' | 'image') => void;
  hide: () => void;
  toggle: () => void;
  setCompact: (value: boolean) => void;
  setShowSyntax: (value: boolean) => void;
};
// Keep providers and editor consumers on the same context during Vite refresh.
const Context: ReactContext<Library | null> = import.meta.hot?.data.componentLibraryContext ?? createContext<Library | null>(null);
if (import.meta.hot) import.meta.hot.data.componentLibraryContext = Context;
const preference = (key: string, fallback: boolean) => {
  try { const saved = localStorage.getItem(key); return saved === null ? fallback : saved === 'true'; } catch { return fallback; }
};
const canUse = (target: ComponentTarget | null) => {
  const element = target?.element?.();
  const dialog = document.querySelector('dialog[open]');
  return Boolean(element?.isConnected && !element.closest('[inert]') && (!dialog || dialog.contains(element)));
};

export function ComponentLibraryProvider({ children }: { children: ReactNode }) {
  const [hasDeletionUndo, setHasDeletionUndo] = useState(() => Boolean(peekDeletionUndo()));
  useEffect(() => subscribeDeletionUndo(() => setHasDeletionUndo(Boolean(peekDeletionUndo()))), []);
  const [open, setOpen] = useState(() => preference('read-components-open', true));
  const [compact, setCompact] = useState(() => preference('read-components-compact', false));
  const [showSyntax, setShowSyntax] = useState(() => preference('read-components-syntax', false));
  const [targetId, setTargetId] = useState('');
  const [selectedText, setSelectedText] = useState('');
  const [focusRequest, setFocusRequest] = useState(0);
  const [componentRequest, setComponentRequest] = useState<MarkdownComponentRequest | null>(null);
  const requestSequence = useRef(0);
  const targets = useRef(new Map<string, ComponentTarget>());
  const active = useRef<ComponentTarget | null>(null);

  const activate = useCallback((target: ComponentTarget) => {
    active.current = target;
    setTargetId(target.id);
    setSelectedText(target.capture());
  }, []);
  const register = useCallback((target: ComponentTarget) => {
    targets.current.set(target.id, target);
    if (!active.current) activate(target);
    return () => {
      targets.current.delete(target.id);
      if (active.current?.id !== target.id) return;
      const next = [...targets.current.values()].at(-1);
      active.current = next ?? null;
      setTargetId(next?.id ?? '');
      setSelectedText('');
    };
  }, [activate]);
  const capture = useCallback(() => {
    // Each editor protects its bookmark when focus is in a parameter input.
    // Also capture on keyboard focus so component text matches that bookmark.
    if (canUse(active.current)) setSelectedText(active.current!.capture());
  }, []);
  const insert = useCallback((item: MarkdownInsertion) => {
    const target = active.current;
    if (!target || !targets.current.has(target.id) || !canUse(target)) return;
    target.insert(item);
    setSelectedText('');
  }, []);
  const show = useCallback((focusSearch = false) => {
    void motionChange(() => {
      setOpen(true);
      setComponentRequest(null);
      setFocusRequest(focusSearch ? Date.now() : 0);
    }, 'popover');
  }, []);
  const showComponent = useCallback((kind: 'link' | 'image') => {
    const target = active.current;
    if (!target || !targets.current.has(target.id) || !canUse(target)) return;
    const selection = target.capture();
    const request = { kind, id: ++requestSequence.current };
    void motionChange(() => {
      if (active.current?.id !== target.id || !canUse(target)) return;
      setSelectedText(selection);
      setOpen(true);
      setFocusRequest(0);
      setComponentRequest(request);
    }, 'popover');
  }, []);
  const undo = useCallback(() => {
    if (!window.dispatchEvent(new Event('read:undo', { cancelable: true }))) return;
    const target = active.current;
    if (!target || !targets.current.has(target.id) || !canUse(target)) return;
    target.undo?.();
    setSelectedText('');
  }, []);
  const hide = useCallback(() => {
    const returnToEditor = Boolean(document.activeElement?.closest('.component-library'));
    const target = active.current;
    void motionChange(() => {
      setOpen(false);
      setFocusRequest(0);
      setComponentRequest(null);
      if (returnToEditor && canUse(target)) target?.focus();
    }, 'popover');
  }, []);
  const toggle = useCallback(() => {
    const returnToEditor = Boolean(document.activeElement?.closest('.component-library'));
    const target = active.current;
    void motionChange(() => {
      setOpen(value => !value);
      setFocusRequest(0);
      setComponentRequest(null);
      if (returnToEditor && canUse(target)) target?.focus();
    }, 'popover');
  }, []);
  const changeCompact = useCallback((value: boolean) => { void motionChange(() => setCompact(value), 'popover'); }, []);
  const changeShowSyntax = useCallback((value: boolean) => { void motionChange(() => setShowSyntax(value), 'popover'); }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) return;
      if (event.ctrlKey && event.altKey && !event.shiftKey && event.code === 'KeyM') {
        event.preventDefault(); event.stopPropagation(); toggle();
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, [toggle]);
  useEffect(() => {
    try {
      localStorage.setItem('read-components-open', String(open));
      localStorage.setItem('read-components-compact', String(compact));
      localStorage.setItem('read-components-syntax', String(showSyntax));
    } catch { /* Editing remains available if browser storage is full. */ }
  }, [open, compact, showSyntax]);
  const value = useMemo(() => ({ open, available: Boolean(targetId) && canUse(active.current), undoAvailable: hasDeletionUndo || Boolean(targetId) && canUse(active.current), selectedText, targetId, focusRequest, componentRequest, compact, showSyntax, register, activate, capture, insert, undo, show, showComponent, hide, toggle, setCompact: changeCompact, setShowSyntax: changeShowSyntax }), [open, hasDeletionUndo, targetId, selectedText, focusRequest, componentRequest, compact, showSyntax, register, activate, capture, insert, undo, show, showComponent, hide, toggle, changeCompact, changeShowSyntax]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useComponentLibrary() {
  const library = useContext(Context);
  if (!library) throw new Error('ComponentLibraryProvider is required');
  return library;
}

export function FloatingComponentLibrary() {
  const library = useComponentLibrary();
  const [settings, setSettings] = useState(false);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const closeSettings = () => {
    void motionChange(() => { setSettings(false); settingsTrigger.current?.focus({ preventScroll: true }); }, 'popover');
  };
  useEffect(() => { setSettings(false); }, [library.focusRequest, library.componentRequest]);
  if (!library.open) return null;
  return <div className="component-floating-anchor"><section className={`component-library floating-component-library${library.compact ? ' is-compact' : ''}${library.showSyntax ? ' shows-syntax' : ''}`} aria-label={t("Markdown 组件", "Markdown blocks")} onPointerDownCapture={library.capture} onFocusCapture={library.capture} onKeyDown={event => {
    if (event.key === 'Escape' && settings) { event.preventDefault(); event.stopPropagation(); closeSettings(); }
  }}>
    <MarkdownInsertMenu variant="floating" selectedText={library.selectedText} targetId={library.targetId} focusRequest={library.focusRequest} componentRequest={library.componentRequest} disabled={!library.available} onInsert={library.insert} onClose={library.hide} />
    <button type="button" className="cl-icon cl-undo" title={t("撤销 · Ctrl+Z", "Undo · Ctrl+Z")} aria-label={t("撤销", "Undo")} disabled={!library.undoAvailable} onPointerDown={event => event.preventDefault()} onClick={library.undo}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 5 3 10l5 5M3 10h11a6 6 0 0 1 0 12" transform="translate(0 -2)" /></svg></button>
    <div className="cl-island-controls"><button type="button" ref={settingsTrigger} className="cl-icon" title={t("组件显示设置", "Block settings")} aria-label={t("组件显示设置", "Block settings")} aria-expanded={settings} onClick={() => { void motionChange(() => setSettings(value => !value), 'popover'); }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="2.5" /><circle cx="16" cy="17" r="2.5" /></svg></button><button type="button" className="cl-icon" title={t("收起组件 · Ctrl+Alt+M", "Hide blocks · Ctrl+Alt+M")} aria-label={t("收起组件", "Hide blocks")} aria-keyshortcuts="Control+Alt+M" onClick={library.hide}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m7 14 5-5 5 5" /></svg></button></div>
    {settings && <div className="cl-settings"><div className="cl-settings-heading"><span>{t("显示设置", "Appearance")}</span><button type="button" onClick={closeSettings} aria-label={t("关闭显示设置", "Close appearance settings")}>{t("完成", "Done")}</button></div><label><span>{t("紧凑图标", "Compact icons")}</span><input type="checkbox" checked={library.compact} onChange={event => library.setCompact(event.target.checked)} /></label><label><span>{t("显示组件名称", "Show block names")}</span><input type="checkbox" checked={library.showSyntax} onChange={event => library.setShowSyntax(event.target.checked)} /></label><div className="cl-shortcut"><span>{t("展开 / 收起", "Show / hide")}</span><kbd>Ctrl Alt M</kbd></div><details className="cl-keyboard-help"><summary>{t("编辑快捷键", "Keyboard shortcuts")}</summary><div>{[
      [t("加粗 / 斜体", "Bold / italic"), 'Ctrl B / I'], [t("行内代码", "Inline code"), 'Ctrl E'], [t("删除线", "Strikethrough"), 'Ctrl Shift S'], [t("链接", "Link"), 'Ctrl K'],
      [t("正文 / H1 / H2 / H3", "Text / H1 / H2 / H3"), 'Ctrl Shift 0 / 1 / 2 / 3'], [t("待办 / 无序 / 有序", "Tasks / bullets / numbers"), 'Ctrl Shift 4 / 5 / 6'],
      [t("代码 / 引用", "Code / quote"), 'Ctrl Shift 8 / 9'], [t("减少列表层级", "Outdent list"), 'Shift Tab'], [t("撤销 / 重做", "Undo / redo"), 'Ctrl Z / Y'],
      [t("离开当前结构", "Continue below block"), 'Ctrl Enter'], [t("保存", "Save"), 'Ctrl Shift Enter'],
    ].map(([label, shortcut]) => <div className="cl-keyboard-row" key={label}><span>{label}</span><kbd>{shortcut}</kbd></div>)}<p>{t("Ctrl Enter 在代码、列表、引用和表格中继续正文；普通正文中保存。Mac 使用 ⌘ 替代 Ctrl。", "Ctrl+Enter continues below a block or saves plain text. On Mac, use ⌘.")}</p></div></details></div>}
  </section></div>;
}
