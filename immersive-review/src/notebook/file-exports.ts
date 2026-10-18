import { bodyFor, collectionPath, noteTitle, rootCollections } from './content';
import { isCollectionDeleted, type NotebookState } from './store';
import { ASSISTANT_HISTORY_KEY } from './assistant-history';

const PREFERENCE_KEYS = ['read-appearance', 'read-components-open', 'read-components-compact', 'read-components-syntax', 'read-assistant-model-v1', 'read-assistant-style-v1', 'read-assistant-width-v1'];

/** Explicit fields only: never export unrelated browser data or server credentials. */
export function dataCopy(state: NotebookState, storage: Pick<Storage, 'getItem'>, now = new Date()) {
  const preferences = Object.fromEntries(PREFERENCE_KEYS.flatMap(key => {
    const value = storage.getItem(key); return value === null ? [] : [[key, value]];
  }));
  const history = storage.getItem(ASSISTANT_HISTORY_KEY);
  return JSON.stringify({ format: 'read-data-copy', version: 1, exportedAt: now.toISOString(),
    workspace: { notes: state.notes, collections: state.collections, draft: state.draft, legacyDrafts: state.legacyDrafts, deletedContent: state.deletedContent },
    memory: { entries: state.entries, settings: state.settings },
    assistantHistory: history ? JSON.parse(history) : null, preferences,
  }, null, 2);
}

export function markdownExport(state: NotebookState): string {
  const output: string[] = ['# Read'];
  const visited = new Set<string>();
  const includedNotes = new Set<string>();
  const appendBook = (id: string) => {
    if (visited.has(id) || isCollectionDeleted(id, state)) return;
    visited.add(id);
    const book = state.collections.find(item => item.id === id);
    if (!book) return;
    output.push(`## ${collectionPath(id, state).map(item => item.title.replace(/[\r\n]+/g, ' ')).join(' / ')}${book.archivedAt ? '（已归档）' : ''}`);
    if (book.summary?.trim()) output.push(book.summary);
    for (const item of book.items) {
      if (item.kind === 'chapter') appendBook(item.id);
      else {
        const body = bodyFor(item, state);
        if (body.trim()) output.push(body);
        if (item.kind === 'note') includedNotes.add(item.id);
      }
    }
  };
  rootCollections(state, true).forEach(book => appendBook(book.id));
  const deleted = new Set(state.deletedContent.flatMap(item => item.kind === 'content' && item.ref.kind === 'note' ? [item.ref.id] : []));
  for (const book of state.collections) {
    if (isCollectionDeleted(book.id, state)) for (const item of book.items) if (item.kind === 'note') deleted.add(item.id);
  }
  const remaining = state.notes.filter(note => !includedNotes.has(note.id) && !deleted.has(note.id));
  if (remaining.length) output.push('## 随笔与未归类内容');
  for (const note of remaining) {
    output.push(`### ${noteTitle(note.markdown)}${note.archivedAt ? '（已归档）' : ''}`);
    if (note.source) output.push(`> 引用：${note.source.path.join(' / ')}\n>\n${note.source.quote.split('\n').map(line => `> ${line}`).join('\n')}`);
    if (note.markdown.trim()) output.push(note.markdown);
  }
  return `${output.join('\n\n---\n\n')}\n`;
}

export function exportFilename(extension: 'md' | 'json', now = new Date()) {
  return `read-${now.toISOString().replace(/[:.]/g, '-')}.${extension}`;
}
