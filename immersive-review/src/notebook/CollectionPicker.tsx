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
  return <label className="np-search"><Icon name="search" /><input aria-label={label} placeholder={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} />{value && <button type="button" aria-label="清除搜索" disabled={disabled} onClick={() => onChange('')}>×</button>}</label>;
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
  const reason = (item: Collection) => item.id === from ? '当前位置' : mode === 'copy' && exists(item) ? '已加入' : '';
  const status = (item: Collection) => reason(item) || (mode === 'move' && exists(item) ? '目标已有' : item.items.length);
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
    } catch (cause) { setError(cause instanceof Error ? cause.message : '创建失败，请重试。'); }
    finally { lock.current = false; setPending(false); }
  }

  async function confirm() {
    if (occupied || lock.current || !selected || reason(selected) || !chosen.length) return;
    lock.current = true; setPending(true); setError('');
    try { if (await onConfirm(selected.id)) onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '未能完成整理，请重试。'); }
    finally { lock.current = false; setPending(false); }
  }

  return <div className="np-picker np-destination" aria-busy={occupied}>
    <div className="np-selection-summary"><span className="np-summary-icon"><Icon name={chosen.length === 1 && chosen[0].kind === 'note' ? 'note' : 'list'} /></span><div><strong>{chosen.length === 1 ? titleFor(chosen[0], state) : `${chosen.length} 项内容`}</strong><span>{source ? `/阅读站/${collectionPath(source.id, state).map(item => item.title).join("/")}` : '随笔与阅读内容'}{chosen.length > 1 && ` · ${chosen.slice(0, 2).map(ref => titleFor(ref, state)).join('、')}${chosen.length > 2 ? '…' : ''}`}</span></div><span className="np-operation">{mode === 'move' ? '移动' : '加入'}</span></div>
    <div className="np-destination-body">
      <section className="np-dest-index" aria-label="书籍与章节索引">
        <div className="np-index-tools"><Search value={query} onChange={setQuery} label="搜索书籍或章节" disabled={occupied} /><button type="button" ref={createTrigger} className="np-new-folder" title="新建书籍" aria-label="新建书籍" disabled={occupied} onClick={() => { void motionChange(() => { setCreating(true); setError(''); }, 'popover'); }}><Icon name="plus" /></button></div>
        <div className="np-folder-list">{visible.map(item => <button type="button" className="np-folder-row" key={item.id} aria-pressed={item.id === target} disabled={occupied || !!reason(item)} onClick={() => { void motionChange(() => { setTarget(item.id); setError(''); }, 'content'); }}><Folder small /><span>{item.title}{collectionPath(item.id, state).length > 1 && <small className="np-location-path">{collectionPath(item.id, state).slice(0,-1).map(parent => parent.title).join(" / ")}</small>}</span><small>{status(item)}</small></button>)}{!visible.length && <p className="np-empty">{query ? '没有匹配的位置' : '还没有书籍'}</p>}</div>
        {creating && <form className="np-create-folder" onSubmit={event => { event.preventDefault(); void create(); }}><label><span>书名</span><input ref={newName} value={name} maxLength={120} disabled={occupied} placeholder="新合集" onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelCreate(); } }} /></label><div><button type="button" disabled={occupied} onClick={cancelCreate}>取消</button><button type="submit" className="np-primary" disabled={occupied || !name.trim()}>创建</button></div></form>}
      </section>
      <section className="np-target-preview" aria-label="目标位置预览">
        <div className="np-path"><Icon name="book" /><span>阅读站</span><Icon name="chevron" /><strong>{selected?.title ?? '选择目标合集'}</strong></div>
        {selected ? <><div className="np-target-heading"><Folder /><div><h3>{selected.title}</h3><span>{incoming === 0 && mode === 'move' ? '目标已有引用 · 将移出来源合集' : `${selected.items.length} 项内容${incoming > 0 ? ` · 将加入 ${incoming} 项` : ''}`}</span></div></div><div className="np-preview-list">{selected.items.slice(0, 6).map(ref => <div key={refKey(ref)}><Icon name={ref.kind === 'note' ? 'note' : 'book'} /><span>{selected.titles?.[refKey(ref)] ?? titleFor(ref, state)}</span></div>)}{selected.items.length > 6 && <span className="np-preview-more">另有 {selected.items.length - 6} 项</span>}{!selected.items.length && <p className="np-empty">空合集</p>}</div></> : <div className="np-no-target"><Folder /><p>选择目标位置</p></div>}
      </section>
    </div>
    {error && <p role="alert" className="np-error">{error}</p>}
    <footer className="np-footer"><span className="np-footer-path" title={selected ? `/阅读站/${selected.title}` : ''}>{selected ? `/阅读站/${selected.title}` : `${chosen.length} 项内容`}</span><button type="button" className="np-cancel" disabled={occupied} onClick={onClose}>取消</button><button type="button" className="np-primary" disabled={occupied || !selected || !!reason(selected) || !chosen.length} onClick={() => void confirm()}>{pending ? '处理中…' : mode === 'move' ? '移动到此处' : '加入此处'}</button></footer>
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
    catch (cause) { setError(cause instanceof Error ? cause.message : '添加失败，请重试。'); }
    finally { lock.current = false; setPending(false); }
  }

  return <div className="np-picker np-content" aria-busy={occupied}>
    <div className="np-content-destination"><Folder small /><span>添加到</span><strong>{target?.title ?? '合集不存在'}</strong></div>
    <div className="np-content-body">
      <nav className="np-source-index" aria-label="内容来源索引"><button type="button" className="np-source" aria-current={source === 'notes' ? 'page' : undefined} disabled={occupied} onClick={() => browse('notes')}><Icon name="note" /><span>随笔</span><small>{notes.length}</small></button><button type="button" className="np-source" aria-current={source === 'manual' ? 'page' : undefined} disabled={occupied} onClick={() => browse('manual')}><Icon name="book" /><span>训练手册</span><small>{manual.topics.length} 章</small></button>{source === 'manual' && <div className="np-topics">{manual.topics.map((item, index) => <button type="button" key={item.id} aria-current={topicId === item.id ? 'page' : undefined} disabled={occupied} onClick={() => browse('manual', item.id)}><span className="np-topic-number">{String(index + 1).padStart(2, '0')}</span><span>{item.title}</span><small>{item.sectionIds.length}</small></button>)}</div>}</nav>
      <section className="np-content-browser" aria-label="可添加内容"><div className="np-content-search"><div className="np-path"><span>{source === 'notes' ? '随笔' : '训练手册'}</span>{source === 'manual' && <><Icon name="chevron" /><strong>{topic?.title}</strong></>}</div><Search value={query} onChange={value => { setQuery(value); setSelected([]); }} label={source === 'notes' ? '搜索随笔' : '搜索本章内容'} disabled={occupied} /></div>
        <label className="np-select-all"><input ref={allCheckbox} type="checkbox" aria-label="全选当前可添加内容" checked={all} disabled={occupied || !available.length} onChange={event => { const next = event.currentTarget.checked ? available.map(refKey) : []; void motionChange(() => setSelected(next), 'content'); }} /><span>名称</span><small>{visible.length} 项</small></label>
        <div className="np-content-list">{visible.map(ref => { const key = refKey(ref); const present = added.has(key); const checked = selected.includes(key) && !present; return <label className={`np-content-row ${checked ? 'is-selected' : ''} ${present ? 'is-added' : ''}`} key={key}><input type="checkbox" aria-label={`选择：${titleFor(ref, state)}`} checked={checked} disabled={occupied || present} onChange={event => { const next = event.currentTarget.checked; void motionChange(() => setSelected(items => next ? items.includes(key) ? items : [...items, key] : items.filter(item => item !== key)), 'content'); }} /><span className="np-item-icon"><Icon name={ref.kind === 'note' ? 'note' : 'book'} /></span><span className="np-item-text"><strong>{titleFor(ref, state)}</strong><span>{previewFor(ref, state) || (ref.kind === 'note' ? '随笔' : '训练手册')}</span></span>{present && <small>已加入</small>}</label>; })}{!visible.length && <div className="np-content-empty"><Icon name={source === 'notes' ? 'note' : 'book'} /><p>{query ? '没有匹配的内容' : source === 'notes' ? '还没有可添加的随笔' : '本章暂无内容'}</p></div>}</div>
      </section>
    </div>
    {error && <p role="alert" className="np-error">{error}</p>}
    <footer className="np-footer"><span className="np-selection-count" aria-live="polite">已选 <strong>{chosen.length}</strong> 项</span><button type="button" className="np-cancel" disabled={occupied} onClick={onClose}>取消</button><button type="button" className="np-primary" disabled={occupied || !chosen.length || !target} onClick={() => void confirm()}>{pending ? '添加中…' : chosen.length ? `添加 ${chosen.length} 项` : '添加'}</button></footer>
  </div>;
}
