import { t, dateLocale } from '../i18n';
import { useState } from 'react';
import { Icon } from '../manual-demo/icons';
import { collectionPath, noteTitle } from './content';
import { isCollectionDeleted, isMemo, type Collection, type Note, type NotebookState } from './store';
import './archive-panel.css';

export type ArchivePanelProps = {
  state: NotebookState;
  busy: boolean;
  onOpenMemo: (id: string) => void;
  onOpenCollection: (id: string) => void;
  onRestoreMemo: (id: string) => void;
  onRestoreCollection: (id: string) => void;
};

type ArchiveRow =
  | { kind: 'memo'; item: Note; archivedAt: number }
  | { kind: 'collection'; item: Collection; archivedAt: number };

function excerpt(markdown: string) {
  return markdown.replace(/!?(\[[^\]]*\])\([^)]*\)/g, '$1')
    .replace(/```[^\n]*|~~~/g, '').replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/gm, '')
    .replace(/[*_`\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
}

function ArchiveSymbol() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="5" rx="1.5" /><path d="M5 8v12h14V8M10 12h4" /></svg>;
}

export function ArchivePanel({ state, busy, onOpenMemo, onOpenCollection, onRestoreMemo, onRestoreCollection }: ArchivePanelProps) {
  const [query, setQuery] = useState('');
  const rows: ArchiveRow[] = [
    ...state.notes.filter(item => isMemo(item) && item.archivedAt !== undefined)
      .map(item => ({ kind: 'memo' as const, item, archivedAt: item.archivedAt! })),
    ...state.collections.filter(item => item.archivedAt !== undefined && !isCollectionDeleted(item.id, state))
      .map(item => ({ kind: 'collection' as const, item, archivedAt: item.archivedAt! })),
  ].sort((a, b) => b.archivedAt - a.archivedAt);
  const needle = query.trim().toLocaleLowerCase();
  const visible = rows.filter(row => {
    if (!needle) return true;
    return row.kind === 'memo'
      ? `${row.item.markdown}\n${row.item.source?.quote ?? ''}\n${row.item.source?.path.join(' / ') ?? ''}`.toLocaleLowerCase().includes(needle)
      : `${collectionPath(row.item.id, state).map(item => item.title).join(' / ')}\n${row.item.summary ?? ''}`.toLocaleLowerCase().includes(needle);
  });

  return <div className="nb-archive-panel" aria-busy={busy}>
    {!!rows.length && <div className="nb-archive-tools"><label className="nb-archive-search"><Icon name="search" /><input aria-label={t('搜索归档', 'Search archive')} placeholder={t('搜索归档', 'Search archive')} value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label={t('清除搜索', 'Clear search')} onClick={() => setQuery('')}>×</button>}</label><span>{t(`${visible.length} 项`, `${visible.length} ${visible.length === 1 ? 'item' : 'items'}`)}</span></div>}
    {visible.length ? <ul className="nb-archive-list" aria-label={t('已归档内容', 'Archived content')}>{visible.map(row => {
      const collection = row.kind === 'collection' ? row.item : null;
      const memo = row.kind === 'memo' ? row.item : null;
      const path = collection ? collectionPath(collection.id, state) : [];
      const parentArchived = path.slice(0, -1).some(item => item.archivedAt !== undefined);
      const label = collection ? path.length > 1 ? t('章节', 'Chapter') : t('书籍', 'Book') : t('随笔', 'Notes');
      const title = collection?.title ?? noteTitle(memo!.markdown.trim() || memo!.source?.quote || '');
      const location = collection ? path.slice(0, -1).map(item => item.title).join(' / ') || t('我的阅读', 'Library') : memo!.source?.path.join(' / ') || t('随笔', 'Notes');
      const preview = excerpt(collection ? collection.summary ?? '' : memo!.markdown.split('\n').slice(1).join('\n'));
      const restoreHint = parentArchived ? t('请先恢复上级归档', 'Restore the parent first') : t(`恢复${label}`, `Restore ${label.toLowerCase()}`);
      return <li className="nb-archive-row" key={`${row.kind}:${row.item.id}`}>
        <button type="button" className="nb-archive-open" aria-label={t(`打开：${title}`, `Open: ${title}`)} disabled={busy} onClick={() => collection ? onOpenCollection(collection.id) : onOpenMemo(memo!.id)}>
          <span className={`nb-archive-symbol is-${row.kind}`}><Icon name={collection ? path.length > 1 ? 'list' : 'book' : 'note'} /></span>
          <span className="nb-archive-details"><span className="nb-archive-title"><strong>{title}</strong><span>{label}</span></span><span className="nb-archive-location" title={location}>{location}</span>{preview && <span className="nb-archive-preview">{preview}</span>}<span className="nb-archive-meta"><time dateTime={new Date(row.archivedAt).toISOString()}>{new Date(row.archivedAt).toLocaleDateString(dateLocale(), { year: 'numeric', month: 'numeric', day: 'numeric' })}</time>{parentArchived && <span>{t('上级已归档', 'Parent archived')}</span>}</span></span>
        </button>
        <button type="button" className="nb-archive-restore" disabled={busy || parentArchived} title={restoreHint} aria-label={t(`恢复：${title}`, `Restore: ${title}`)} onClick={() => collection ? onRestoreCollection(collection.id) : onRestoreMemo(memo!.id)}><Icon name="history" /><span>{t('恢复', 'Restore')}</span></button>
      </li>;
    })}</ul> : <div className="nb-archive-empty"><ArchiveSymbol /><p>{needle ? t('没有匹配的归档', 'No matching archives') : t('暂无归档', 'No archived items')}</p></div>}
  </div>;
}
