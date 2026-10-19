import { t, getLanguage } from '../i18n';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, type IconName } from '../manual-demo/icons';
import { createSearchIndex, highlightMatches, searchKeywordIndex, type GlobalSearchResult, type GlobalSearchState } from './global-search';
import './global-search.css';

type Props = { state: GlobalSearchState; initialQuery?: string; onSelect: (result: GlobalSearchResult) => void; onClose: () => void };
const icons: Record<GlobalSearchResult['type'], IconName> = { book: 'book', chapter: 'list', content: 'note', memo: 'note', reference: 'link' };

function Highlight({ text, query }: { text: string; query: string }) {
  return highlightMatches(text, query).map((run, index) => run.match ? <mark key={index}>{run.text}</mark> : run.text);
}

/** Craft's quick-open keyboard behaviour with full-content keyword results. */
export function GlobalSearch({ state, initialQuery = '', onSelect, onClose }: Props) {
  const labels = { book: t('书籍', 'Book'), chapter: t('章节', 'Chapter'), content: t('正文', 'Content'), memo: t('随笔', 'Notes'), reference: t('参考资料', 'Reference') };
  const language = getLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef(document.activeElement as HTMLElement | null);
  const chosen = useRef(false);
  const listId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const index = useMemo(() => createSearchIndex(state), [state.collections, state.notes, language]);
  const results = useMemo(() => searchKeywordIndex(index, query), [index, query]);
  const selected = Math.min(active, Math.max(0, results.length - 1));
  useEffect(() => {
    dialog.current?.showModal();
    input.current?.focus();
    return () => { dialog.current?.close(); if (!chosen.current && opener.current?.isConnected) opener.current.focus({ preventScroll: true }); };
  }, []);
  function choose(result: GlobalSearchResult) { chosen.current = true; onSelect(result); }
  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!results.length) return;
      const next = (selected + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      setActive(next);
      dialog.current?.querySelector(`[data-search-index="${next}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && results[selected]) { event.preventDefault(); choose(results[selected]); }
  }
  return <dialog ref={dialog} className="nb-global-search" aria-label={t('搜索全部内容', 'Search everything')}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); } }}>
    <div className="ngs-input-row"><Icon name="search" />
      <input ref={input} type="search" value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={keys}
        placeholder={t('搜索全部内容', 'Search everything')} aria-label={t('搜索关键词', 'Search keywords')} role="combobox" autoComplete="off" spellCheck={false}
        aria-expanded={results.length > 0} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={results.length ? `${listId}-${selected}` : undefined} />
      <button type="button" className="ngs-close" aria-label={t('关闭搜索', 'Close search')} onClick={onClose}>Esc</button>
    </div>
    {query.trim() ? <>
      <div className="ngs-result-count" role="status">{results.length ? t(`${results.length} 个结果`, `${results.length} ${results.length === 1 ? 'result' : 'results'}`) : t('没有匹配内容', 'No matches')}</div>
      <div id={listId} className="ngs-results" role="listbox" aria-label={t('搜索结果', 'Search results')}>
        {results.map((result, position) => <button type="button" role="option" tabIndex={-1} id={`${listId}-${position}`} data-search-index={position}
          key={result.id} className={`ngs-result${position === selected ? ' is-current' : ''}`} aria-selected={position === selected}
          onPointerMove={() => { if (position !== selected) setActive(position); }} onClick={() => choose(result)}>
          <span className={`ngs-result-icon ngs-${result.type}`} title={labels[result.type]}><Icon name={icons[result.type]} /></span>
          <span className="ngs-result-content"><strong><Highlight text={result.title} query={query} /></strong>
            <span className="ngs-result-path"><Highlight text={result.path.length ? result.path.join(' / ') : labels[result.type]} query={query} /></span>
            {result.snippet && <span className="ngs-result-snippet"><Highlight text={result.snippet} query={query} /></span>}
          </span><span className="ngs-result-enter" aria-hidden="true">↵</span>
        </button>)}
      </div>
    </> : <div className="ngs-empty">{t('书籍、章节、正文、随笔与参考资料', 'Books, chapters, content, and notes')}</div>}
  </dialog>;
}
