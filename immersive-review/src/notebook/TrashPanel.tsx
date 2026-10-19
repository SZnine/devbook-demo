import { t, dateLocale } from '../i18n';
import { Icon } from '../manual-demo/icons';
import { collectionPath } from './content';
import { isCollectionDeleted, type Collection, type DeletedContent, type NotebookState } from './store';
import './trash-panel.css';

type Props = {
  state: NotebookState;
  busy: boolean;
  onRestoreCollection: (id: string) => void;
  onRestoreContent: (id: string) => void;
};

type TrashRow = { kind: 'collection'; item: Collection; deletedAt: number } | { kind: 'content'; item: DeletedContent; deletedAt: number };

function excerpt(markdown: string) {
  return markdown.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/```[^\n]*|~~~/g, '').replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/gm, '')
    .replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
}

export function TrashPanel({ state, busy, onRestoreCollection, onRestoreContent }: Props) {
  const rows: TrashRow[] = [
    ...state.collections.filter(item => item.deletedAt !== undefined).map(item => ({ kind: 'collection' as const, item, deletedAt: item.deletedAt! })),
    ...(state.deletedContent ?? []).map(item => ({ kind: 'content' as const, item, deletedAt: item.deletedAt })),
  ].sort((a, b) => b.deletedAt - a.deletedAt);

  return <div className="nb-trash-panel">
    <p className="nb-trash-description">{t('可恢复书籍、章节和正文', 'Deleted items can be restored.')}</p>
    {rows.length ? <ul className="nb-trash-list" aria-label={t('已删除内容', 'Deleted content')}>{rows.map(row => {
      const collection = row.kind === 'collection' ? row.item : null;
      const content = row.kind === 'content' ? row.item : null;
      const path = collection ? collectionPath(collection.id, state) : [];
      const label = collection ? path.length > 1 ? t('章节', 'Chapter') : t('书籍', 'Book') : content?.kind === 'summary' ? t('摘要', 'Summary') : t('正文', 'Content');
      const location = collection ? path.slice(0, -1).map(item => item.title).join(' / ') || t('我的阅读', 'Library') : content!.path.join(' / ') || content!.collectionTitle;
      const parentDeleted = collection ? path.slice(0, -1).some(item => item.deletedAt !== undefined) : isCollectionDeleted(content!.collectionId, state);
      const parentMissing = content ? !state.collections.some(item => item.id === content.collectionId) : false;
      const unavailable = parentDeleted || parentMissing;
      const restoreHint = parentDeleted ? t('请先恢复所属书籍或章节', 'Restore the parent first') : parentMissing ? t('来源章节已不存在', 'The source chapter no longer exists') : t(`恢复${label}`, `Restore ${label.toLowerCase()}`);
      const title = row.item.title;
      const preview = content ? excerpt(content.markdown) : '';
      return <li className="nb-trash-row" key={`${row.kind}:${row.item.id}`}>
        <span className={`nb-trash-symbol ${collection ? 'is-collection' : 'is-content'}`}><Icon name={collection ? 'book' : content?.kind === 'summary' ? 'list' : 'note'} /></span>
        <div className="nb-trash-details">
          <div className="nb-trash-title"><strong>{title}</strong><span>{label}</span></div>
          <div className="nb-trash-location" title={location}>{location}</div>
          {preview && <p className="nb-trash-preview">{preview}</p>}
          <div className="nb-trash-meta"><time dateTime={new Date(row.deletedAt).toISOString()}>{new Date(row.deletedAt).toLocaleString(dateLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>{unavailable && <span>{restoreHint}</span>}</div>
        </div>
        <button className="nb-trash-restore" type="button" disabled={busy || unavailable} title={restoreHint} aria-label={t(`恢复：${title}`, `Restore: ${title}`)} onClick={() => collection ? onRestoreCollection(collection.id) : onRestoreContent(content!.id)}><Icon name="history" /><span>{t('恢复', 'Restore')}</span></button>
      </li>;
    })}</ul> : <div className="nb-trash-empty"><Icon name="history" /><p>{t('回收站为空', 'Trash is empty')}</p></div>}
  </div>;
}
