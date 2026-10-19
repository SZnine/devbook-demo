import { t } from '../i18n';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../manual-demo/icons';
import { ChapterEditor } from './ChapterEditor';
import { useComponentLibrary } from './ComponentLibrary';
import { motionChange } from './motion';
import './composer.css';

export type MemoComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSave: (markdown: string) => Promise<boolean> | boolean;
  onCancel?: () => void;
  editing?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  allowEmpty?: boolean;
  tags?: string[];
};

export function MemoComposer({ value, onChange, onSave, onCancel, editing = false, disabled = false, autoFocus = false, allowEmpty = false, tags = [] }: MemoComposerProps) {
  const container = useRef<HTMLElement>(null);
  const tagControl = useRef<HTMLDivElement>(null);
  const tagInput = useRef<HTMLInputElement>(null);
  const tagPicker = useRef<HTMLDivElement>(null);
  const library = useComponentLibrary();
  const current = useRef(value);
  const savingRef = useRef(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState('');
  const [error, setError] = useState('');
  const locked = disabled || saving;

  useLayoutEffect(() => { current.current = value; }, [value]);
  useEffect(() => () => clearTimeout(savedTimer.current), []);
  useLayoutEffect(() => {
    const picker = tagPicker.current;
    if (!tagOpen || !picker) return;
    if (!picker.matches(':popover-open')) picker.showPopover();
    const position = () => {
      const anchor = tagControl.current?.getBoundingClientRect();
      if (!anchor) return;
      const height = Math.min(picker.offsetHeight, window.innerHeight - 24);
      const top = anchor.top > height + 20 ? anchor.top - height - 8 : anchor.bottom + 8;
      picker.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - picker.offsetWidth - 12))}px`;
      picker.style.top = `${Math.max(12, Math.min(top, window.innerHeight - height - 12))}px`;
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [tagOpen, tagQuery, tags.length]);
  useEffect(() => {
    if (!tagOpen) return;
    tagInput.current?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (!tagControl.current?.contains(event.target as Node)) void motionChange(() => setTagOpen(false), 'popover');
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [tagOpen]);
  useEffect(() => { if (locked) setTagOpen(false); }, [locked]);

  const normalizedTag = tagQuery.trim().replace(/^[#＃]+/, '').replace(/\s+/g, '-');
  const matches = useMemo(() => {
    const query = tagQuery.trim().replace(/^[#＃]+/, '').toLocaleLowerCase();
    return [...new Set(tags.map(tag => tag.replace(/^[#＃]+/, '')))]
      .filter(tag => tag.toLocaleLowerCase().includes(query))
      .slice(0, 7);
  }, [tags, tagQuery]);

  const focusEditor = () => {
    const selector = sourceMode ? '.vditor-sv' : '.vditor-wysiwyg [contenteditable="true"], .vditor-ir [contenteditable="true"]';
    container.current?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
  };
  const change = (markdown: string) => {
    current.current = markdown;
    setError('');
    setSaved(false);
    onChange(markdown);
  };
  const openTags = () => {
    if (locked) return;
    if (tagOpen) { void motionChange(() => { setTagOpen(false); focusEditor(); }, 'popover'); return; }
    // Focus activates this editor's target; the menu input must not replace its selection.
    focusEditor();
    library.capture();
    void motionChange(() => { setTagQuery(''); setTagOpen(true); }, 'popover');
  };
  const insertTag = (tag: string) => {
    const name = tag.trim().replace(/^[#＃]+/, '').replace(/\s+/g, '-');
    if (locked || !name || !library.available) return;
    const markdown = ` #${name} `;
    library.insert({ kind: 'text', markdown, selectionStart: markdown.length, selectionEnd: markdown.length, block: false });
    void motionChange(() => { setTagOpen(false); setTagQuery(''); }, 'popover');
  };
  const save = async (markdown = current.current) => {
    if (disabled || savingRef.current || (!allowEmpty && !markdown.trim())) return false;
    savingRef.current = true;
    setSaving(true);
    setTagOpen(false);
    setError('');
    try {
      if (await onSave(markdown)) {
        void motionChange(() => { setSaved(true); setExpanded(false); }, 'popover');
        clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(false), 1800);
        return true;
      }
      setError(t("未能保存，内容仍保留在这里。", "Could not save. Your draft is safe."));
    } catch {
      setError(t("保存失败，内容仍保留在这里。", "Could not save. Your draft is safe."));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    return false;
  };

  return <section ref={container} className={`nb-composer nb-composer-next${expanded ? ' is-expanded' : ''}${value ? ' has-content' : ''}`} aria-label={editing ? t("编辑随笔", "Edit note") : t("写随笔", "Write a note")} aria-busy={saving}
    onKeyDown={event => {
      if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (tagOpen) { event.preventDefault(); event.stopPropagation(); void motionChange(() => { setTagOpen(false); focusEditor(); }, 'popover'); }
      else if (expanded) { event.preventDefault(); event.stopPropagation(); void motionChange(() => setExpanded(false), 'layout'); }
    }}>
    {editing && onCancel && <div className="nbc-heading"><span>{t("编辑随笔", "Edit note")}</span><button type="button" disabled={locked} onClick={() => void motionChange(onCancel)}>{t("取消", "Cancel")}</button></div>}
    <div className="nbc-body" inert={locked}>
      <ChapterEditor value={value} onChange={change} onSave={save} onCancel={() => {}} autoFocus={autoFocus} label={t("随笔正文", "Note content")} mode={sourceMode ? 'sv' : 'ir'} live allowEmpty />
    </div>
    <footer className="nb-composer-tools">
      <div role="group" aria-label={t("编辑工具", "Editing tools")}>
        <div ref={tagControl} className="nbc-tag-control">
          <button className="nb-icon" type="button" aria-label={t("添加标签", "Add tag")} title={t("添加标签", "Add tag")} aria-expanded={tagOpen} disabled={locked} onPointerDown={event => { event.preventDefault(); library.capture(); }} onClick={openTags}><span aria-hidden="true">#</span></button>
          {tagOpen && <div ref={tagPicker} className="nbc-tag-picker" role="group" aria-label={t("标签", "Tags")} popover="auto" onToggle={event => { if (!event.currentTarget.matches(':popover-open')) void motionChange(() => setTagOpen(false), 'popover'); }}>
            <form onSubmit={event => { event.preventDefault(); insertTag(normalizedTag); }}>
              <span aria-hidden="true">#</span><input ref={tagInput} aria-label={t("标签名称", "Tag name")} placeholder={t("查找或输入标签", "Find or add a tag")} value={tagQuery} onChange={event => setTagQuery(event.target.value)} autoComplete="off" /><button type="submit" disabled={!normalizedTag || !library.available}>{t("添加", "Add")}</button>
            </form>
            {matches.length > 0 && <div className="nbc-tag-options">{matches.map(tag => <button type="button" key={tag} onClick={() => insertTag(tag)}><span aria-hidden="true">#</span>{tag}</button>)}</div>}
          </div>}
        </div>
        <button className="nb-icon" type="button" aria-label={sourceMode ? t("关闭源码模式", "Close source") : t("源码模式", "Source")} title={sourceMode ? t("关闭源码模式", "Close source") : t("源码模式", "Source")} aria-pressed={sourceMode} disabled={locked} onPointerDown={() => library.capture()} onClick={() => void motionChange(() => { setTagOpen(false); setSourceMode(mode => !mode); })}><Icon name="code" /></button>
      </div>
      <div><button type="button" className="nb-icon nbc-expand" aria-label={expanded ? t("收起编辑区", "Collapse editor") : t("展开编辑区", "Expand editor")} title={expanded ? t("收起编辑区", "Collapse editor") : t("展开编辑区", "Expand editor")} aria-pressed={expanded} disabled={locked} onClick={() => void motionChange(() => setExpanded(value => !value), 'layout')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">{expanded ? <path d="M3 9h6V3m12 12h-6v6M9 9 3 3m12 12 6 6" /> : <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6" />}</svg></button><button className="nb-save" type="button" title={t("保存 · Ctrl+Shift+Enter（普通正文也可 Ctrl+Enter）", "Save · Ctrl+Shift+Enter")} aria-keyshortcuts="Control+Shift+Enter Meta+Shift+Enter" disabled={locked || (!allowEmpty && !value.trim())} onClick={() => void save()}>{saving ? t("保存中…", "Saving…") : saved ? t("已保存 ✓", "Saved ✓") : editing ? t("更新", "Update") : t("保存", "Save")}</button></div>
    </footer>
    {error && <div className="nbc-error" role="alert">{error}</div>}
    <span className="nbc-sr" role="status" aria-live="polite">{saving ? t("正在保存", "Saving") : saved ? t("随笔已保存", "Note saved") : ''}</span>
  </section>;
}
