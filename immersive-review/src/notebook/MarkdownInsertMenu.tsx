import { t } from '../i18n';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motionChange } from './motion';
import './markdown-insert-menu.css';

export type MarkdownInsertKind = 'text' | 'heading' | 'bullet' | 'numbered' | 'todo' | 'quote' | 'code' | 'table' | 'divider' | 'link' | 'image';
export type DirectMarkdownInsertKind = Exclude<MarkdownInsertKind, 'link' | 'image'>;
export type MarkdownComponentRequest = { kind: 'link' | 'image'; id: number };
export type MarkdownInsertion = { kind: MarkdownInsertKind; markdown: string; selectionStart: number; selectionEnd: number; block: boolean; direct?: boolean; level?: 1 | 2 | 3; language?: string };
export type MarkdownInsertMenuProps = {
  onInsert: (item: MarkdownInsertion) => void;
  onClose: () => void;
  selectedText?: string;
  initialQuery?: string;
  onLiteral?: (text: string) => void;
  onQueryChange?: (text: string) => void;
  className?: string;
  style?: CSSProperties;
  variant?: 'popup' | 'sidebar' | 'floating';
  targetId?: string;
  focusRequest?: number;
  componentRequest?: MarkdownComponentRequest | null;
  disabled?: boolean;
};

export const markdownShortcutLabels: Partial<Record<MarkdownInsertKind, string>> = {
  text: 'Ctrl+Shift+0', heading: 'Ctrl+Shift+2', todo: 'Ctrl+Shift+4',
  bullet: 'Ctrl+Shift+5', numbered: 'Ctrl+Shift+6', code: 'Ctrl+Shift+8',
  quote: 'Ctrl+Shift+9', link: 'Ctrl+K',
};
const ariaShortcut = (kind: MarkdownInsertKind) => markdownShortcutLabels[kind]?.replace('Ctrl', 'Control');
const shortcutTitle = (item: { kind: MarkdownInsertKind; label: string }) => `${item.label}${markdownShortcutLabels[item.kind] ? ` · ${markdownShortcutLabels[item.kind]}` : ''}`;

const getItems = (): { kind: MarkdownInsertKind; label: string; keys: string; sample: string; detail?: boolean }[] => [
  { kind: 'text', label: t("正文", "Content"), keys: 'text paragraph normal wenben zhengwen', sample: 'Aa' },
  { kind: 'heading', label: t("标题", "Heading"), keys: 'heading title h1 h2 h3 biaoti', sample: 'H2' },
  { kind: 'bullet', label: t("无序列表", "Bulleted list"), keys: 'bullet unordered list w uxuliebiao', sample: t("•  列表项", "•  List item") },
  { kind: 'numbered', label: t("有序列表", "Numbered list"), keys: 'numbered ordered list youxuliebiao', sample: t("1.  列表项", "1.  List item") },
  { kind: 'todo', label: t("待办事项", "Task list"), keys: 'todo task check checkbox daiban', sample: t("待办", "Task"), },
  { kind: 'quote', label: t("引用", "Quote"), keys: 'quote blockquote yinyong', sample: t("引用文字", "Quote") },
  { kind: 'code', label: t("代码", "Code"), keys: 'code fence python javascript typescript daima', sample: '</>' },
  { kind: 'table', label: t("表格", "Table"), keys: 'table grid biaoge', sample: '2 × 2' },
  { kind: 'divider', label: t("分隔线", "Divider"), keys: 'divider separator hr fengexian', sample: '────' },
  { kind: 'link', label: t("链接", "Link"), keys: 'link url href lianjie', sample: 'https://', detail: true },
  { kind: 'image', label: t("图片", "Image"), keys: 'image photo picture tupian', sample: t("图片地址", "Image URL"), detail: true },
];

export function MarkdownInsertIcon({ kind }: { kind: MarkdownInsertKind }) {
  const art: Record<MarkdownInsertKind, ReactNode> = {
    text: <><path d="M5 5h14M12 5v15M8 20h8" /><path d="M5 5v3M19 5v3" /></>,
    heading: <><path d="M5 5v14M15 5v14M5 12h10" /><path d="M19 14h2v6M18 20h4" strokeWidth="1.4" /></>,
    bullet: <><circle cx="5" cy="6" r="1.3" fill="currentColor" stroke="none" /><circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="5" cy="18" r="1.3" fill="currentColor" stroke="none" /><path d="M10 6h10M10 12h10M10 18h7" /></>,
    numbered: <><path d="M3 4h1v5M3 9h2M3 14c3-2 4 1 1 3l-1 2h3M10 6h10M10 16h10" /></>,
    todo: <><rect x="4" y="4" width="16" height="16" rx="3" fill="#e7f4ee" /><path d="m8 12 3 3 5-6" /></>,
    quote: <><path d="M4 7h6v6H6c0 3-2 4-2 4M14 7h6v6h-4c0 3-2 4-2 4" fill="#fbf0d7" /></>,
    code: <><rect x="2.5" y="3.5" width="19" height="17" rx="2.5" stroke="#cadad3" fill="#fbfdfb" /><path d="M3.5 9h17v7h-17z" fill="#d9eddf" stroke="none" /><path d="m9 11-2 2 2 2m6-4 2 2-2 2M12.5 10.5l-1 5" strokeWidth="1.4" /></>,
    table: <><rect x="3" y="4" width="18" height="16" rx="2" fill="#fff" stroke="#c8c7dc" /><path d="M4 5h7v4H4z" fill="#dddbfa" stroke="none" /><path d="M12 5h8v4h-8z" fill="#d9ecf5" stroke="none" /><path d="M12 10h8v4h-8z" fill="#e8ddf4" stroke="none" /><path d="M3 9h18M3 14h18M11 4v16" stroke="#c8c7dc" strokeWidth="1.1" /></>,
    divider: <><path d="M4 6h16M4 18h16" stroke="#d0d4d9" strokeWidth="1" /><path d="M3 12h18" /></>,
    link: <><path d="m10 14 4-4M8 15l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 9l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(0 -1) scale(.92)" /></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2.5" fill="#dbeafc" stroke="#7badd9" /><circle cx="16" cy="9" r="2" fill="#e6b95f" stroke="none" /><path d="m4 18 5-7 5 6 3-3 3 4" fill="#78b49e" stroke="#6ca98e" strokeWidth="1" /></>,
  };
  return <svg className={`mi-type-icon mi-type-${kind}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{art[kind]}</svg>;
}

function insertion(kind: MarkdownInsertKind, markdown: string, selected = '', block = true): MarkdownInsertion {
  const start = selected ? markdown.indexOf(selected) : markdown.length;
  return { kind, markdown, selectionStart: Math.max(0, start), selectionEnd: Math.max(0, start) + selected.length, block };
}

export function createDirectInsertion(kind: DirectMarkdownInsertKind, selectedText = '', level: 1 | 2 | 3 = 2): MarkdownInsertion {
  if (kind === 'heading') return { ...insertion(kind, `${'#'.repeat(level)} ${selectedText}`, selectedText), direct: true, level };
  if (kind === 'code') {
    const fence = '`'.repeat(Math.max(3, ...(selectedText.match(/`+/g)?.map(value => value.length + 1) ?? [3])));
    const prefix = `${fence}\n`;
    return { kind, markdown: `${prefix}${selectedText}\n${fence}`, selectionStart: prefix.length, selectionEnd: prefix.length + selectedText.length, block: true, direct: true, language: '' };
  }
  if (kind === 'table') {
    const cell = selectedText.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
    const prefix = '|  |  |\n| --- | --- |\n| ';
    return { kind, markdown: `${prefix}${cell} |  |\n|  |  |`, selectionStart: prefix.length, selectionEnd: prefix.length + cell.length, block: true, direct: true };
  }
  const markdown = kind === 'divider' ? '---' : kind === 'text' ? selectedText : selectedText.split('\n').map((line, i) => `${kind === 'bullet' ? '- ' : kind === 'numbered' ? `${i + 1}. ` : kind === 'todo' ? '- [ ] ' : '> '}${line}`).join('\n');
  return { ...insertion(kind, markdown, selectedText), direct: true };
}

export function MarkdownInsertMenu({ onInsert, onClose, selectedText = '', initialQuery = '', onLiteral, onQueryChange, className = '', style, variant = 'popup', targetId, focusRequest = 0, componentRequest, disabled = false }: MarkdownInsertMenuProps) {
  const items = getItems();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [detail, setDetail] = useState<'link' | 'image' | null>(null);
  const [content, setContent] = useState(selectedText);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const filtered = items.filter(item => `${item.label} ${item.keys}`.toLowerCase().includes(query.trim().toLowerCase()));
  const chosen = items.find(item => item.kind === detail);

  useEffect(() => { if (variant === 'popup') search.current?.focus({ preventScroll: true }); }, [variant]);
  useEffect(() => {
    if (focusRequest) { setDetail(null); setSearchOpen(true); setQuery(''); setActive(0); requestAnimationFrame(() => search.current?.focus({ preventScroll: true })); }
  }, [focusRequest]);
  useEffect(() => { setDetail(null); setQuery(''); setError(''); }, [targetId]);
  useEffect(() => {
    if (!componentRequest || disabled) return;
    setContent(selectedText);
    setUrl('');
    setError('');
    setSearchOpen(false);
    setDetail(componentRequest.kind);
    requestAnimationFrame(() => root.current?.querySelector<HTMLInputElement>('.mi-detail input')?.focus({ preventScroll: true }));
  }, [componentRequest]);
  useEffect(() => { setActive(0); onQueryChange?.(query); }, [query, onQueryChange]);
  useEffect(() => { root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);
  useLayoutEffect(() => {
    const menu = root.current;
    if (!menu || style?.position !== 'fixed') return;
    const rect = menu.getBoundingClientRect();
    const top = typeof style.top === 'number' ? style.top : rect.top;
    menu.style.top = `${Math.max(12, Math.min(top, window.innerHeight - rect.height - 12))}px`;
  }, [detail, filtered.length, style?.position, style?.top]);

  useEffect(() => {
    if (variant !== 'floating' || (!detail && !searchOpen)) return;
    const dismiss = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('.component-library')) {
        void motionChange(() => { setDetail(null); setSearchOpen(false); }, 'popover');
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [variant, detail, searchOpen]);
  function close() { if (onLiteral) onLiteral(`/${query}`); else onClose(); }
  function dismissPanel() {
    const opener = variant === 'floating' ? root.current?.querySelector<HTMLButtonElement>('.mi-tool[aria-pressed="true"], .mi-search-tool[aria-expanded="true"]') : null;
    void motionChange(() => {
      setDetail(null);
      setSearchOpen(false);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      if (variant !== 'floating') requestAnimationFrame(() => search.current?.focus({ preventScroll: true }));
    }, 'popover');
  }

  function commit(item: MarkdownInsertion) {
    if (disabled) return;
    onInsert(item);
    if (variant !== 'popup') {
      const clearPanel = () => { setDetail(null); setSearchOpen(false); setQuery(''); setError(''); };
      if (detail || searchOpen) void motionChange(clearPanel, 'popover');
      else clearPanel();
    }
  }

  function choose(kind: MarkdownInsertKind) {
    if (disabled) return;
    if (kind === 'link' || kind === 'image') {
      void motionChange(() => {
        setError('');
        setContent(selectedText);
        setSearchOpen(false);
        setDetail(kind);
        requestAnimationFrame(() => root.current?.querySelector<HTMLInputElement>('.mi-detail input')?.focus({ preventScroll: true }));
      }, 'popover');
      return;
    }
    setError('');
    commit(createDirectInsertion(kind, selectedText));
  }

  function submit() {
    if (!detail) return;
    let parsed: URL;
    try { parsed = new URL(url.trim()); } catch { setError(t("输入完整的 http:// 或 https:// 地址", "Enter an http:// or https:// URL")); return; }
    if (!['http:', 'https:'].includes(parsed.protocol)) { setError(t("请使用 http:// 或 https:// 地址", "Use an http:// or https:// URL")); return; }
    const label = (content.trim() || (detail === 'image' ? t("图片", "Image") : parsed.hostname)).replace(/([\\[\]])/g, '\\$1');
    const address = parsed.href.replace(/\(/g, '%28').replace(/\)/g, '%29');
    commit(insertion(detail, `${detail === 'image' ? '!' : ''}[${label}](${address})`, label, detail === 'image'));
  }

  const detailContent = detail && <><div className="mi-detail-title"><button type="button" aria-label={t("返回组件列表", "Back to blocks")} onClick={dismissPanel}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m14 6-6 6 6 6" /></svg></button><MarkdownInsertIcon kind={detail} /><strong>{chosen?.label}</strong>{variant === 'popup' && <button type="button" className="mi-close" aria-label={t("关闭插入菜单", "Close blocks")} onClick={close}>×</button>}</div>
      <form className="mi-detail" onSubmit={event => { event.preventDefault(); submit(); }}>
        {(detail === 'link' || detail === 'image') && <><label>{detail === 'image' ? t("图片地址", "Image URL") : t("链接地址", "Link URL")}<input value={url} onChange={event => { setUrl(event.target.value); setError(''); }} placeholder="https://" aria-label={detail === 'image' ? t("图片地址", "Image URL") : t("链接地址", "Link URL")} autoComplete="off" /></label><label>{detail === 'image' ? t("图片说明", "Alt text") : t("显示文字", "Link text")}<input value={content} onChange={event => setContent(event.target.value)} placeholder={detail === 'image' ? t("可选", "Optional") : t("可选，默认使用域名", "Optional; uses domain name")} aria-label={detail === 'image' ? t("图片说明", "Alt text") : t("显示文字", "Link text")} /></label></>}
        {error && <p className="mi-error" role="alert">{error}</p>}<button className="mi-submit" type="submit" disabled={disabled}>{t("插入", "Insert")} {chosen?.label}</button>
      </form></>;
  const listContent = <><div className="mi-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></svg><input ref={search} value={query} onChange={event => { const next = event.target.value; if (onLiteral && /[\/\\]/.test(next)) onLiteral(`/${next}`); else setQuery(next); }} placeholder={t("搜索组件…", "Search blocks…")} aria-label={t("搜索组件", "Search blocks")} role="combobox" aria-autocomplete="list" aria-controls={`${id}-list`} aria-expanded="true" aria-activedescendant={filtered[active] ? `${id}-${filtered[active].kind}` : undefined} />{variant === 'popup' && <button type="button" className="mi-close" onClick={close} aria-label={t("关闭插入菜单", "Close blocks")}>×</button>}</div>
      <div className="mi-options" role="listbox" id={`${id}-list`} aria-label={t("组件类型", "Block types")}>{filtered.map((item, index) => <button type="button" disabled={disabled} role="option" title={shortcutTitle(item)} aria-keyshortcuts={ariaShortcut(item.kind)} id={`${id}-${item.kind}`} key={item.kind} aria-selected={active === index} className={`mi-option mi-option-${item.kind}`} onPointerMove={() => setActive(index)} onClick={() => choose(item.kind)}><MarkdownInsertIcon kind={item.kind} /><span className="mi-option-label">{item.label}</span><span className={`mi-sample mi-sample-${item.kind}`} aria-hidden="true">{item.sample}</span>{item.detail && <svg className="mi-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m9 6 6 6-6 6" /></svg>}</button>)}{!filtered.length && <div className="mi-no-result">{t("没有找到组件", "No blocks found")}</div>}</div>
      {variant === 'popup' && <div className="mi-footer"><span><kbd>↑</kbd><kbd>↓</kbd> {t("选择", "Choose")}</span><span><kbd>↵</kbd> {t("插入", "Insert")}</span><span><kbd>esc</kbd> {t("关闭", "Close")}</span></div>}</>;
  return <div ref={root} className={`markdown-insert-menu ${variant === 'floating' ? 'mi-floating' : ''} ${className}`} style={style} role={variant === 'popup' ? 'dialog' : 'group'} aria-label={t("插入组件", "Insert block")} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onKeyDown={event => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); if (detail || searchOpen) dismissPanel(); else close(); return; }
    if ((event.target as HTMLElement).closest('.mi-toolbar')) {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.mi-toolbar button:not(:disabled)')];
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        buttons[(index + buttons.length + (event.key === 'ArrowRight' ? 1 : -1)) % buttons.length]?.focus();
      }
      return;
    }
    if (detail) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % Math.max(1, filtered.length)); }
    if (event.key === 'Enter' && filtered[active]) { event.preventDefault(); choose(filtered[active].kind); }
  }}>
    {variant === 'floating' ? <><div className="mi-toolbar" role="toolbar" aria-label={t("Markdown 组件类型", "Markdown block types")}>{items.map(item => <button key={item.kind} type="button" aria-label={item.label} title={shortcutTitle(item)} aria-keyshortcuts={ariaShortcut(item.kind)} disabled={disabled} aria-pressed={detail === item.kind} className={`mi-tool mi-tool-${item.kind}`} onClick={() => choose(item.kind)}><MarkdownInsertIcon kind={item.kind} /><span className="mi-tool-label">{item.label}</span></button>)}<button type="button" className="mi-tool mi-search-tool" aria-label={t("搜索组件", "Search blocks")} title={t("搜索组件", "Search blocks")} aria-expanded={searchOpen} onClick={() => { void motionChange(() => { setDetail(null); setSearchOpen(value => !value); requestAnimationFrame(() => search.current?.focus({ preventScroll: true })); }, 'popover'); }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></svg></button></div>{(detail || searchOpen) && <div className="mi-floating-popover">{detail ? detailContent : listContent}</div>}</> : detail ? detailContent : listContent}
  </div>;
}
