import { IS_DEMO_MODE } from '../demo';
import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../manual-demo/icons';
import { bodyFor, collectionPath, isCollectionArchived, manual, previewFor, refKey, titleFor } from './content';
import { isMemo, type Collection, type NotebookState, type Ref } from './store';
import { motionChange } from './motion';
import './collection-picker.css';

export type DestinationPickerProps = {
  state: NotebookState;
  refs: Ref[];
  from?: string;
  mode: 'copy' | 'move';
  busy: boolean;
  onConfirm: (to: string) => Promise<boolean>;
  onCreate: (title: string) => Promise<Collection | undefined>;
  onClose: () => void;
};

export type ContentPickerProps = {
  state: NotebookState;
  collection: string;
  busy: boolean;
  onConfirm: (refs: Ref[]) => Promise<boolean>;
  onClose: () => void;
};

function Search({ value, onChange, label, disabled = false }: { value: string; onChange: (value: string) => void; label: string; disabled?: boolean }) {
  return <label className="np-search"><Icon name="search" /><input aria-label={label} placeholder={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} />{value && <button type="button" aria-label={t('清除搜索', 'Clear search')} disabled={disabled} onClick={() => onChange('')}>×</button>}</label>;
}

function Folder({ small = false }: { small?: boolean }) {
  return <svg className={`np-folder ${small ? 'np-folder-small' : ''}`} viewBox="0 0 32 28" aria-hidden="true"><path d="M2 6a3 3 0 0 1 3-3h7l3 3h12a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z" fill="currentColor" opacity=".45" /><path d="M2 11a2 2 0 0 1 2-2h24a2 2 0 0 1 2 2v11a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z" fill="currentColor" /></svg>;
}

export function DestinationPicker({ state, refs, from, mode, busy, onConfirm, onCreate, onClose }: DestinationPickerProps) {
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<Collection[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const newName = useRef<HTMLInputElement>(null);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const occupied = busy || pending;
  const collections = [...state.collections, ...created.filter(item => !state.collections.some(existing => existing.id === item.id))];
  const selected = collections.find(item => item.id === target);
  const chosen = refs.filter((ref, index) => refs.findIndex(item => refKey(item) === refKey(ref)) === index);
  const exists = (item: Collection) => chosen.every(ref => item.items.some(existing => refKey(existing) === refKey(ref)));
  const reason = (item: Collection) => item.id === from ? t('当前位置', 'Current location') : mode === 'copy' && exists(item) ? t('已加入', 'Added') : '';
  const status = (item: Collection) => reason(item) || (mode === 'move' && exists(item) ? t('目标已有', 'Already here') : item.items.length);
  const visible = collections.filter(item => !isCollectionArchived(item.id, state) && item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const source = state.collections.find(item => item.id === from);
  const incoming = selected ? chosen.filter(ref => !selected.items.some(existing => refKey(existing) === refKey(ref))).length : 0;

  useEffect(() => { if (creating) newName.current?.focus(); }, [creating]);

  function cancelCreate() {
    void motionChange(() => { setCreating(false); setName(''); createTrigger.current?.focus({ preventScroll: true }); }, 'popover');
  }

  async function create() {
    if (occupied || lock.current || !name.trim()) return;
    lock.current = true; setPending(true); setError('');
    try {
      const collection = await onCreate(name.trim());
      if (collection) await motionChange(() => {
        setCreated(items => [...items, collection]); setTarget(collection.id); setQuery(''); setName(''); setCreating(false); setPending(false);
        requestAnimationFrame(() => createTrigger.current?.focus({ preventScroll: true }));
      }, 'content');
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('创建失败，请重试。', 'Could not create. Try again.')); }
    finally { lock.current = false; setPending(false); }
  }

  async function confirm() {
    if (occupied || lock.current || !selected || reason(selected) || !chosen.length) return;
    lock.current = true; setPending(true); setError('');
    try { if (await onConfirm(selected.id)) onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('未能完成整理，请重试。', 'Could not organize. Try again.')); }
    finally { lock.current = false; setPending(false); }
  }

  return <div className="np-picker np-destination" aria-busy={occupied}>
    <div className="np-selection-summary"><span className="np-summary-icon"><Icon name={chosen.length === 1 && chosen[0].kind === 'note' ? 'note' : 'list'} /></span><div><strong>{chosen.length === 1 ? titleFor(chosen[0], state) : t(`${chosen.length} 项内容`, `${chosen.length} ${chosen.length === 1 ? 'item' : 'items'}`)}</strong><span>{source ? `/${t('阅读站', 'Library')}/${collectionPath(source.id, state).map(item => item.title).join('/')}` : t('随笔与阅读内容', 'Notes and reading')}{chosen.length > 1 && ` · ${chosen.slice(0, 2).map(ref => titleFor(ref, state)).join(t('、', ', '))}${chosen.length > 2 ? '…' : ''}`}</span></div><span className="np-operation">{mode === 'move' ? t('移动', 'Move') : t('加入', 'Add')}</span></div>
    <div className="np-destination-body">
      <section className="np-dest-index" aria-label={t('书籍与章节索引', 'Books and chapters')}>
        <div className="np-index-tools"><Search value={query} onChange={setQuery} label={t('搜索书籍或章节', 'Search books or chapters')} disabled={occupied} /><button type="button" ref={createTrigger} className="np-new-folder" title={t('新建书籍', 'New book')} aria-label={t('新建书籍', 'New book')} disabled={occupied} onClick={() => { void motionChange(() => { setCreating(true); setError(''); }, 'popover'); }}><Icon name="plus" /></button></div>
        <div className="np-folder-list">{visible.map(item => <button type="button" className="np-folder-row" key={item.id} aria-pressed={item.id === target} disabled={occupied || !!reason(item)} onClick={() => { void motionChange(() => { setTarget(item.id); setError(''); }, 'content'); }}><Folder small /><span>{item.title}{collectionPath(item.id, state).length > 1 && <small className="np-location-path">{collectionPath(item.id, state).slice(0,-1).map(parent => parent.title).join(" / ")}</small>}</span><small>{status(item)}</small></button>)}{!visible.length && <p className="np-empty">{query ? t('没有匹配的位置', 'No matching locations') : t('还没有书籍', 'No books yet')}</p>}</div>
        {creating && <form className="np-create-folder" onSubmit={event => { event.preventDefault(); void create(); }}><label><span>{t('书名', 'Book title')}</span><input ref={newName} value={name} maxLength={120} disabled={occupied} placeholder={t('新合集', 'New book')} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelCreate(); } }} /></label><div><button type="button" disabled={occupied} onClick={cancelCreate}>{t('取消', 'Cancel')}</button><button type="submit" className="np-primary" disabled={occupied || !name.trim()}>{t('创建', 'Create')}</button></div></form>}
      </section>
      <section className="np-target-preview" aria-label={t('目标位置预览', 'Destination preview')}>
        <div className="np-path"><Icon name="book" /><span>{t('阅读站', 'Library')}</span><Icon name="chevron" /><strong>{selected?.title ?? t('选择目标合集', 'Choose a destination')}</strong></div>
        {selected ? <><div className="np-target-heading"><Folder /><div><h3>{selected.title}</h3><span>{incoming === 0 && mode === 'move' ? t('目标已有引用 · 将移出来源合集', 'Already here · will be removed from the source') : t(`${selected.items.length} 项内容${incoming > 0 ? ` · 将加入 ${incoming} 项` : ''}`, `${selected.items.length} ${selected.items.length === 1 ? 'item' : 'items'}${incoming > 0 ? ` · adding ${incoming}` : ''}`)}</span></div></div><div className="np-preview-list">{selected.items.slice(0, 6).map(ref => <div key={refKey(ref)}><Icon name={ref.kind === 'note' ? 'note' : 'book'} /><span>{selected.titles?.[refKey(ref)] ?? titleFor(ref, state)}</span></div>)}{selected.items.length > 6 && <span className="np-preview-more">{t(`另有 ${selected.items.length - 6} 项`, `${selected.items.length - 6} more`)}</span>}{!selected.items.length && <p className="np-empty">{t('空合集', 'Empty')}</p>}</div></> : <div className="np-no-target"><Folder /><p>{t('选择目标位置', 'Choose a destination')}</p></div>}
      </section>
    </div>
    {error && <p role="alert" className="np-error">{error}</p>}
    <footer className="np-footer"><span className="np-footer-path" title={selected ? `/${t('阅读站', 'Library')}/${selected.title}` : ''}>{selected ? `/${t('阅读站', 'Library')}/${selected.title}` : t(`${chosen.length} 项内容`, `${chosen.length} ${chosen.length === 1 ? 'item' : 'items'}`)}</span><button type="button" className="np-cancel" disabled={occupied} onClick={onClose}>{t('取消', 'Cancel')}</button><button type="button" className="np-primary" disabled={occupied || !selected || !!reason(selected) || !chosen.length} onClick={() => void confirm()}>{pending ? t('处理中…', 'Working…') : mode === 'move' ? t('移动到此处', 'Move here') : t('加入此处', 'Add here')}</button></footer>
  </div>;
}

export function ContentPicker({ state, collection, busy, onConfirm, onClose }: ContentPickerProps) {
  const [source, setSource] = useState<'notes' | 'manual'>('notes');
  const [topicId, setTopicId] = useState(manual.topics[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const allCheckbox = useRef<HTMLInputElement>(null);
  const target = state.collections.find(item => item.id === collection);
  const occupied = busy || pending;
  const topic = manual.topics.find(item => item.id === topicId);
  const notes = state.notes.filter(note => isMemo(note) && note.archivedAt === undefined).sort((a, b) => b.createdAt - a.createdAt);
  const items: Ref[] = source === 'notes' ? notes.map(note => ({ kind: 'note', id: note.id })) : topic?.sectionIds.map(id => ({ kind: 'section', id })) ?? [];
  const needle = query.trim().toLocaleLowerCase();
  const visible = items.filter(ref => !needle || `${titleFor(ref, state)}\n${bodyFor(ref, state)}`.toLocaleLowerCase().includes(needle));
  const added = new Set(target?.items.map(refKey));
  const available = visible.filter(ref => !added.has(refKey(ref)));
  const chosen = available.filter(ref => selected.includes(refKey(ref)));
  const all = available.length > 0 && chosen.length === available.length;
  useEffect(() => { if (allCheckbox.current) allCheckbox.current.indeterminate = chosen.length > 0 && !all; }, [chosen.length, all]);

  function browse(next: 'notes' | 'manual', id = topicId) {
    void motionChange(() => { setSource(next); setTopicId(id); setQuery(''); setSelected([]); setError(''); }, 'content');
  }
  async function confirm() {
    if (occupied || lock.current || !chosen.length || !target) return;
    lock.current = true; setPending(true); setError('');
    try { if (await onConfirm(chosen)) onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('添加失败，请重试。', 'Could not add. Try again.')); }
    finally { lock.current = false; setPending(false); }
  }

  return <div className="np-picker np-content" aria-busy={occupied}>
    <div className="np-content-destination"><Folder small /><span>{t('添加到', 'Add to')}</span><strong>{target?.title ?? t('合集不存在', 'Location unavailable')}</strong></div>
    <div className="np-content-body">
      <nav className="np-source-index" aria-label={t('内容来源索引', 'Content sources')}><button type="button" className="np-source" aria-current={source === 'notes' ? 'page' : undefined} disabled={occupied} onClick={() => browse('notes')}><Icon name="note" /><span>{t('随笔', 'Notes')}</span><small>{notes.length}</small></button>{!IS_DEMO_MODE && <button type="button" className="np-source" aria-current={source === 'manual' ? 'page' : undefined} disabled={occupied} onClick={() => browse('manual')}><Icon name="book" /><span>{t('训练手册', 'Reference')}</span><small>{manual.topics.length}</small></button>}{source === 'manual' && <div className="np-topics">{manual.topics.map((item, index) => <button type="button" key={item.id} aria-current={topicId === item.id ? 'page' : undefined} disabled={occupied} onClick={() => browse('manual', item.id)}><span className="np-topic-number">{String(index + 1).padStart(2, '0')}</span><span>{item.title}</span><small>{item.sectionIds.length}</small></button>)}</div>}</nav>
      <section className="np-content-browser" aria-label={t('可添加内容', 'Available content')}><div className="np-content-search"><div className="np-path"><span>{source === 'notes' ? t('随笔', 'Notes') : t('训练手册', 'Reference')}</span>{source === 'manual' && <><Icon name="chevron" /><strong>{topic?.title}</strong></>}</div><Search value={query} onChange={value => { setQuery(value); setSelected([]); }} label={source === 'notes' ? t('搜索随笔', 'Search notes') : t('搜索本章内容', 'Search this chapter')} disabled={occupied} /></div>
        <label className="np-select-all"><input ref={allCheckbox} type="checkbox" aria-label={t('全选当前可添加内容', 'Select all available content')} checked={all} disabled={occupied || !available.length} onChange={event => { const next = event.currentTarget.checked ? available.map(refKey) : []; void motionChange(() => setSelected(next), 'content'); }} /><span>{t('名称', 'Name')}</span><small>{t(`${visible.length} 项`, `${visible.length} ${visible.length === 1 ? 'item' : 'items'}`)}</small></label>
        <div className="np-content-list">{visible.map(ref => { const key = refKey(ref); const present = added.has(key); const checked = selected.includes(key) && !present; return <label className={`np-content-row ${checked ? 'is-selected' : ''} ${present ? 'is-added' : ''}`} key={key}><input type="checkbox" aria-label={t(`选择：${titleFor(ref, state)}`, `Select: ${titleFor(ref, state)}`)} checked={checked} disabled={occupied || present} onChange={event => { const next = event.currentTarget.checked; void motionChange(() => setSelected(items => next ? items.includes(key) ? items : [...items, key] : items.filter(item => item !== key)), 'content'); }} /><span className="np-item-icon"><Icon name={ref.kind === 'note' ? 'note' : 'book'} /></span><span className="np-item-text"><strong>{titleFor(ref, state)}</strong><span>{previewFor(ref, state) || (ref.kind === 'note' ? t('随笔', 'Notes') : t('训练手册', 'Reference'))}</span></span>{present && <small>{t('已加入', 'Added')}</small>}</label>; })}{!visible.length && <div className="np-content-empty"><Icon name={source === 'notes' ? 'note' : 'book'} /><p>{query ? t('没有匹配的内容', 'No matches') : source === 'notes' ? t('还没有可添加的随笔', 'No notes to add') : t('本章暂无内容', 'This chapter is empty')}</p></div>}</div>
      </section>
    </div>
    {error && <p role="alert" className="np-error">{error}</p>}
    <footer className="np-footer"><span className="np-selection-count" aria-live="polite"><strong>{chosen.length}</strong> {t('项已选', 'selected')}</span><button type="button" className="np-cancel" disabled={occupied} onClick={onClose}>{t('取消', 'Cancel')}</button><button type="button" className="np-primary" disabled={occupied || !chosen.length || !target} onClick={() => void confirm()}>{pending ? t('添加中…', 'Adding…') : chosen.length ? t(`添加 ${chosen.length} 项`, `Add ${chosen.length} ${chosen.length === 1 ? 'item' : 'items'}`) : t('添加', 'Add')}</button></footer>
  </div>;
}
