import { IS_DEMO_MODE } from '../demo';
import { t } from '../i18n';
import { collectionPath, isCollectionArchived, manual, noteTitle, refKey, shortTitle } from './content';
import type { NotebookState, Ref } from './store';
import core from '../manual-demo/research/core.json';
import applied from '../manual-demo/research/applied.json';
import supplemental from '../manual-demo/research/supplemental.json';

export type GlobalSearchState = Pick<NotebookState, 'notes' | 'collections'>;
export type GlobalSearchTarget =
  | { kind: 'collection'; collectionId: string; ref?: Ref; summary?: true }
  | { kind: 'memo'; memoId: string }
  | { kind: 'manual'; topicId?: string; sectionId?: string };
export type GlobalSearchEntry = {
  id: string;
  type: 'book' | 'chapter' | 'content' | 'memo' | 'reference';
  title: string;
  path: string[];
  body: string;
  target: GlobalSearchTarget;
};
export type GlobalSearchResult = Omit<GlobalSearchEntry, 'body'> & { snippet: string; score: number };
type SearchCatalog = {
  title: string;
  topics: { id: string; title: string; sectionIds: string[] }[];
  sections: { id: string; title: string; parts: { markdown: string }[] }[];
};

const additions = new Map([core, applied, supplemental].flatMap(file => file.reviews)
  .map(review => [review.sectionId, review.additions.map(item => `${item.title}\n${item.body}`).join('\n\n')]));

/** Index persisted, active content across the workspace; never the current page filter. */
export function createSearchIndex(state: GlobalSearchState, catalog: SearchCatalog = IS_DEMO_MODE ? { title: '', topics: [], sections: [] } : manual): GlobalSearchEntry[] {
  const entries: GlobalSearchEntry[] = [];
  const notes = new Map(state.notes.map(note => [note.id, note]));
  const sections = new Map(catalog.sections.map(section => [section.id, section]));
  for (const collection of state.collections) {
    if (isCollectionArchived(collection.id, state)) continue;
    const path = collectionPath(collection.id, state).map(item => item.title);
    entries.push({ id: `collection:${collection.id}`, type: path.length > 1 ? 'chapter' : 'book',
      title: collection.title, path: path.slice(0, -1), body: collection.summary ?? '',
      target: { kind: 'collection', collectionId: collection.id, ...(collection.summary ? { summary: true } : {}) } });
    for (const ref of collection.items) {
      if (ref.kind === 'chapter') continue;
      const note = ref.kind === 'note' ? notes.get(ref.id) : undefined;
      const section = ref.kind === 'section' ? sections.get(ref.id) : undefined;
      if (ref.kind === 'note' && (!note || note.archivedAt !== undefined) || ref.kind === 'section' && !section) continue;
      const body = note?.markdown ?? section?.parts.map(part => part.markdown).join('\n\n') ?? '';
      entries.push({ id: `content:${collection.id}:${refKey(ref)}`, type: 'content',
        title: collection.titles?.[refKey(ref)] || (section ? shortTitle(section.title) : noteTitle(body)),
        path, body, target: { kind: 'collection', collectionId: collection.id, ref } });
    }
  }
  for (const note of state.notes) {
    if (note.kind === 'document' || note.archivedAt !== undefined) continue;
    entries.push({ id: `memo:${note.id}`, type: 'memo', title: noteTitle(note.markdown || note.source?.quote || ''),
      path: [t('随笔', 'Notes'), ...(note.source?.path ?? [])], body: [note.markdown, note.source?.quote].filter(Boolean).join('\n\n'),
      target: { kind: 'memo', memoId: note.id } });
  }
  if (catalog.title) entries.push({ id: 'manual', type: 'reference', title: catalog.title, path: [t('参考资料', 'Reference')], body: '', target: { kind: 'manual' } });
  const topics = new Map(catalog.topics.flatMap(topic => topic.sectionIds.map(id => [id, topic] as const)));
  for (const topic of catalog.topics) entries.push({ id: `manual-topic:${topic.id}`, type: 'chapter', title: topic.title,
    path: [t('参考资料', 'Reference'), catalog.title], body: '', target: { kind: 'manual', topicId: topic.id } });
  for (const section of catalog.sections) {
    const topic = topics.get(section.id);
    entries.push({ id: `manual-section:${section.id}`, type: 'reference', title: shortTitle(section.title),
      path: [t('参考资料', 'Reference'), catalog.title, ...(topic ? [topic.title] : [])],
      body: [...section.parts.map(part => part.markdown), ...(catalog === manual ? [additions.get(section.id) ?? ''] : [])].join('\n\n'),
      target: { kind: 'manual', ...(topic ? { topicId: topic.id } : {}), sectionId: section.id } });
  }
  return entries;
}

export function keywordTokens(query: string): string[] {
  return [...new Set(query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean))];
}

function readableText(markdown: string): string {
  return markdown.replace(/^\s*(`{3,}|~{3,})[^\n]*$/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, '')
    .replace(/`|\*\*/g, '').replace(/\s+/g, ' ').trim();
}

function excerpt(body: string, tokens: string[], size = 160): string {
  const text = readableText(body);
  if (text.length <= size) return text;
  const lower = text.toLocaleLowerCase();
  const positions = tokens.map(token => lower.indexOf(token)).filter(index => index >= 0);
  const start = Math.max(0, (positions.length ? Math.min(...positions) : 0) - 40);
  return `${start ? '…' : ''}${text.slice(start, start + size).trim()}${start + size < text.length ? '…' : ''}`;
}

export function searchKeywordIndex(index: readonly GlobalSearchEntry[], query: string): GlobalSearchResult[] {
  const tokens = keywordTokens(query);
  if (!tokens.length) return [];
  const phrase = query.trim().toLocaleLowerCase();
  return index.flatMap(entry => {
    const title = entry.title.toLocaleLowerCase();
    const path = entry.path.join(' ').toLocaleLowerCase();
    const body = entry.body.toLocaleLowerCase();
    const searchable = `${title}\n${path}\n${body}\n${readableText(entry.body).toLocaleLowerCase()}`;
    if (!tokens.every(token => searchable.includes(token))) return [];
    const score = (title === phrase ? 500 : title.includes(phrase) ? 200 : 0)
      + (tokens.every(token => title.includes(token)) ? 100 : 0)
      + tokens.reduce((sum, token) => sum + (title.includes(token) ? 60 : path.includes(token) ? 8 : 3), 0);
    const { body: _body, ...result } = entry;
    return [{ ...result, snippet: excerpt(entry.body, tokens), score }];
  }).sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, 'zh-CN') || left.id.localeCompare(right.id));
}

/** Text runs, not HTML: both stored text and query remain escaped by React. */
export function highlightMatches(text: string, query: string): { text: string; match: boolean }[] {
  const tokens = keywordTokens(query);
  if (!tokens.length) return [{ text, match: false }];
  const lower = text.toLocaleLowerCase();
  const ranges: [number, number][] = [];
  for (const token of tokens) {
    let start = lower.indexOf(token);
    while (start !== -1) {
      ranges.push([start, start + token.length]);
      start = lower.indexOf(token, start + token.length);
    }
  }
  ranges.sort((left, right) => left[0] - right[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  const runs: { text: string; match: boolean }[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) runs.push({ text: text.slice(cursor, start), match: false });
    runs.push({ text: text.slice(start, end), match: true }); cursor = end;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), match: false });
  return runs;
}
