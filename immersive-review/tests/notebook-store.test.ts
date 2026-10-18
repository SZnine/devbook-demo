import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import * as notebook from '../src/notebook/store';
import * as legacy from '../src/manual-demo/business-store';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

describe('Memos notebook persistence', () => {
  it('persists clearing an existing note without losing its identity or collection reference, while rejecting empty new notes', async () => {
    const book = await notebook.createCollection('训练手册');
    const note = await notebook.createNoteInCollection(book.id, '需要删去的正文');
    const cleared = await notebook.saveNote({ id: note.id, markdown: '' }, note.updatedAt + 1);

    expect(cleared.id).toBe(note.id);
    expect(cleared.createdAt).toBe(note.createdAt);
    expect(cleared.markdown).toBe('');
    const reloaded = await notebook.loadNotebook();
    expect(reloaded.notes).toEqual([cleared]);
    expect(reloaded.collections.find(item => item.id === book.id)?.items).toEqual([{ kind: 'note', id: note.id }]);
    await expect(notebook.saveNote({ markdown: '' })).rejects.toThrow('内容');
    await expect(notebook.saveNote({ markdown: '  \n\t' })).rejects.toThrow('内容');
    await expect(notebook.createNoteInCollection(book.id, '')).rejects.toThrow('内容');
    expect(await notebook.loadNotebook()).toEqual(reloaded);
  });

  it('starts with no fabricated notes or collections and persists a Markdown draft/save/edit', async () => {
    expect((await notebook.loadNotebook()).notes).toEqual([]);
    expect((await notebook.loadNotebook()).collections).toEqual([]);
    const markdown = '# 随笔\n\n```ts\nconst value = 1;\n```\n';
    await notebook.saveDraft({ markdown });
    expect((await notebook.loadNotebook()).draft.markdown).toBe(markdown);
    const saved = await notebook.saveNote({ markdown }, 1000);
    let state = await notebook.loadNotebook();
    expect(state.notes).toEqual([saved]);
    expect(state.draft).toEqual({ markdown: '' });
    await notebook.saveDraft({ markdown: '修改草稿', editingId: saved.id });
    const edited = await notebook.saveNote({ id: saved.id, markdown: '修改后' }, 2000);
    state = await notebook.loadNotebook();
    expect(state.notes).toEqual([edited]);
    expect(edited.createdAt).toBe(1000);
    expect(edited.updatedAt).toBe(2000);
    expect(state.draft).toEqual({ markdown: '' });
  });

  it('copies legacy real memos and all drafts exactly once without changing legacy storage', async () => {
    const one = await legacy.saveMemo({ sectionId: 'py01', markdown: '原随笔' }, 1000);
    const two = await legacy.saveMemo({ sectionId: 'py02', markdown: '归档随笔' }, 2000);
    await legacy.archiveMemo(two.id);
    await legacy.saveDraft({ sectionId: 'py01', markdown: '待编辑', editingId: one.id });
    await legacy.saveDraft({ sectionId: 'py02', markdown: '另一节未保存' });
    const before = await legacy.loadBusiness();
    const migrated = await notebook.loadNotebook();
    expect(migrated.notes).toHaveLength(2);
    expect(migrated.notes.find(item => item.id === one.id)).toEqual({ id: one.id, markdown: one.markdown, createdAt: 1000, updatedAt: 1000, sourceSectionId: 'py01' });
    expect(migrated.notes.find(item => item.id === two.id)?.archivedAt).toBeTypeOf('number');
    expect(migrated.legacyDrafts).toEqual(before.drafts);
    expect(migrated.draft.markdown).toBe('');
    await notebook.saveNote({ id: one.id, markdown: '迁移后编辑' }, 3000);
    const reloaded = await notebook.loadNotebook();
    expect(reloaded.notes).toHaveLength(2);
    expect(reloaded.notes.find(item => item.id === one.id)?.markdown).toBe('迁移后编辑');
    expect(await legacy.loadBusiness()).toEqual(before);
  });

  it('organizes references and order without copying content, and updates every reference through one note', async () => {
    const note = await notebook.saveNote({ markdown: '单一正文' }, 1000);
    const first = await notebook.createCollection(' 第一辑 ');
    const second = await notebook.createCollection('第二辑');
    const noteRef: notebook.Ref = { kind: 'note', id: note.id };
    const sectionRef: notebook.Ref = { kind: 'section', id: 'py01' };
    await notebook.addToCollection(first.id, noteRef);
    await notebook.addToCollection(first.id, noteRef);
    await notebook.addToCollection(first.id, sectionRef);
    await notebook.addToCollection(second.id, noteRef);
    let state = await notebook.loadNotebook();
    expect(state.notes).toHaveLength(1);
    expect(state.collections[0].items).toEqual([noteRef, sectionRef]);
    expect(state.collections[0].title).toBe('第一辑');
    expect((await notebook.moveInCollection(first.id, sectionRef, -1)).items).toEqual([sectionRef, noteRef]);
    expect((await notebook.moveInCollection(first.id, sectionRef, -1)).items).toEqual([sectionRef, noteRef]);
    await notebook.renameCollection(second.id, '已重命名');
    await notebook.removeFromCollection(first.id, noteRef);
    await notebook.saveNote({ id: note.id, markdown: '正文已更新' }, 2000);
    state = await notebook.loadNotebook();
    expect(state.collections[0].items).toEqual([sectionRef]);
    expect(state.collections[1]).toEqual({ ...second, title: '已重命名', items: [noteRef] });
    expect(state.notes).toHaveLength(1);
    expect(state.notes[0].markdown).toBe('正文已更新');
  });

  it('retains memory events across content edits and reenrollment, while stages are derived from current content', async () => {
    const note = await notebook.saveNote({ markdown: '最初内容' }, 1000);
    const ref: notebook.Ref = { kind: 'note', id: note.id };
    await notebook.enrollRef(ref);
    let state = await notebook.loadNotebook();
    expect(notebook.getProjection(ref, state).level).toBe('new');
    expect(notebook.getProjection(ref, state).retention).toBeNull();
    const read = await notebook.readRef(ref);
    state = await notebook.loadNotebook();
    expect(notebook.getProjection(ref, state, read.events[0].at).level).toBe('steady');
    expect(notebook.getProjection(ref, state, read.events[0].at + 3_600_000).level).toBe('steady');
    expect(notebook.getProjection(ref, state, read.events[0].at + 6 * 3_600_000).freshness).toBeCloseTo(.5);
    expect(notebook.getProjection(ref, state, read.events[0].at + 86_400_000).level).toBe('due');
    await notebook.saveNote({ id: note.id, markdown: '全新内容' }, 2000);
    state = await notebook.loadNotebook();
    expect(state.entries[0].events).toEqual(read.events);
    expect(notebook.getProjection(ref, state).versionChanged).toBe(true);
    expect(notebook.getProjection(ref, state).totalReadCount).toBe(1);
    expect(notebook.getProjection(ref, state).retention).toBeNull();
    await notebook.removeRef(ref);
    await expect(notebook.readRef(ref)).rejects.toThrow('纳入记忆库');
    expect((await notebook.enrollRef(ref)).events).toEqual(read.events);
  });

  it('reuses existing section memory identity and does not record on organization or draft changes', async () => {
    await legacy.enroll('py01');
    const entry = await legacy.recordRead('py01');
    const ref: notebook.Ref = { kind: 'section', id: 'py01' };
    const collection = await notebook.createCollection('训练');
    await notebook.addToCollection(collection.id, ref);
    await notebook.saveDraft({ markdown: '只是输入' });
    let state = await notebook.loadNotebook();
    expect(notebook.getProjection(ref, state).entry).toEqual(entry);
    expect(notebook.getProjection(ref, state).totalReadCount).toBe(1);
    await notebook.readRef(ref);
    state = await notebook.loadNotebook();
    expect(notebook.getProjection(ref, state).totalReadCount).toBe(1);
    expect((await legacy.loadBusiness()).entries[0].events).toEqual(entry.events);
  });

  it('keeps archived notes and their collection references recoverable, and serializes overlapping saves', async () => {
    const draft = notebook.saveDraft({ markdown: '保存前' });
    const save = notebook.saveNote({ markdown: '已保存' }, 1000);
    await draft;
    const note = await save;
    expect((await notebook.loadNotebook()).draft.markdown).toBe('');
    const collection = await notebook.createCollection('稍后读');
    const ref: notebook.Ref = { kind: 'note', id: note.id };
    await notebook.addToCollection(collection.id, ref);
    await notebook.archiveNote(note.id);
    await expect(notebook.saveNote({ id: note.id, markdown: '修改' })).rejects.toThrow('恢复');
    await expect(notebook.enrollRef(ref)).rejects.toThrow('恢复');
    expect((await notebook.loadNotebook()).collections[0].items).toEqual([ref]);
    const restored = await notebook.restoreNote(note.id);
    expect(restored.archivedAt).toBeUndefined();
    expect(restored.markdown).toBe('已保存');
    await expect(notebook.saveNote({ markdown: '  ' })).rejects.toThrow('内容');
    await expect(notebook.addToCollection(collection.id, { kind: 'section', id: 'missing' })).rejects.toThrow('不存在');
    await notebook.saveDraft({ markdown: '失败后仍可写入' });
    expect((await notebook.loadNotebook()).draft.markdown).toBe('失败后仍可写入');
  });

  it('moves references and aliases atomically without changing Markdown or memory, including archived notes', async () => {
    const note = await notebook.saveNote({ markdown: '不能被整理修改的原文' }, 1000);
    const ref: notebook.Ref = { kind: 'note', id: note.id };
    const section: notebook.Ref = { kind: 'section', id: 'py01' };
    const source = await notebook.createCollection('来源');
    const target = await notebook.createCollection('目标');
    await notebook.addToCollection(source.id, ref);
    await notebook.addToCollection(source.id, section);
    await notebook.renameItem(source.id, ref, '我的阅读标题');
    await notebook.enrollRef(ref);
    const memory = await notebook.readRef(ref);
    await notebook.archiveNote(note.id);
    const before = await notebook.loadNotebook();
    await expect(notebook.transferItems({ from: source.id, to: target.id, refs: [ref, { kind: 'section', id: 'py02' }], mode: 'move' })).rejects.toThrow('来源');
    expect(await notebook.loadNotebook()).toEqual(before);
    const changed = await notebook.transferItems({ from: source.id, to: target.id, refs: [ref], mode: 'move' });
    expect(changed).toHaveLength(2);
    const state = await notebook.loadNotebook();
    expect(state.collections.find(item => item.id === source.id)?.items).toEqual([section]);
    expect(state.collections.find(item => item.id === source.id)?.titles?.[`note:${note.id}`]).toBeUndefined();
    expect(state.collections.find(item => item.id === target.id)?.items).toEqual([ref]);
    expect(state.collections.find(item => item.id === target.id)?.titles?.[`note:${note.id}`]).toBe('我的阅读标题');
    expect(state.notes[0].markdown).toBe(note.markdown);
    expect(state.notes[0].archivedAt).toBeTypeOf('number');
    expect(state.entries[0]).toEqual(memory);
  });

  it('deduplicates copy/paste and reorders within a collection while preserving selected order', async () => {
    const source = await notebook.createCollection('来源');
    const target = await notebook.createCollection('目标');
    const a: notebook.Ref = { kind: 'section', id: 'py01' };
    const b: notebook.Ref = { kind: 'section', id: 'py02' };
    const c: notebook.Ref = { kind: 'section', id: 'py03' };
    await notebook.transferItems({ to: source.id, refs: [a, b, c], mode: 'move' });
    await notebook.renameItem(source.id, a, '标题 A');
    await notebook.addToCollection(target.id, c);
    await notebook.transferItems({ from: source.id, to: target.id, refs: [b, a, a], mode: 'copy', before: c });
    await notebook.transferItems({ from: source.id, to: target.id, refs: [a, b], mode: 'copy' });
    let state = await notebook.loadNotebook();
    expect(state.collections[0].items).toEqual([a, b, c]);
    expect(state.collections[1].items).toEqual([a, b, c]);
    expect(state.collections[1].titles?.['section:py01']).toBe('标题 A');
    await notebook.transferItems({ from: target.id, to: target.id, refs: [b, a], mode: 'move', before: b });
    expect((await notebook.loadNotebook()).collections[1].items).toEqual([a, b, c]);
    await notebook.transferItems({ from: target.id, to: target.id, refs: [b, a], mode: 'move' });
    state = await notebook.loadNotebook();
    expect(state.collections[1].items).toEqual([c, a, b]);
    await notebook.removeFromCollection(target.id, a);
    expect((await notebook.loadNotebook()).collections[1].titles?.['section:py01']).toBeUndefined();
  });
});
