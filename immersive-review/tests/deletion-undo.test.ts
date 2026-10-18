import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type * as Store from '../src/notebook/store';

let store: typeof Store;
const ref = (id: string): Store.Ref => ({ kind: 'note', id });

beforeEach(async () => {
  vi.restoreAllMocks();
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  store = await import('../src/notebook/store');
});

describe('session deletion undo', () => {
  it('undoes queued deletions in reverse order and preserves unrelated later edits and drafts', async () => {
    const book = await store.createCollection('书籍');
    const chapter = await store.createCollection('章节', book.id);
    const first = await store.createNoteInCollection(chapter.id, '第一段');
    const second = await store.createNoteInCollection(chapter.id, '第二段');
    await store.saveCollectionSummary(chapter.id, '**章节摘要**');
    await store.renameItem(chapter.id, ref(first.id), '原正文标题');
    await store.enrollRef(ref(first.id));
    await store.readRef(ref(first.id));
    const before = await store.loadNotebook();
    await store.deleteCollectionSummary(chapter.id);
    await store.deleteContent(chapter.id, ref(first.id));
    await store.trashCollection(chapter.id);
    await store.trashCollection(book.id);
    const memo = await store.saveNote({ markdown: '删除后新增的独立随笔' });
    await store.saveDraft({ markdown: '删除后的未完成草稿' });

    const undone = await Promise.all(Array.from({ length: 4 }, () => store.undoLastDeletion()));
    expect(undone.map(item => [item?.kind, item?.collectionId])).toEqual([
      ['collection', book.id], ['collection', chapter.id], ['content', chapter.id], ['summary', chapter.id],
    ]);
    const state = await store.loadNotebook();
    expect(state.collections).toEqual(before.collections);
    expect(state.collections.find(item => item.id === chapter.id)?.items).toEqual([ref(first.id), ref(second.id)]);
    expect(state.entries).toEqual(before.entries);
    expect(state.notes.find(item => item.id === memo.id)?.markdown).toBe(memo.markdown);
    expect(state.draft.markdown).toBe('删除后的未完成草稿');
    expect(state.deletedContent).toEqual([]);
    expect(store.peekDeletionUndo()).toBeUndefined();
    expect(await store.undoLastDeletion()).toBeUndefined();
  });

  it('handles an undo queued before the deletion write finishes without duplicating the restored body', async () => {
    const book = await store.createCollection('书籍');
    const body = await store.createNoteInCollection(book.id, '正文');
    const deleting = store.deleteContent(book.id, ref(body.id));
    const undoing = store.undoLastDeletion();
    const extraShortcut = store.undoLastDeletion();
    const removed = await deleting;
    expect(await undoing).toMatchObject({ kind: 'content', id: removed.id, collectionId: book.id });
    expect(await extraShortcut).toBeUndefined();
    expect((await store.loadNotebook()).collections[0].items).toEqual([ref(body.id)]);
  });

  it('forgets manually restored deletions and does not let failed deletion attempts replace the undo target', async () => {
    const book = await store.createCollection('书籍');
    const body = await store.createNoteInCollection(book.id, '正文');
    const removed = await store.deleteContent(book.id, ref(body.id));
    await store.trashCollection(book.id);
    await store.restoreDeletedCollection(book.id);
    expect(store.peekDeletionUndo()?.id).toBe(removed.id);
    await expect(store.deleteContent(book.id, ref(body.id))).rejects.toThrow('已被删除');
    expect(store.peekDeletionUndo()?.id).toBe(removed.id);
    await store.restoreDeletedContent(removed.id);
    expect(store.peekDeletionUndo()).toBeUndefined();
    expect(await store.undoLastDeletion()).toBeUndefined();
  });

  it('retains conflicting summary undo without overwriting new content, then allows retry', async () => {
    const book = await store.createCollection('书籍');
    await store.saveCollectionSummary(book.id, '原摘要');
    const removed = await store.deleteCollectionSummary(book.id);
    await store.saveCollectionSummary(book.id, '后来写的摘要');
    const before = await store.loadNotebook();
    await expect(store.undoLastDeletion()).rejects.toThrow('当前已有摘要');
    expect(await store.loadNotebook()).toEqual(before);
    expect(store.peekDeletionUndo()).toMatchObject({ id: removed.id, kind: 'summary', deletedAt: removed.deletedAt });
    await store.saveCollectionSummary(book.id, '');
    await store.undoLastDeletion();
    expect((await store.loadNotebook()).collections[0].summary).toBe('原摘要');
  });

  it('skips deletions restored by another store session without undoing a later external deletion', async () => {
    const book = await store.createCollection('书籍');
    const another = await store.createCollection('其他书籍');
    const body = await store.createNoteInCollection(book.id, '正文');
    const removed = await store.deleteContent(book.id, ref(body.id));
    await store.trashCollection(another.id);
    const original = store;
    vi.resetModules();
    const otherSession = await import('../src/notebook/store');
    await otherSession.restoreDeletedCollection(another.id);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(removed.deletedAt + 1000);
    await otherSession.trashCollection(another.id);
    clock.mockRestore();
    expect(await original.undoLastDeletion()).toMatchObject({ id: removed.id });
    expect(original.peekDeletionUndo()).toBeUndefined();
    const state = await original.loadNotebook();
    expect(state.collections.find(item => item.id === book.id)?.items).toEqual([ref(body.id)]);
    expect(state.collections.find(item => item.id === another.id)?.deletedAt).toBe(removed.deletedAt + 1000);
  });

  it('notifies only committed changes and isolates listener failures from a successful deletion', async () => {
    const book = await store.createCollection('书籍');
    const snapshots: Array<Store.DeletionUndo | undefined> = [];
    const unsubscribe = store.subscribeDeletionUndo(() => snapshots.push(store.peekDeletionUndo()));
    const stopBroken = store.subscribeDeletionUndo(() => { throw new Error('UI listener error'); });
    await expect(store.deleteCollectionSummary(book.id)).rejects.toThrow('已经为空');
    expect(snapshots).toEqual([]);
    await store.trashCollection(book.id);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ kind: 'collection', id: book.id, title: '书籍' });
    const external = store.peekDeletionUndo()!;
    external.id = 'cannot-change-history';
    await store.undoLastDeletion();
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toBeUndefined();
    unsubscribe(); stopBroken();
    await store.trashCollection(book.id);
    expect(snapshots).toHaveLength(2);
  });
});

describe('formatted memo citations', () => {
  it('preserves a Markdown source through drafts, save, and book import', async () => {
    const book = await store.createCollection('来源书籍');
    const body = await store.createNoteInCollection(book.id, '```python\nprint("hello")\n```');
    const source: Store.MemoSource = {
      kind: 'content', collectionId: book.id, ref: ref(body.id), title: '代码', path: ['来源书籍'],
      quote: body.markdown, quoteFormat: 'markdown', capturedAt: 1000,
    };
    await store.saveDraft({ markdown: '', source });
    expect((await store.loadNotebook()).draft.source?.quoteFormat).toBe('markdown');
    const memo = await store.createMemoFromContent({ source });
    expect(memo.source).toEqual(source);
    const target = await store.createCollection('整理书籍');
    const imported = await store.copyIntoCollection({ to: target.id, refs: [ref(memo.id)] });
    const state = await store.loadNotebook();
    expect(state.notes.find(item => item.id === imported.items[0].id)?.markdown).toBe('> ```python\n> print("hello")\n> ```\n\n出处：来源书籍 / 代码');
    expect(state.notes.find(item => item.id === imported.items[0].id)?.source?.quoteFormat).toBe('markdown');
    await expect(store.saveDraft({ markdown: '', source: { ...source, quoteFormat: 'html' as 'markdown' } })).rejects.toThrow('引用格式');
  });
});
