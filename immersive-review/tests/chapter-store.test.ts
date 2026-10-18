import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import * as notebook from '../src/notebook/store';
import { bodyFor, parentFor, rootCollections, titleFor } from '../src/notebook/content';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

const noteRef = (id: string): notebook.Ref => ({ kind: 'note', id });
const chapterRef = (id: string): notebook.ChapterRef => ({ kind: 'chapter', id });
const sectionRef = (id: string): notebook.Ref => ({ kind: 'section', id });

describe('locally authored chapters', () => {
  it('persists and clears summaries independently of notes, reading records, and the composer draft', async () => {
    const book = await notebook.createCollection('并发编程');
    const chapter = await notebook.createCollection('任务调度', book.id);
    const note = await notebook.createNoteInCollection(chapter.id, '原有正文');
    await notebook.saveDraft({ markdown: '尚未保存的随笔' });
    await notebook.enrollRef(noteRef(note.id));
    await notebook.readRef(noteRef(note.id));
    const before = await notebook.loadNotebook();
    const summary = '  本章讨论任务调度。\n\n保留作者的空行。  ';
    await notebook.saveCollectionSummary(book.id, '全书摘要');
    expect((await notebook.saveCollectionSummary(chapter.id, summary)).summary).toBe(summary);
    let state = await notebook.loadNotebook();
    expect(state.collections.find(item => item.id === book.id)?.summary).toBe('全书摘要');
    expect(state.collections.find(item => item.id === chapter.id)?.summary).toBe(summary);
    expect(state.notes).toEqual(before.notes);
    expect(state.entries).toEqual(before.entries);
    expect(state.draft).toEqual(before.draft);
    expect(state.collections.map(({ summary: _, ...collection }) => collection)).toEqual(before.collections);
    await notebook.saveCollectionSummary(chapter.id, '');
    state = await notebook.loadNotebook();
    expect(state.collections.find(item => item.id === chapter.id)?.summary).toBe('');
    expect(state.collections.find(item => item.id === book.id)?.summary).toBe('全书摘要');
    expect(await notebook.loadNotebook()).toEqual(state);
  });

  it('keeps a chapter summary when moving it to another book and promoting it to a book', async () => {
    const first = await notebook.createCollection('第一本');
    const second = await notebook.createCollection('第二本');
    const chapter = await notebook.createCollection('章节', first.id);
    await notebook.saveCollectionSummary(chapter.id, '随章节移动的摘要');
    await notebook.moveChapter(chapter.id, second.id);
    let state = await notebook.loadNotebook();
    expect(parentFor(chapter.id, state)?.id).toBe(second.id);
    expect(state.collections.find(item => item.id === chapter.id)?.summary).toBe('随章节移动的摘要');
    await notebook.moveChapter(chapter.id, null);
    state = await notebook.loadNotebook();
    expect(parentFor(chapter.id, state)).toBeUndefined();
    expect(state.collections.find(item => item.id === chapter.id)?.summary).toBe('随章节移动的摘要');
  });

  it('refuses to ungroup a chapter with a summary and only removes it after the summary is cleared', async () => {
    const book = await notebook.createCollection('书籍');
    const chapter = await notebook.createCollection('需要保留摘要的章节', book.id);
    const child = await notebook.createCollection('下级章节', chapter.id);
    const note = await notebook.createNoteInCollection(chapter.id, '已经学习的正文');
    await notebook.renameItem(chapter.id, noteRef(note.id), '原正文别名');
    await notebook.saveCollectionSummary(book.id, '原书籍摘要');
    await notebook.saveCollectionSummary(chapter.id, '  不能随着展开操作丢失的摘要。\n');
    await notebook.enrollRef(noteRef(note.id));
    await notebook.readRef(noteRef(note.id));
    const before = await notebook.loadNotebook();
    await expect(notebook.ungroupChapter(chapter.id)).rejects.toThrow('章节仍有摘要，请先将摘要移至上级或清空后再展开。');
    expect(await notebook.loadNotebook()).toEqual(before);
    await notebook.saveCollectionSummary(chapter.id, '');
    await notebook.ungroupChapter(chapter.id);
    const state = await notebook.loadNotebook();
    expect(state.collections.some(item => item.id === chapter.id)).toBe(false);
    expect(state.collections.find(item => item.id === book.id)).toMatchObject({
      summary: '原书籍摘要', items: [chapterRef(child.id), noteRef(note.id)], titles: { [`note:${note.id}`]: '原正文别名' },
    });
    expect(parentFor(child.id, state)?.id).toBe(book.id);
    expect(state.notes).toEqual(before.notes);
    expect(state.entries).toEqual(before.entries);
  });

  it('rejects invalid summaries and edits within archived hierarchies without changing saved content', async () => {
    const book = await notebook.createCollection('书籍');
    const chapter = await notebook.createCollection('章节', book.id);
    await notebook.saveCollectionSummary(chapter.id, '原摘要');
    const valid = await notebook.loadNotebook();
    await expect(notebook.saveCollectionSummary('missing', '摘要')).rejects.toThrow('不存在');
    await expect(notebook.saveCollectionSummary(chapter.id, null as unknown as string)).rejects.toThrow('摘要');
    await expect(notebook.saveCollectionSummary(chapter.id, '字'.repeat(2_000_001))).rejects.toThrow('摘要');
    expect(await notebook.loadNotebook()).toEqual(valid);
    for (const id of [book.id, chapter.id]) {
      await notebook.archiveCollection(id);
      const before = await notebook.loadNotebook();
      await expect(notebook.saveCollectionSummary(chapter.id, '')).rejects.toThrow('归档');
      expect(await notebook.loadNotebook()).toEqual(before);
      await notebook.restoreCollection(id);
    }
    await notebook.saveCollectionSummary(chapter.id, '恢复后可修改');
    expect((await notebook.loadNotebook()).collections.find(item => item.id === chapter.id)?.summary).toBe('恢复后可修改');
  });

  it('creates nested chapters and notes atomically, retaining insertion order and the independent composer draft', async () => {
    const root = await notebook.createCollection('我的知识');
    const child = await notebook.createCollection('异步编程', root.id);
    await notebook.saveDraft({ markdown: '尚未提交的另一条随笔' });
    const first = await notebook.createNoteInCollection(root.id, '# 引言\n\n先写一句话。', chapterRef(child.id));
    const second = await notebook.createNoteInCollection(child.id, '```python\nawait task\n```');
    const state = await notebook.loadNotebook();
    expect(state.collections.find(item => item.id === root.id)?.items).toEqual([noteRef(first.id), chapterRef(child.id)]);
    expect(state.collections.find(item => item.id === child.id)?.items).toEqual([noteRef(second.id)]);
    expect(rootCollections(state).map(item => item.id)).toEqual([root.id]);
    expect(parentFor(child.id, state)?.id).toBe(root.id);
    expect(state.draft.markdown).toBe('尚未提交的另一条随笔');
    expect(titleFor(chapterRef(child.id), state)).toBe('异步编程');
    expect(bodyFor(chapterRef(child.id), state)).toBe('');
    await expect(notebook.createNoteInCollection(child.id, '不能成为孤儿的随笔', noteRef('missing'))).rejects.toThrow('位置');
    await expect(notebook.createNoteInCollection('missing', '无法保存')).rejects.toThrow('不存在');
    await expect(notebook.createNoteInCollection(child.id, '  ')).rejects.toThrow('内容');
    // A second read uses a newly opened database connection, as a refreshed page does.
    expect(await notebook.loadNotebook()).toEqual(state);
  });

  it('groups in source order, carries aliases and nested chapters, and ungroups without changing note or memory identities', async () => {
    const root = await notebook.createCollection('阅读');
    const a = await notebook.createNoteInCollection(root.id, '原始笔记 A');
    const b = await notebook.createNoteInCollection(root.id, '原始笔记 B');
    const child = await notebook.createCollection('已有章节', root.id);
    const c = await notebook.createNoteInCollection(child.id, '已有章节中的 C');
    await notebook.renameItem(root.id, noteRef(a.id), '阅读别名 A');
    await notebook.enrollRef(noteRef(a.id));
    const memory = await notebook.readRef(noteRef(a.id));
    const before = await notebook.loadNotebook();
    const group = await notebook.groupIntoChapter(root.id, [chapterRef(child.id), noteRef(a.id), noteRef(a.id)], '重新组织');
    expect(group.items).toEqual([noteRef(a.id), chapterRef(child.id)]);
    expect(group.titles?.[`note:${a.id}`]).toBe('阅读别名 A');
    let state = await notebook.loadNotebook();
    expect(state.collections.find(item => item.id === root.id)?.items).toEqual([chapterRef(group.id), noteRef(b.id)]);
    expect(parentFor(child.id, state)?.id).toBe(group.id);
    expect(state.notes).toEqual(before.notes);
    expect(state.entries).toEqual([memory]);
    const expanded = await notebook.ungroupChapter(group.id);
    expect(expanded.items).toEqual([noteRef(a.id), chapterRef(child.id), noteRef(b.id)]);
    expect(expanded.titles?.[`note:${a.id}`]).toBe('阅读别名 A');
    state = await notebook.loadNotebook();
    expect(state.collections.some(item => item.id === group.id)).toBe(false);
    expect(parentFor(child.id, state)?.id).toBe(root.id);
    expect(state.notes.find(item => item.id === c.id)?.markdown).toBe('已有章节中的 C');
    expect(state.notes).toEqual(before.notes);
    expect(state.entries).toEqual([memory]);
  });

  it('rejects stale selections and cycles without partially mutating the hierarchy', async () => {
    const root = await notebook.createCollection('根');
    const child = await notebook.createCollection('子', root.id);
    const grandchild = await notebook.createCollection('孙', child.id);
    const note = await notebook.createNoteInCollection(child.id, '正文');
    const before = await notebook.loadNotebook();
    await expect(notebook.moveChapter(root.id, root.id)).rejects.toThrow('自身');
    await expect(notebook.moveChapter(root.id, grandchild.id)).rejects.toThrow('子章节');
    await expect(notebook.moveChapter(child.id, grandchild.id)).rejects.toThrow('子章节');
    await expect(notebook.ungroupChapter(root.id)).rejects.toThrow('书籍');
    await expect(notebook.groupIntoChapter(root.id, [noteRef(note.id)], '错误来源')).rejects.toThrow('来源');
    await expect(notebook.groupIntoChapter(root.id, [], '空选择')).rejects.toThrow('选择');
    await expect(notebook.createCollection(' ', root.id)).rejects.toThrow('名称');
    expect(await notebook.loadNotebook()).toEqual(before);
  });

  it('moves a chapter to one parent, reorders mixed content, and can promote it back to root', async () => {
    const first = await notebook.createCollection('第一本');
    const second = await notebook.createCollection('第二本');
    const child = await notebook.createCollection('被移动的章节', first.id);
    const note = await notebook.createNoteInCollection(second.id, '目标内容');
    await notebook.moveChapter(child.id, second.id, noteRef(note.id));
    let state = await notebook.loadNotebook();
    expect(state.collections.find(item => item.id === first.id)?.items).toEqual([]);
    expect(state.collections.find(item => item.id === second.id)?.items).toEqual([chapterRef(child.id), noteRef(note.id)]);
    expect(state.collections.flatMap(item => item.items).filter(item => item.kind === 'chapter' && item.id === child.id)).toHaveLength(1);
    await notebook.reorderContent(second.id, [noteRef(note.id), chapterRef(child.id)]);
    state = await notebook.loadNotebook();
    await expect(notebook.reorderContent(second.id, [noteRef(note.id)])).rejects.toThrow('排序');
    await expect(notebook.reorderContent(second.id, [noteRef(note.id), noteRef(note.id)])).rejects.toThrow('排序');
    await expect(notebook.reorderContent(second.id, [noteRef(note.id), chapterRef(first.id)])).rejects.toThrow('排序');
    expect(await notebook.loadNotebook()).toEqual(state);
    await notebook.moveChapter(child.id, second.id, noteRef(note.id));
    expect((await notebook.loadNotebook()).collections.find(item => item.id === second.id)?.items).toEqual([chapterRef(child.id), noteRef(note.id)]);
    await notebook.moveChapter(child.id, null, chapterRef(second.id));
    state = await notebook.loadNotebook();
    expect(parentFor(child.id, state)).toBeUndefined();
    expect(rootCollections(state).map(item => item.id)).toEqual([first.id, child.id, second.id]);
    expect(state.collections.find(item => item.id === second.id)?.items).toEqual([noteRef(note.id)]);
    await notebook.moveChapter(child.id, null);
    expect(rootCollections(await notebook.loadNotebook()).map(item => item.id)).toEqual([first.id, second.id, child.id]);
  });

  it('archives only the selected container and restores its exact hierarchy and contents', async () => {
    const root = await notebook.createCollection('工作笔记');
    const child = await notebook.createCollection('实验', root.id);
    const note = await notebook.createNoteInCollection(child.id, '实验结果');
    await notebook.enrollRef(noteRef(note.id));
    await notebook.readRef(noteRef(note.id));
    const before = await notebook.loadNotebook();
    const archived = await notebook.archiveCollection(root.id);
    const state = await notebook.loadNotebook();
    expect(archived.archivedAt).toBeTypeOf('number');
    expect(rootCollections(state)).toEqual([]);
    expect(rootCollections(state, true).map(item => item.id)).toEqual([root.id]);
    expect(state.collections.find(item => item.id === child.id)?.archivedAt).toBeUndefined();
    expect(state.notes).toEqual(before.notes);
    expect(state.entries).toEqual(before.entries);
    expect((await notebook.archiveCollection(root.id)).archivedAt).toBe(archived.archivedAt);
    await notebook.restoreCollection(root.id);
    expect(await notebook.loadNotebook()).toEqual(before);
  });

  it('keeps existing flat collections compatible with new hierarchy and note transfer operations', async () => {
    const old = await notebook.createCollection('旧合集');
    const other = await notebook.createCollection('另一个旧合集');
    await notebook.addToCollection(old.id, sectionRef('py01'));
    await notebook.addToCollection(old.id, sectionRef('py02'));
    await notebook.renameItem(old.id, sectionRef('py01'), '我原来的标题');
    const before = await notebook.loadNotebook();
    expect(before.collections).toEqual([
      { ...old, items: [sectionRef('py01'), sectionRef('py02')], titles: { 'section:py01': '我原来的标题' } }, other,
    ]);
    expect(rootCollections(before).map(item => item.id)).toEqual([old.id, other.id]);
    const child = await notebook.createCollection('新增子章节', old.id);
    await notebook.transferItems({ from: old.id, to: other.id, refs: [sectionRef('py01')], mode: 'copy' });
    await notebook.transferItems({ from: old.id, to: old.id, refs: [sectionRef('py02')], mode: 'move', before: chapterRef(child.id) });
    const state = await notebook.loadNotebook();
    expect(state.collections.find(item => item.id === old.id)?.items).toEqual([sectionRef('py01'), sectionRef('py02'), chapterRef(child.id)]);
    expect(state.collections.find(item => item.id === other.id)?.titles?.['section:py01']).toBe('我原来的标题');
    expect(state.notes).toEqual([]);
    expect(state.entries).toEqual(before.entries);
    // The old reference-only transfer endpoint cannot bypass single-parent and cycle checks.
    await expect(notebook.transferItems({ to: other.id, refs: [chapterRef(child.id)] as unknown as notebook.Ref[], mode: 'copy' })).rejects.toThrow('不存在');
    expect(await notebook.loadNotebook()).toEqual(state);
  });

  it('does not duplicate a shared note when ungrouping and retains the parent alias', async () => {
    const root = await notebook.createCollection('根');
    const shared = await notebook.createNoteInCollection(root.id, '共享正文');
    const child = await notebook.createCollection('子', root.id);
    await notebook.addToCollection(child.id, noteRef(shared.id));
    await notebook.renameItem(root.id, noteRef(shared.id), '父级别名');
    await notebook.renameItem(child.id, noteRef(shared.id), '子级别名');
    const newNote = await notebook.createNoteInCollection(child.id, '另一个正文');
    const parent = await notebook.ungroupChapter(child.id);
    expect(parent.items).toEqual([noteRef(shared.id), noteRef(newNote.id)]);
    expect(parent.titles?.[`note:${shared.id}`]).toBe('父级别名');
    expect((await notebook.loadNotebook()).notes).toHaveLength(2);
  });

  it('moves mixed content atomically in source order and retains existing destination aliases', async () => {
    const source = await notebook.createCollection('混合来源');
    const target = await notebook.createCollection('混合目标');
    const note = await notebook.createNoteInCollection(source.id, '保留原始内容');
    const child = await notebook.createCollection('子章节', source.id);
    const section = sectionRef('py01');
    await notebook.addToCollection(source.id, section);
    await notebook.renameItem(source.id, noteRef(note.id), '来源别名');
    await notebook.addToCollection(target.id, section);
    await notebook.renameItem(target.id, section, '目标已有别名');
    await notebook.enrollRef(noteRef(note.id));
    const memory = await notebook.readRef(noteRef(note.id));
    const before = await notebook.loadNotebook();
    await notebook.moveContent({ from: source.id, to: target.id, refs: [section, chapterRef(child.id), noteRef(note.id)] });
    const state = await notebook.loadNotebook();
    expect(state.collections.find(item => item.id === source.id)?.items).toEqual([]);
    expect(state.collections.find(item => item.id === target.id)?.items).toEqual([section, noteRef(note.id), chapterRef(child.id)]);
    expect(state.collections.find(item => item.id === target.id)?.titles).toEqual({ 'section:py01': '目标已有别名', [`note:${note.id}`]: '来源别名' });
    expect(parentFor(child.id, state)?.id).toBe(target.id);
    expect(state.notes).toEqual(before.notes);
    expect(state.entries).toEqual([memory]);
  });

  it('leaves every item in place when a mixed move contains a stale item, a cycle, or an invalid root placement', async () => {
    const source = await notebook.createCollection('来源');
    const target = await notebook.createCollection('目标');
    const note = await notebook.createNoteInCollection(source.id, '应当原地保留');
    const child = await notebook.createCollection('子', source.id);
    const grandchild = await notebook.createCollection('孙', child.id);
    const before = await notebook.loadNotebook();
    await expect(notebook.moveContent({ from: source.id, to: target.id, refs: [noteRef(note.id), chapterRef('missing')] })).rejects.toThrow('不存在');
    await expect(notebook.moveContent({ from: source.id, to: grandchild.id, refs: [noteRef(note.id), chapterRef(child.id)] })).rejects.toThrow('子章节');
    await expect(notebook.moveContent({ from: source.id, to: null, refs: [chapterRef(child.id), noteRef(note.id)] })).rejects.toThrow('根目录');
    expect(await notebook.loadNotebook()).toEqual(before);
    await notebook.moveContent({ from: source.id, to: null, refs: [chapterRef(child.id)] });
    const state = await notebook.loadNotebook();
    expect(parentFor(child.id, state)).toBeUndefined();
    expect(parentFor(grandchild.id, state)?.id).toBe(child.id);
    expect(state.collections.find(item => item.id === source.id)?.items).toEqual([noteRef(note.id)]);
  });

  it('rejects archived sources, targets, and their ancestors before moving any mixed selection', async () => {
    const sourceRoot = await notebook.createCollection('来源根');
    const source = await notebook.createCollection('来源', sourceRoot.id);
    const targetRoot = await notebook.createCollection('目标根');
    const target = await notebook.createCollection('目标', targetRoot.id);
    const note = await notebook.createNoteInCollection(source.id, '归档期间不能搬走');
    const child = await notebook.createCollection('子', source.id);
    const refs = [noteRef(note.id), chapterRef(child.id)];
    for (const id of [sourceRoot.id, source.id, targetRoot.id, target.id, child.id]) {
      await notebook.archiveCollection(id);
      const before = await notebook.loadNotebook();
      await expect(notebook.moveContent({ from: source.id, to: target.id, refs })).rejects.toThrow('归档');
      expect(await notebook.loadNotebook()).toEqual(before);
      await notebook.restoreCollection(id);
    }
    await notebook.archiveCollection(sourceRoot.id);
    const before = await notebook.loadNotebook();
    await expect(notebook.moveContent({ to: target.id, refs: [chapterRef(child.id)] })).rejects.toThrow('归档');
    expect(await notebook.loadNotebook()).toEqual(before);
  });
});
