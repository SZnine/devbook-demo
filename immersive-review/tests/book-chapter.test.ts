import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import * as notebook from '../src/notebook/store';
import { collectionKind, collectionPath, isCollectionArchived, rootCollections } from '../src/notebook/content';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

const chapterRef = (id: string): notebook.ChapterRef => ({ kind: 'chapter', id });

describe('book and chapter roles', () => {
  it('keeps an introductory text in a book while identifying its chapters by their actual parent', async () => {
    const book = await notebook.createCollection('AI 应用与 Agent');
    const introduction = await notebook.createNoteInCollection(book.id, '# 阅读说明\n\n从一个问题开始。');
    const chapter = await notebook.createCollection('异步编程', book.id);
    const section = await notebook.createCollection('取消与超时', chapter.id);
    const state = await notebook.loadNotebook();

    expect(collectionKind(book.id, state)).toBe('book');
    expect(collectionKind(chapter.id, state)).toBe('chapter');
    expect(collectionKind(section.id, state)).toBe('chapter');
    expect(collectionPath(section.id, state).map(item => item.id)).toEqual([book.id, chapter.id, section.id]);
    expect(rootCollections(state).map(item => item.id)).toEqual([book.id]);
    expect(state.collections.find(item => item.id === book.id)?.items).toEqual([
      { kind: 'note', id: introduction.id }, chapterRef(chapter.id),
    ]);
  });

  it('updates the path after moving a chapter to another book without changing its contents or descendants', async () => {
    const first = await notebook.createCollection('Python');
    const second = await notebook.createCollection('工程实践');
    const chapter = await notebook.createCollection('异步任务', first.id);
    const section = await notebook.createCollection('取消', chapter.id);
    const note = await notebook.createNoteInCollection(section.id, '取消信号需要向下传播。');
    await notebook.moveContent({ from: first.id, to: second.id, refs: [chapterRef(chapter.id)] });
    const state = await notebook.loadNotebook();

    expect(collectionKind(chapter.id, state)).toBe('chapter');
    expect(collectionKind(second.id, state)).toBe('book');
    expect(collectionPath(section.id, state).map(item => item.id)).toEqual([second.id, chapter.id, section.id]);
    expect(state.collections.find(item => item.id === first.id)?.items).toEqual([]);
    expect(state.notes).toEqual([note]);
  });

  it('promotes a chapter to a book and can place that book inside another book without copying content', async () => {
    const book = await notebook.createCollection('训练手册');
    const chapter = await notebook.createCollection('服务治理', book.id);
    const section = await notebook.createCollection('超时预算', chapter.id);
    const note = await notebook.createNoteInCollection(chapter.id, '为每一层设置明确的时间预算。');
    await notebook.moveContent({ from: book.id, to: null, refs: [chapterRef(chapter.id)] });
    let state = await notebook.loadNotebook();

    expect(collectionKind(chapter.id, state)).toBe('book');
    expect(collectionKind(section.id, state)).toBe('chapter');
    expect(collectionPath(section.id, state).map(item => item.id)).toEqual([chapter.id, section.id]);
    expect(rootCollections(state).map(item => item.id)).toEqual([book.id, chapter.id]);

    await notebook.moveChapter(chapter.id, book.id);
    state = await notebook.loadNotebook();
    expect(collectionKind(chapter.id, state)).toBe('chapter');
    expect(collectionPath(section.id, state).map(item => item.id)).toEqual([book.id, chapter.id, section.id]);
    expect(state.notes).toEqual([note]);
    expect(state.entries).toEqual([]);
  });

  it('retains book and chapter roles and paths while either level is archived and restored', async () => {
    const book = await notebook.createCollection('学习札记');
    const chapter = await notebook.createCollection('实验', book.id);
    await notebook.archiveCollection(chapter.id);
    await notebook.archiveCollection(book.id);
    let state = await notebook.loadNotebook();

    expect(collectionKind(book.id, state)).toBe('book');
    expect(collectionKind(chapter.id, state)).toBe('chapter');
    expect(collectionPath(chapter.id, state).map(item => item.id)).toEqual([book.id, chapter.id]);
    expect(rootCollections(state)).toEqual([]);
    expect(rootCollections(state, true).map(item => item.id)).toEqual([book.id]);

    await notebook.restoreCollection(chapter.id);
    state = await notebook.loadNotebook();
    expect(collectionKind(chapter.id, state)).toBe('chapter');
    expect(isCollectionArchived(chapter.id, state)).toBe(true);
    await notebook.restoreCollection(book.id);
    state = await notebook.loadNotebook();
    expect(isCollectionArchived(chapter.id, state)).toBe(false);
    expect(collectionPath(chapter.id, state).map(item => item.id)).toEqual([book.id, chapter.id]);
    expect(rootCollections(state).map(item => item.id)).toEqual([book.id]);
  });

  it('returns a finite nonrepeating path for corrupt cycles and an empty path for an unknown item', () => {
    const state: Pick<notebook.NotebookState, 'collections'> = {
      collections: [
        { id: 'a', title: 'A', items: [chapterRef('b')] },
        { id: 'b', title: 'B', items: [chapterRef('a')] },
      ],
    };
    expect(collectionPath('missing', state)).toEqual([]);
    expect(collectionPath('a', state).map(item => item.id)).toEqual(['b', 'a']);
    expect(collectionPath('b', state).map(item => item.id)).toEqual(['a', 'b']);
  });
});
