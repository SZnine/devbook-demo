import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import * as store from '../src/notebook/store';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
const ref = (id: string): store.Ref => ({ kind: 'note', id });
const source = (collectionId: string, id: string): store.MemoSource => ({
  kind: 'content', collectionId, ref: ref(id), title: '原文标题', path: ['书籍', '章节'],
  quote: '选中的原文', before: '之前的上下文', after: '之后的上下文', capturedAt: 1000,
});

describe('separate book contents, source memos, and reversible deletion', () => {
  it('imports a memo as an independent document without inheriting or modifying its learning identity', async () => {
    const memo = await store.saveNote({ markdown: '原随笔' }, 1000);
    const book = await store.createCollection('书籍');
    await store.enrollRef(ref(memo.id));
    await store.readRef(ref(memo.id));
    const before = await store.loadNotebook();
    const collection = await store.copyIntoCollection({ to: book.id, refs: [ref(memo.id)] });
    const bodyId = collection.items[0].id;
    expect(bodyId).not.toBe(memo.id);
    await store.saveDocumentContent({ collectionId: book.id, id: bodyId, markdown: '整理后的书籍正文' });
    await store.saveNote({ id: memo.id, markdown: '另外修改的随笔' }, 2000);
    const state = await store.loadNotebook();
    expect(state.notes.find(note => note.id === bodyId)).toMatchObject({ kind: 'document', markdown: '整理后的书籍正文' });
    expect(state.notes.filter(store.isMemo)).toHaveLength(1);
    expect(state.notes.filter(store.isMemo)[0].markdown).toBe('另外修改的随笔');
    expect(state.entries).toEqual(before.entries);
    expect(store.getProjection(ref(bodyId), state).entry).toBeUndefined();
  });

  it('copies legacy shared content on first edit, routes queued old-id saves to the same copy, and suppresses saves after deletion', async () => {
    const memo = await store.saveNote({ markdown: '旧版共享的随笔' }, 1000);
    const first = await store.createCollection('第一本');
    const second = await store.createCollection('第二本');
    await store.addToCollection(first.id, ref(memo.id));
    await store.addToCollection(second.id, ref(memo.id));
    await store.renameItem(first.id, ref(memo.id), '原来的阅读标题');
    await store.enrollRef(ref(memo.id));
    await store.readRef(ref(memo.id));
    const before = await store.loadNotebook();
    const [copy, queued] = await Promise.all([
      store.saveDocumentContent({ collectionId: first.id, id: memo.id, markdown: '第一次输入' }),
      store.saveDocumentContent({ collectionId: first.id, id: memo.id, markdown: '后续输入' }),
    ]);
    expect(queued.id).toBe(copy.id);
    expect(copy.id).not.toBe(memo.id);
    let state = await store.loadNotebook();
    expect(state.notes).toHaveLength(2);
    expect(state.notes.find(note => note.id === memo.id)).toEqual(memo);
    expect(state.notes.find(note => note.id === copy.id)?.markdown).toBe('后续输入');
    expect(state.collections.find(item => item.id === second.id)?.items).toEqual([ref(memo.id)]);
    expect(state.collections.find(item => item.id === first.id)?.titles?.[`note:${copy.id}`]).toBe('原来的阅读标题');
    expect(state.entries).toEqual(before.entries);
    await store.deleteContent(first.id, ref(copy.id));
    state = await store.loadNotebook();
    await expect(store.saveDocumentContent({ collectionId: first.id, id: memo.id, markdown: '迟到的旧编辑器' })).rejects.toThrow('已被删除');
    await expect(store.saveDocumentContent({ collectionId: first.id, id: copy.id, markdown: '迟到的自动保存' })).rejects.toThrow('已被删除');
    await expect(store.saveNote({ id: copy.id, markdown: '旧调用也不能复活' })).rejects.toThrow('已被删除');
    expect(await store.loadNotebook()).toEqual(state);
  });

  it('trashes a book with its hierarchy intact, blocks writes into descendants, and restores content and learning records exactly', async () => {
    const book = await store.createCollection('书籍');
    const chapter = await store.createCollection('章节', book.id);
    const body = await store.createNoteInCollection(chapter.id, '已经学习的正文');
    await store.saveCollectionSummary(chapter.id, '原摘要');
    await store.enrollRef(ref(body.id));
    await store.readRef(ref(body.id));
    const before = await store.loadNotebook();
    await store.trashCollection(book.id);
    const deleted = await store.loadNotebook();
    expect(store.isCollectionDeleted(chapter.id, deleted)).toBe(true);
    expect(deleted.collections.find(item => item.id === chapter.id)?.deletedAt).toBeUndefined();
    expect(deleted.notes).toEqual(before.notes);
    expect(deleted.entries).toEqual(before.entries);
    await expect(store.saveCollectionSummary(chapter.id, '迟到的摘要保存')).rejects.toThrow('回收站');
    await expect(store.saveDocumentContent({ collectionId: chapter.id, id: body.id, markdown: '迟到的正文保存' })).rejects.toThrow('回收站');
    await expect(store.createCollection('错误新增', chapter.id)).rejects.toThrow('回收站');
    await expect(store.moveChapter(chapter.id, null)).rejects.toThrow('回收站');
    await expect(store.readRef(ref(body.id))).rejects.toThrow('已被删除');
    expect(await store.loadNotebook()).toEqual(deleted);
    await store.restoreDeletedCollection(book.id);
    expect(await store.loadNotebook()).toEqual(before);
  });

  it('keeps pre-existing child trash and archive flags distinct when restoring a parent', async () => {
    const book = await store.createCollection('书籍');
    const child = await store.createCollection('章节', book.id);
    await store.archiveCollection(book.id);
    await store.trashCollection(child.id);
    const childDeleted = (await store.loadNotebook()).collections.find(item => item.id === child.id)?.deletedAt;
    await store.trashCollection(book.id);
    await expect(store.restoreDeletedCollection(child.id)).rejects.toThrow('上级');
    await store.restoreDeletedCollection(book.id);
    const state = await store.loadNotebook();
    expect(state.collections.find(item => item.id === book.id)?.archivedAt).toBeTypeOf('number');
    expect(state.collections.find(item => item.id === child.id)?.deletedAt).toBe(childDeleted);
  });

  it('restores a removed body at its original position and keeps its title, identity, and study history', async () => {
    const book = await store.createCollection('书籍');
    const first = await store.createNoteInCollection(book.id, '第一段');
    const second = await store.createNoteInCollection(book.id, '第二段');
    await store.renameItem(book.id, ref(first.id), '第一段别名');
    await store.enrollRef(ref(first.id));
    await store.readRef(ref(first.id));
    const before = await store.loadNotebook();
    const removed = await store.deleteContent(book.id, ref(first.id));
    const deleted = await store.loadNotebook();
    expect(deleted.collections[0].items).toEqual([ref(second.id)]);
    expect(deleted.deletedContent).toEqual([removed]);
    expect(deleted.notes).toEqual(before.notes);
    expect(deleted.entries).toEqual(before.entries);
    await store.restoreDeletedContent(removed.id);
    expect(await store.loadNotebook()).toEqual(before);
  });

  it('recovers deleted summaries without overwriting newly written summaries', async () => {
    const book = await store.createCollection('书籍');
    await store.saveCollectionSummary(book.id, '**原摘要**\n\n保留格式');
    const removed = await store.deleteCollectionSummary(book.id);
    await store.saveCollectionSummary(book.id, '后来写的摘要');
    const before = await store.loadNotebook();
    await expect(store.restoreDeletedContent(removed.id)).rejects.toThrow('当前已有摘要');
    expect(await store.loadNotebook()).toEqual(before);
    await store.saveCollectionSummary(book.id, '');
    await store.restoreDeletedContent(removed.id);
    expect((await store.loadNotebook()).collections[0].summary).toBe('**原摘要**\n\n保留格式');
  });

  it('keeps a deleted body recoverable by refusing to remove its owning chapter through ungroup', async () => {
    const book = await store.createCollection('书籍');
    const chapter = await store.createCollection('章节', book.id);
    const body = await store.createNoteInCollection(chapter.id, '仍需要能恢复的正文');
    const deleted = await store.deleteContent(chapter.id, ref(body.id));
    const before = await store.loadNotebook();
    await expect(store.ungroupChapter(chapter.id)).rejects.toThrow('请先恢复该章节回收站中的内容');
    expect(await store.loadNotebook()).toEqual(before);
    await store.restoreDeletedContent(deleted.id);
    await store.ungroupChapter(chapter.id);
    const state = await store.loadNotebook();
    expect(state.collections.find(item => item.id === book.id)?.items).toEqual([ref(body.id)]);
    expect(state.notes.find(note => note.id === body.id)?.markdown).toBe('仍需要能恢复的正文');
    expect(state.deletedContent).toEqual([]);
  });

  it('saves source quotation/context with a separate memo, even when the source is later edited, renamed, and deleted', async () => {
    const book = await store.createCollection('书籍');
    const body = await store.createNoteInCollection(book.id, '之前的上下文\n\n选中的原文\n\n之后的上下文');
    const citation = source(book.id, body.id);
    await store.saveDraft({ markdown: '我对这段内容的理解', source: citation });
    expect((await store.loadNotebook()).draft.source).toEqual(citation);
    const memo = await store.createMemoFromContent({ source: citation, markdown: '我对这段内容的理解' });
    expect(memo.id).not.toBe(body.id);
    expect(memo.kind).toBe('memo');
    await store.saveDocumentContent({ collectionId: book.id, id: body.id, markdown: '原文后来已修改' });
    await store.renameCollection(book.id, '改名后的书籍');
    await store.deleteContent(book.id, ref(body.id));
    await store.trashCollection(book.id);
    await store.saveNote({ id: memo.id, markdown: '后来补充的个人理解' });
    const state = await store.loadNotebook();
    expect(state.notes.find(note => note.id === memo.id)).toMatchObject({ markdown: '后来补充的个人理解', source: citation });
    expect(state.notes.filter(store.isMemo)).toHaveLength(1);
    expect(state.draft).toEqual({ markdown: '' });
  });

  it('allows a quote-only memo, rejects malformed source metadata, and rolls back an invalid multi-item import', async () => {
    const book = await store.createCollection('书籍');
    const memo = await store.saveNote({ markdown: '源随笔' });
    const quoted = await store.createMemoFromContent({ source: source(book.id, memo.id) });
    expect(quoted.markdown).toBe('');
    const before = await store.loadNotebook();
    await expect(store.saveDraft({ markdown: '', source: { ...source(book.id, memo.id), quote: '' } })).rejects.toThrow('引用内容');
    await expect(store.copyIntoCollection({ to: book.id, refs: [ref(memo.id), ref('missing')] })).rejects.toThrow('不存在');
    expect(await store.loadNotebook()).toEqual(before);
  });

  it('keeps the captured heading section when replacing a quote draft and copying its saved memo', async () => {
    const book = await store.createCollection('上下文测试');
    const body = await store.createNoteInCollection(book.id, '## 第一节\n\n第一段\n\n## 第二节\n\n第二段');
    const first = { ...source(book.id, body.id), quote: '第一段', quoteFormat: 'markdown' as const, contextTitle: '第一节', contextMarkdown: '## 第一节\n\n第一段' };
    const second = { ...first, quote: '第二段', contextTitle: '第二节', contextMarkdown: '## 第二节\n\n第二段' };
    await store.saveDraft({ markdown: '我已经写下的想法', source: first });
    await store.saveDraft({ markdown: '我已经写下的想法', source: second });
    expect((await store.loadNotebook()).draft).toEqual({ markdown: '我已经写下的想法', source: second });
    const memo = await store.createMemoFromContent({ markdown: '我已经写下的想法', source: second });
    await store.saveDocumentContent({ collectionId: book.id, id: body.id, markdown: '原文后来改动' });
    const target = await store.createCollection('整理');
    const copied = await store.copyIntoCollection({ to: target.id, refs: [ref(memo.id)] });
    const state = await store.loadNotebook();
    expect(state.notes.find(note => note.id === memo.id)?.source).toEqual(second);
    expect(state.notes.find(note => note.id === copied.items[0].id)?.source).toEqual(second);
    await expect(store.saveDraft({ markdown: '', source: { ...second, contextMarkdown: 1 as unknown as string } })).rejects.toThrow('引用上下文');
  });

  it('imports quote-only and annotated memos as readable documents while leaving the original memos unchanged', async () => {
    const origin = await store.createCollection('来源书籍');
    const body = await store.createNoteInCollection(origin.id, '选中的原文');
    const citation = source(origin.id, body.id);
    const quoteOnly = await store.createMemoFromContent({ source: citation });
    const annotated = await store.createMemoFromContent({ source: citation, markdown: '## 我的理解\n\n这段内容的个人解释。' });
    const book = await store.createCollection('整理后的书籍');
    const before = await store.loadNotebook();
    const imported = await store.copyIntoCollection({ to: book.id, refs: [ref(quoteOnly.id), ref(annotated.id)] });
    let state = await store.loadNotebook();
    const first = state.notes.find(note => note.id === imported.items[0].id)!;
    const second = state.notes.find(note => note.id === imported.items[1].id)!;
    expect(first.markdown).toBe('> 选中的原文\n\n出处：书籍 / 章节 / 原文标题');
    expect(second.markdown).toBe('> 选中的原文\n\n出处：书籍 / 章节 / 原文标题\n\n## 我的理解\n\n这段内容的个人解释。');
    expect(first.source).toEqual(citation);
    expect(second.source).toEqual(citation);
    expect(state.notes.filter(store.isMemo)).toEqual(before.notes.filter(store.isMemo));
    // A second document copy keeps the already materialized quotation only once.
    const anotherBook = await store.createCollection('另一本书');
    const copiedAgain = await store.copyIntoCollection({ to: anotherBook.id, refs: [ref(second.id)] });
    state = await store.loadNotebook();
    expect(state.notes.find(note => note.id === copiedAgain.items[0].id)?.markdown).toBe(second.markdown);
    expect(state.notes.filter(store.isMemo)).toEqual(before.notes.filter(store.isMemo));
  });
});
