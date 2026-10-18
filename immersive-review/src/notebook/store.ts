import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { projectReadingMemory, estimateSeconds, requiredActiveMs, type ReadingMemoryProjection } from './memory-policy';
import { enrollMemory, memoryId, readMemoryState, recordMemoryExposure, removeMemory, saveMemoryPriority, saveMemoryAiPriorities, saveMemorySettings, undoMemoryRead, type MemoryEntry, type MemoryReference, type MemorySettingsValue } from '../memory/memory-store.mjs';
import type { MemoryPriorityAssessment } from './memory-priority-client';
import * as legacy from '../manual-demo/business-store';
import manual from '../manual-demo/manual.json';

export type Ref = { kind: 'note' | 'section'; id: string };
export type ChapterRef = { kind: 'chapter'; id: string };
export type ContentRef = Ref | ChapterRef;
export type MemoSource = { kind: 'summary' | 'content'; collectionId: string; ref?: Ref; title: string; path: string[]; quote: string; quoteFormat?: 'markdown'; contextMarkdown?: string; contextTitle?: string; before?: string; after?: string; capturedAt: number };
export type Note = { id: string; markdown: string; createdAt: number; updatedAt: number; archivedAt?: number; sourceSectionId?: string; kind?: 'memo' | 'document'; source?: MemoSource; copiedFrom?: string; editingOriginId?: string };
export type Collection = { id: string; title: string; summary?: string; items: ContentRef[]; titles?: Record<string, string>; archivedAt?: number; deletedAt?: number };
export type Draft = { markdown: string; editingId?: string; source?: MemoSource };
export type LegacyDraft = Draft & { sectionId: string };
type DeletedContentBase = { id: string; collectionId: string; collectionTitle: string; path: string[]; title: string; markdown: string; deletedAt: number };
export type DeletedContent = DeletedContentBase & ({ kind: 'summary' } | { kind: 'content'; ref: Ref; index: number; alias?: string });
type Workspace = { notes: Note[]; collections: Collection[]; draft: Draft; legacyDrafts: LegacyDraft[]; deletedContent?: DeletedContent[] };
export type NotebookState = Workspace & { deletedContent: DeletedContent[]; entries: MemoryEntry[]; settings: MemorySettingsValue };
export type Projection = ReadingMemoryProjection & { entry?: MemoryEntry };
export type DeletionUndo = { kind: 'collection' | 'summary' | 'content'; id: string; collectionId: string; title: string; deletedAt: number };
export const NOTEBOOK_DB = 'read-notebook-v1';
const NOTE_DOCUMENT = 'read-notebook';
const SECTION_DOCUMENT = `read-manual:${manual.documentId}`;
const sectionIds = new Set(manual.sections.map(section => section.id));
const empty = (): Workspace => ({ notes: [], collections: [], draft: { markdown: '' }, legacyDrafts: [] });
let writes: Promise<void> = Promise.resolve();
// Only deletion identities are retained. Undo restores one targeted record, never an old workspace snapshot.
let deletionUndos: DeletionUndo[] = [];
const deletionUndoListeners = new Set<() => void>();
function notifyDeletionUndo() {
  for (const listener of deletionUndoListeners) {
    // UI listeners cannot turn a successfully committed deletion into a reported storage failure.
    try { listener(); } catch { /* The next UI refresh can read the committed undo state. */ }
  }
}
function rememberDeletion(undo: DeletionUndo) {
  deletionUndos = [...deletionUndos, undo].slice(-100);
  notifyDeletionUndo();
}
function forgetDeletion(kind: 'collection' | 'content', id: string) {
  const remaining = deletionUndos.filter(item => !((kind === 'collection' ? item.kind === 'collection' : item.kind !== 'collection') && item.id === id));
  if (remaining.length === deletionUndos.length) return;
  deletionUndos = remaining;
  notifyDeletionUndo();
}
export function peekDeletionUndo(): DeletionUndo | undefined {
  const latest = deletionUndos.at(-1);
  return latest ? { ...latest } : undefined;
}
export function subscribeDeletionUndo(listener: () => void): () => void {
  deletionUndoListeners.add(listener);
  return () => { deletionUndoListeners.delete(listener); };
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = writes.then(operation);
  writes = result.then(() => undefined, () => undefined);
  return result;
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NOTEBOOK_DB, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      request.result.createObjectStore('workspace');
      request.result.createObjectStore('metadata');
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(new Error('无法打开本地笔记。'));
    request.onblocked = () => { blocked = true; reject(new Error('笔记存储被其他页面占用，请关闭后重试。')); };
  });
}
async function snapshot(): Promise<{ workspace: Workspace; migrated: boolean }> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['workspace', 'metadata'], 'readonly');
    const value = tx.objectStore('workspace').get('root');
    const migration = tx.objectStore('metadata').get('manual-memos-v1');
    tx.oncomplete = () => { db.close(); resolve({ workspace: value.result ?? empty(), migrated: migration.result === true }); };
    tx.onabort = () => { db.close(); reject(new Error('笔记读取失败，原记录未修改。')); };
  });
}
/** One transaction owns every change, including the one-time migration marker. */
async function change<T>(update: (workspace: Workspace) => T, markMigrated = false): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['workspace', 'metadata'], 'readwrite');
    const store = tx.objectStore('workspace');
    const request = store.get('root');
    let result: T;
    let failure: unknown;
    request.onsuccess = () => {
      try {
        const workspace: Workspace = request.result ?? empty();
        result = update(workspace);
        store.put(workspace, 'root');
        if (markMigrated) tx.objectStore('metadata').put(true, 'manual-memos-v1');
      } catch (reason) { failure = reason; tx.abort(); }
    };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = () => { db.close(); reject(failure ?? new Error('保存失败，本次修改未计入。')); };
  });
}
async function ensureMigrated() {
  if ((await snapshot()).migrated) return;
  const old = await legacy.loadBusiness();
  await change(workspace => {
    for (const memo of old.memos) {
      if (!workspace.notes.some(note => note.id === memo.id)) {
        const { sectionId, ...note } = memo;
        workspace.notes.push({ ...note, sourceSectionId: sectionId });
      }
    }
    // Multiple section drafts stay separate and unsaved; none can overwrite the main composer.
    for (const draft of old.drafts) {
      if (!workspace.legacyDrafts.some(item => item.sectionId === draft.sectionId)) workspace.legacyDrafts.push({ ...draft });
    }
  }, true);
}
function operation<T>(update: (workspace: Workspace) => T, committed?: (result: T) => void): Promise<T> {
  return serialize(async () => {
    await ensureMigrated();
    const result = await change(update);
    committed?.(result);
    return result;
  });
}
function requireMarkdown(markdown: string) {
  if (typeof markdown !== 'string' || markdown.length > 2_000_000) throw new Error('笔记内容无效或过长。');
}
function requireNote(workspace: Pick<Workspace, 'notes'>, id: string) {
  const note = workspace.notes.find(item => item.id === id);
  if (!note) throw new Error('这条笔记不存在。');
  return note;
}
function requireRef(workspace: Pick<Workspace, 'notes'>, ref: Ref) {
  if (ref.kind === 'note') return requireNote(workspace, ref.id);
  if (ref.kind !== 'section' || !sectionIds.has(ref.id)) throw new Error('这一节不存在。');
}
function requireCollection(workspace: Workspace, id: string) {
  const collection = workspace.collections.find(item => item.id === id);
  if (!collection) throw new Error('这个阅读合集不存在。');
  return collection;
}
const sameRef = (left: ContentRef, right: ContentRef) => left.kind === right.kind && left.id === right.id;
const refKey = (ref: ContentRef) => `${ref.kind}:${ref.id}`;
function requireContent(workspace: Workspace, ref: ContentRef) {
  return ref.kind === 'chapter' ? requireCollection(workspace, ref.id) : requireRef(workspace, ref);
}
function parentOf(workspace: Pick<Workspace, 'collections'>, id: string) {
  return workspace.collections.find(collection => collection.items.some(item => item.kind === 'chapter' && item.id === id));
}
/** Untyped legacy notes stay memos until an explicit book edit creates a separate document. */
export const isMemo = (note: Note) => note.kind !== 'document';
export function isCollectionDeleted(id: string, state: Pick<NotebookState, 'collections'>): boolean {
  const seen = new Set<string>();
  let current = state.collections.find(collection => collection.id === id);
  while (current && !seen.has(current.id)) {
    if (current.deletedAt !== undefined) return true;
    seen.add(current.id);
    current = parentOf(state, current.id);
  }
  return false;
}
function requireNotDeletedCollection(workspace: Workspace, id: string) {
  const collection = requireCollection(workspace, id);
  if (isCollectionDeleted(id, workspace)) throw new Error('请先从回收站恢复这本书或章节。');
  return collection;
}
function requireActiveCollection(workspace: Workspace, id: string) {
  const collection = requireNotDeletedCollection(workspace, id);
  let current: Collection | undefined = collection;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current.archivedAt !== undefined) throw new Error('请先恢复归档的章节，再进行整理。');
    seen.add(current.id);
    current = parentOf(workspace, current.id);
  }
  return collection;
}
function collectionTitles(workspace: Workspace, id: string): string[] {
  const path: string[] = [], seen = new Set<string>();
  let current: Collection | undefined = requireCollection(workspace, id);
  while (current && !seen.has(current.id)) {
    path.unshift(current.title); seen.add(current.id); current = parentOf(workspace, current.id);
  }
  return path;
}
function copyMemoSource(source: MemoSource): MemoSource {
  if (!source || !['summary', 'content'].includes(source.kind) || typeof source.collectionId !== 'string' || !source.collectionId || source.collectionId.length > 240) throw new Error('随笔来源无效。');
  if (typeof source.title !== 'string' || source.title.length > 500 || !Array.isArray(source.path) || source.path.length > 100 || source.path.some(part => typeof part !== 'string' || part.length > 240)) throw new Error('随笔来源标题无效。');
  if (typeof source.quote !== 'string' || !source.quote.trim() || source.quote.length > 2_000_000 || [source.before, source.after].some(part => part !== undefined && (typeof part !== 'string' || part.length > 20_000))) throw new Error('引用内容或上下文无效。');
  if (source.quoteFormat !== undefined && source.quoteFormat !== 'markdown') throw new Error('引用格式无效。');
  if (source.contextMarkdown !== undefined && (typeof source.contextMarkdown !== 'string' || source.contextMarkdown.length > 2_000_000)) throw new Error('引用上下文无效。');
  if (source.contextTitle !== undefined && (typeof source.contextTitle !== 'string' || source.contextTitle.length > 10_000)) throw new Error('引用上下文标题无效。');
  if (!Number.isSafeInteger(source.capturedAt) || source.capturedAt < 0 || source.capturedAt > 8_640_000_000_000_000) throw new Error('引用时间无效。');
  if (source.kind === 'content' && (!source.ref || !['note', 'section'].includes(source.ref.kind) || typeof source.ref.id !== 'string' || !source.ref.id || source.ref.id.length > 240)) throw new Error('引用位置无效。');
  return { kind: source.kind, collectionId: source.collectionId, title: source.title, path: [...source.path], quote: source.quote, capturedAt: source.capturedAt,
    ...(source.ref ? { ref: { ...source.ref } } : {}), ...(source.quoteFormat ? { quoteFormat: source.quoteFormat } : {}),
    ...(source.contextMarkdown !== undefined ? { contextMarkdown: source.contextMarkdown } : {}), ...(source.contextTitle !== undefined ? { contextTitle: source.contextTitle } : {}),
    ...(source.before !== undefined ? { before: source.before } : {}), ...(source.after !== undefined ? { after: source.after } : {}) };
}
function assertChapterDestination(workspace: Workspace, id: string, to: string) {
  const pending = [id];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (current === to) throw new Error('不能把章节移入自身或它的子章节。');
    if (visited.has(current)) continue;
    visited.add(current);
    for (const ref of requireCollection(workspace, current).items) if (ref.kind === 'chapter') pending.push(ref.id);
  }
}
function cleanTitle(title: string) {
  if (typeof title !== 'string' || !title.trim() || title.length > 240) throw new Error('请填写有效的合集名称。');
  return title.trim();
}
function noteReference(note: Note): MemoryReference {
  const hash = `sha256:${bytesToHex(sha256(new TextEncoder().encode(note.markdown)))}`;
  return { documentId: NOTE_DOCUMENT, documentTitle: isMemo(note) ? '随笔' : '书籍正文', sectionId: note.id,
    title: note.markdown.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').slice(0, 120) || '随笔',
    contentHash: hash, documentRevision: hash, sectionVersion: Math.max(1, Math.floor(note.updatedAt)) };
}

export function loadNotebook(): Promise<NotebookState> {
  return serialize(async () => {
    await ensureMigrated();
    const [{ workspace }, memory] = await Promise.all([snapshot(), readMemoryState()]);
    return { ...workspace, deletedContent: workspace.deletedContent ?? [], entries: memory.entries.filter(entry => entry.documentId === NOTE_DOCUMENT || entry.documentId === SECTION_DOCUMENT), settings: memory.settings };
  });
}
export async function loadNotebookMemory() {
  const memory = await readMemoryState();
  return { entries: memory.entries.filter(entry => entry.documentId === NOTE_DOCUMENT || entry.documentId === SECTION_DOCUMENT), settings: memory.settings };
}
export async function saveNote(input: { id?: string; markdown: string; sourceSectionId?: string; source?: MemoSource }, now = Date.now()): Promise<Note> {
  const { id, markdown, sourceSectionId } = input;
  const source = input.source ? copyMemoSource(input.source) : undefined;
  return operation(workspace => {
    requireMarkdown(markdown);
    if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) throw new Error('记录时间无效。');
    if (sourceSectionId && !sectionIds.has(sourceSectionId)) throw new Error('来源章节不存在。');
    const previous = id ? requireNote(workspace, id) : undefined;
    if (!previous && !markdown.trim() && !source) throw new Error('请先写下笔记内容。');
    if (previous?.archivedAt !== undefined) throw new Error('请先恢复这条笔记，再进行编辑。');
    if (previous?.kind === 'document' && !workspace.collections.some(collection => !isCollectionDeleted(collection.id, workspace) && collection.items.some(ref => ref.kind === 'note' && ref.id === previous.id))) throw new Error('正文已被删除，请先从回收站恢复。');
    const note: Note = { ...previous, id: id ?? crypto.randomUUID(), markdown, createdAt: previous?.createdAt ?? now, updatedAt: now,
      ...(!previous ? { kind: 'memo' as const } : {}), ...(sourceSectionId ? { sourceSectionId } : {}), ...(source ? { source } : {}) };
    workspace.notes = [...workspace.notes.filter(item => item.id !== note.id), note];
    if (workspace.draft.editingId === id) workspace.draft = { markdown: '' };
    return note;
  });
}
export async function saveDraft(input: Draft): Promise<Draft> {
  const { markdown, editingId } = input;
  const source = input.source ? copyMemoSource(input.source) : undefined;
  return operation(workspace => {
    requireMarkdown(markdown);
    if (editingId && requireNote(workspace, editingId).archivedAt !== undefined) throw new Error('请先恢复这条笔记。');
    workspace.draft = { markdown, ...(editingId ? { editingId } : {}), ...(source ? { source } : {}) };
    return workspace.draft;
  });
}
export function archiveNote(id: string): Promise<Note> {
  return operation(workspace => {
    const note = requireNote(workspace, id);
    if (workspace.draft.editingId === id) throw new Error('请先保存或取消当前编辑。');
    note.archivedAt ??= Date.now();
    return note;
  });
}
export function restoreNote(id: string): Promise<Note> {
  return operation(workspace => { const note = requireNote(workspace, id); delete note.archivedAt; return note; });
}
export function createCollection(title: string, parentId?: string): Promise<Collection> {
  return operation(workspace => {
    const parent = parentId === undefined ? undefined : requireActiveCollection(workspace, parentId);
    const collection: Collection = { id: crypto.randomUUID(), title: cleanTitle(title), items: [] };
    workspace.collections.push(collection);
    parent?.items.push({ kind: 'chapter', id: collection.id });
    return collection;
  });
}
export function saveCollectionSummary(id: string, summary: string): Promise<Collection> {
  return operation(workspace => {
    const collection = requireActiveCollection(workspace, id);
    if (typeof summary !== 'string' || summary.length > 2_000_000) throw new Error('章节摘要无效或过长。');
    collection.summary = summary;
    return collection;
  });
}
export function createNoteInCollection(collectionId: string, markdown: string, before?: ContentRef): Promise<Note> {
  const position = before ? { ...before } : undefined;
  return operation(workspace => {
    const collection = requireActiveCollection(workspace, collectionId);
    requireMarkdown(markdown);
    if (!markdown.trim()) throw new Error('请先写下笔记内容。');
    const index = position ? collection.items.findIndex(item => sameRef(item, position)) : collection.items.length;
    if (index < 0) throw new Error('放置位置已变化，请重试。');
    const now = Date.now();
    const note: Note = { id: crypto.randomUUID(), kind: 'document', markdown, createdAt: now, updatedAt: now };
    workspace.notes.push(note);
    collection.items.splice(index, 0, { kind: 'note', id: note.id });
    return note;
  });
}
/** A book edit never changes the independent memo from which the text originated. */
export function saveDocumentContent(input: { collectionId: string; id: string; markdown: string }): Promise<Note> {
  const { collectionId, id, markdown } = input;
  return operation(workspace => {
    requireMarkdown(markdown);
    const collection = requireActiveCollection(workspace, collectionId);
    let index = collection.items.findIndex(ref => ref.kind === 'note' && ref.id === id);
    // A live editor may finish a second queued save with its pre-copy identity.
    if (index < 0) index = collection.items.findIndex(ref => ref.kind === 'note' && workspace.notes.some(note => note.id === ref.id && note.kind === 'document' && note.editingOriginId === id));
    if (index < 0) throw new Error('正文已被删除或移走，本次编辑未重新添加。');
    const previous = requireNote(workspace, collection.items[index].id);
    if (previous.archivedAt !== undefined) throw new Error('请先恢复这条笔记，再进行编辑。');
    const shared = workspace.collections.filter(owner => owner.items.some(ref => ref.kind === 'note' && ref.id === previous.id)).length > 1;
    if (!isMemo(previous) && !shared) {
      previous.markdown = markdown; previous.updatedAt = Date.now();
      return previous;
    }
    const now = Date.now();
    const note: Note = { id: crypto.randomUUID(), kind: 'document', markdown, createdAt: now, updatedAt: now, copiedFrom: id, editingOriginId: id };
    workspace.notes.push(note);
    collection.items[index] = { kind: 'note', id: note.id };
    const alias = collection.titles?.[`note:${previous.id}`];
    if (alias) { collection.titles![`note:${note.id}`] = alias; delete collection.titles![`note:${previous.id}`]; }
    return note;
  });
}
/** Import is a content snapshot. Later memo edits and book edits remain independent. */
export function copyIntoCollection(input: { to: string; refs: Ref[]; before?: ContentRef }): Promise<Collection> {
  const refs = input.refs.map(ref => ({ ...ref })).filter((ref, index, all) => all.findIndex(item => sameRef(item, ref)) === index);
  const before = input.before ? { ...input.before } : undefined;
  return operation(workspace => {
    const target = requireActiveCollection(workspace, input.to);
    const index = before ? target.items.findIndex(ref => sameRef(ref, before)) : target.items.length;
    if (index < 0) throw new Error('放置位置已变化，请重试。');
    for (const ref of refs) requireRef(workspace, ref);
    const now = Date.now();
    const additions = refs.map(ref => {
      const original = ref.kind === 'note' ? requireNote(workspace, ref.id) : undefined;
      if (original?.archivedAt !== undefined) throw new Error('请先恢复这条笔记，再加入书籍。');
      let markdown = readingMarkdown(ref, workspace);
      if (original && isMemo(original) && original.source) {
        const citation = original.source;
        const escapeText = (value: string) => value.replace(/([\\`*_{}\[\]<>])/g, '\\$1').replace(/[\r\n]+/g, ' ');
        const attribution = [...citation.path, citation.kind === 'summary' ? '摘要' : citation.title].filter(Boolean).map(escapeText).join(' / ');
        markdown = `> ${citation.quote.replace(/\r\n?/g, '\n').split('\n').join('\n> ')}\n\n出处：${attribution}${markdown.trim() ? `\n\n${markdown}` : ''}`;
      }
      const note: Note = { id: crypto.randomUUID(), kind: 'document', markdown, createdAt: now, updatedAt: now,
        ...(original?.source ? { source: copyMemoSource(original.source) } : {}),
        ...(original ? { copiedFrom: original.id } : { sourceSectionId: ref.id }) };
      workspace.notes.push(note);
      return { kind: 'note' as const, id: note.id };
    });
    target.items.splice(index, 0, ...additions);
    return target;
  });
}
export function createMemoFromContent(input: { source: MemoSource; markdown?: string }): Promise<Note> {
  return saveNote({ source: input.source, markdown: input.markdown ?? '' });
}
export function trashCollection(id: string): Promise<Collection> {
  return operation(workspace => {
    const collection = requireNotDeletedCollection(workspace, id);
    collection.deletedAt = Date.now();
    return collection;
  }, collection => rememberDeletion({ kind: 'collection', id, collectionId: id, title: collection.title, deletedAt: collection.deletedAt! }));
}
function restoreCollectionInWorkspace(workspace: Workspace, id: string): Collection {
  const collection = requireCollection(workspace, id);
  const parent = parentOf(workspace, id);
  if (parent && isCollectionDeleted(parent.id, workspace)) throw new Error('请先从回收站恢复上级书籍或章节。');
  delete collection.deletedAt;
  return collection;
}
export function restoreDeletedCollection(id: string): Promise<Collection> {
  return operation(workspace => restoreCollectionInWorkspace(workspace, id), () => forgetDeletion('collection', id));
}
export function deleteCollectionSummary(id: string): Promise<DeletedContent> {
  return operation(workspace => {
    const collection = requireActiveCollection(workspace, id);
    if (!collection.summary?.trim()) throw new Error('摘要已经为空。');
    const deleted: DeletedContent = { id: crypto.randomUUID(), kind: 'summary', collectionId: id, collectionTitle: collection.title,
      path: collectionTitles(workspace, id), title: `${collection.title} · 摘要`, markdown: collection.summary, deletedAt: Date.now() };
    (workspace.deletedContent ??= []).push(deleted);
    collection.summary = '';
    return deleted;
  }, deleted => rememberDeletion({ kind: 'summary', id: deleted.id, collectionId: deleted.collectionId, title: deleted.title, deletedAt: deleted.deletedAt }));
}
export function deleteContent(collectionId: string, ref: Ref): Promise<DeletedContent> {
  const copied = { ...ref };
  return operation(workspace => {
    const collection = requireActiveCollection(workspace, collectionId);
    const index = collection.items.findIndex(item => sameRef(item, copied));
    if (index < 0) throw new Error('正文已被删除或移走。');
    requireRef(workspace, copied);
    const markdown = readingMarkdown(copied, workspace);
    const alias = collection.titles?.[refKey(copied)];
    const deleted: DeletedContent = { id: crypto.randomUUID(), kind: 'content', collectionId, collectionTitle: collection.title,
      path: collectionTitles(workspace, collectionId), title: alias ?? markdown.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').slice(0, 120) ?? '正文',
      markdown, deletedAt: Date.now(), ref: copied, index, ...(alias ? { alias } : {}) };
    (workspace.deletedContent ??= []).push(deleted);
    collection.items.splice(index, 1);
    if (collection.titles) delete collection.titles[refKey(copied)];
    return deleted;
  }, deleted => rememberDeletion({ kind: 'content', id: deleted.id, collectionId: deleted.collectionId, title: deleted.title, deletedAt: deleted.deletedAt }));
}
function restoreContentInWorkspace(workspace: Workspace, id: string): Collection {
  const deleted = workspace.deletedContent?.find(item => item.id === id);
  if (!deleted) throw new Error('这条回收站记录不存在。');
  const collection = requireActiveCollection(workspace, deleted.collectionId);
  if (deleted.kind === 'summary') {
    if (collection.summary?.trim()) throw new Error('当前已有摘要，请先移走当前摘要再恢复。');
    collection.summary = deleted.markdown;
  } else {
    requireRef(workspace, deleted.ref);
    if (collection.items.some(ref => sameRef(ref, deleted.ref))) throw new Error('正文已在当前章节中，请先确认现有内容。');
    let ref = deleted.ref;
    if (readingMarkdown(ref, workspace) !== deleted.markdown) {
      const now = Date.now();
      const note: Note = { id: crypto.randomUUID(), kind: 'document', markdown: deleted.markdown, createdAt: now, updatedAt: now };
      workspace.notes.push(note); ref = { kind: 'note', id: note.id };
    }
    collection.items.splice(Math.min(deleted.index, collection.items.length), 0, ref);
    if (deleted.alias) { collection.titles ??= {}; collection.titles[refKey(ref)] = deleted.alias; }
  }
  workspace.deletedContent = workspace.deletedContent!.filter(item => item.id !== id);
  return collection;
}
export function restoreDeletedContent(id: string): Promise<Collection> {
  return operation(workspace => restoreContentInWorkspace(workspace, id), () => forgetDeletion('content', id));
}
/** Serialized with writes, so repeated shortcuts cannot restore the same deletion twice. */
export function undoLastDeletion(): Promise<DeletionUndo | undefined> {
  return serialize(async () => {
    await ensureMigrated();
    const remaining = [...deletionUndos];
    const undone = await change(workspace => {
      while (remaining.length) {
        const candidate = remaining.pop()!;
        if (candidate.kind === 'collection') {
          const collection = workspace.collections.find(item => item.id === candidate.id);
          // A different tab may have restored this item or performed a later deletion.
          if (!collection || collection.deletedAt !== candidate.deletedAt) continue;
          restoreCollectionInWorkspace(workspace, candidate.id);
        } else {
          if (!workspace.deletedContent?.some(item => item.id === candidate.id)) continue;
          restoreContentInWorkspace(workspace, candidate.id);
        }
        return candidate;
      }
      return undefined;
    });
    // Conflicts abort the transaction and retain the undo entry for a later retry.
    deletionUndos = remaining;
    notifyDeletionUndo();
    return undone;
  });
}
export function groupIntoChapter(fromId: string, refs: ContentRef[], title: string): Promise<Collection> {
  const selected = refs.map(ref => ({ ...ref }));
  return operation(workspace => {
    const source = requireActiveCollection(workspace, fromId);
    if (!selected.length) throw new Error('请先选择要组成章节的内容。');
    for (const ref of selected) {
      requireContent(workspace, ref);
      if (ref.kind === 'chapter') requireActiveCollection(workspace, ref.id);
      if (!source.items.some(item => sameRef(item, ref))) throw new Error('待整理内容已不在来源合集中。');
    }
    const items = source.items.filter(ref => selected.some(item => sameRef(item, ref)));
    const index = source.items.findIndex(ref => selected.some(item => sameRef(item, ref)));
    const chapter: Collection = { id: crypto.randomUUID(), title: cleanTitle(title), items };
    for (const ref of items) {
      const key = refKey(ref);
      if (source.titles?.[key]) {
        chapter.titles ??= {};
        chapter.titles[key] = source.titles[key];
        delete source.titles[key];
      }
    }
    source.items = source.items.filter(ref => !selected.some(item => sameRef(item, ref)));
    source.items.splice(index, 0, { kind: 'chapter', id: chapter.id });
    workspace.collections.push(chapter);
    return chapter;
  });
}
export function ungroupChapter(chapterId: string): Promise<Collection> {
  return operation(workspace => {
    const chapter = requireActiveCollection(workspace, chapterId);
    const parent = parentOf(workspace, chapterId);
    if (!parent) throw new Error('书籍没有上级，无法展开到上级。');
    if (chapter.summary?.trim()) throw new Error('章节仍有摘要，请先将摘要移至上级或清空后再展开。');
    if (workspace.deletedContent?.some(item => item.collectionId === chapterId)) throw new Error('请先恢复该章节回收站中的内容，再展开到上级。');
    const index = parent.items.findIndex(ref => ref.kind === 'chapter' && ref.id === chapterId);
    // A note may already be referenced by the parent. Keep that existing occurrence and its alias.
    const additions = chapter.items.filter(ref => !parent.items.some(item => sameRef(item, ref)));
    parent.items.splice(index, 1, ...additions);
    if (parent.titles) delete parent.titles[`chapter:${chapterId}`];
    for (const ref of additions) {
      const key = refKey(ref);
      if (chapter.titles?.[key] && !parent.titles?.[key]) {
        parent.titles ??= {};
        parent.titles[key] = chapter.titles[key];
      }
    }
    workspace.collections = workspace.collections.filter(item => item.id !== chapterId);
    return parent;
  });
}
export function moveChapter(id: string, to: string | null, before?: ContentRef): Promise<Collection> {
  const position = before ? { ...before } : undefined;
  return operation(workspace => {
    const chapter = requireActiveCollection(workspace, id);
    const source = parentOf(workspace, id);
    const target = to === null ? undefined : requireActiveCollection(workspace, to);
    if (target) assertChapterDestination(workspace, id, target.id);
    if (position) {
      const exists = target
        ? target.items.some(item => sameRef(item, position))
        : position.kind === 'chapter' && workspace.collections.some(item => item.id === position.id) && !parentOf(workspace, position.id);
      if (!exists) throw new Error('放置位置已变化，请重试。');
      if (position.kind === 'chapter' && position.id === id) return chapter;
    }
    if (source) {
      source.items = source.items.filter(ref => !(ref.kind === 'chapter' && ref.id === id));
      if (source.titles) delete source.titles[`chapter:${id}`];
    }
    if (target) {
      const index = position ? target.items.findIndex(item => sameRef(item, position)) : target.items.length;
      target.items.splice(index, 0, { kind: 'chapter', id });
    } else {
      // Collection order is also root order; no parallel parent/order field is stored.
      workspace.collections = workspace.collections.filter(item => item.id !== id);
      const index = position ? workspace.collections.findIndex(item => item.id === position.id) : workspace.collections.length;
      workspace.collections.splice(index, 0, chapter);
    }
    return chapter;
  });
}
/** Move a mixed selection in one transaction, so a stale item cannot leave a partial move. */
export function moveContent(input: { from?: string; to: string | null; refs: ContentRef[] }): Promise<Collection[]> {
  const { from, to } = input;
  const selected = input.refs.map(ref => ({ ...ref })).filter((ref, index, refs) => refs.findIndex(item => sameRef(item, ref)) === index);
  return operation(workspace => {
    const source = from === undefined ? undefined : requireActiveCollection(workspace, from);
    const target = to === null ? undefined : requireActiveCollection(workspace, to);
    if (!target && selected.some(ref => ref.kind !== 'chapter')) throw new Error('只有章节可以移动到阅读站根目录。');
    // Validate every member and every ancestor before changing any source or destination.
    for (const ref of selected) {
      requireContent(workspace, ref);
      if (source && !source.items.some(item => sameRef(item, ref))) throw new Error('待整理内容已不在来源合集中。');
      if (ref.kind === 'chapter') {
        requireActiveCollection(workspace, ref.id);
        if (target) assertChapterDestination(workspace, ref.id, target.id);
      }
    }
    if (!selected.length) return [];
    const ordered = source ? source.items.filter(ref => selected.some(item => sameRef(item, ref))) : selected;
    const changed = new Map<string, Collection>();
    for (const ref of ordered) {
      const origin = ref.kind === 'chapter' ? parentOf(workspace, ref.id) : source;
      if (origin === target) continue;
      const key = refKey(ref);
      const alias = origin?.titles?.[key];
      if (target && !target.items.some(item => sameRef(item, ref))) {
        target.items.push(ref);
        changed.set(target.id, target);
      }
      if (target && alias && !target.titles?.[key]) {
        target.titles ??= {};
        target.titles[key] = alias;
        changed.set(target.id, target);
      }
      if (origin) {
        origin.items = origin.items.filter(item => !sameRef(item, ref));
        if (origin.titles) delete origin.titles[key];
        changed.set(origin.id, origin);
      }
    }
    if (!target) {
      // Root order lives in the collections array; descendants keep their own references.
      const roots = ordered.map(ref => requireCollection(workspace, ref.id));
      const movedIds = new Set(roots.map(collection => collection.id));
      workspace.collections = workspace.collections.filter(collection => !movedIds.has(collection.id));
      workspace.collections.push(...roots);
      for (const collection of roots) changed.set(collection.id, collection);
    }
    return [...changed.values()];
  });
}
export function reorderContent(collectionId: string, refs: ContentRef[]): Promise<Collection> {
  const ordered = refs.map(ref => ({ ...ref }));
  return operation(workspace => {
    const collection = requireActiveCollection(workspace, collectionId);
    const keys = new Set(ordered.map(refKey));
    if (ordered.length !== collection.items.length || keys.size !== ordered.length || collection.items.some(ref => !keys.has(refKey(ref)))) {
      throw new Error('排序内容已变化，请刷新后重试。');
    }
    collection.items = ordered;
    return collection;
  });
}
export function archiveCollection(id: string): Promise<Collection> {
  return operation(workspace => { const collection = requireNotDeletedCollection(workspace, id); collection.archivedAt ??= Date.now(); return collection; });
}
export function restoreCollection(id: string): Promise<Collection> {
  return operation(workspace => { const collection = requireNotDeletedCollection(workspace, id); delete collection.archivedAt; return collection; });
}
export function renameCollection(id: string, title: string): Promise<Collection> {
  return operation(workspace => { const collection = requireActiveCollection(workspace, id); collection.title = cleanTitle(title); return collection; });
}
export function addToCollection(id: string, ref: Ref): Promise<Collection> {
  const copied = { ...ref };
  return operation(workspace => { requireRef(workspace, copied); const collection = requireActiveCollection(workspace, id); if (!collection.items.some(item => sameRef(item, copied))) collection.items.push(copied); return collection; });
}
export function removeFromCollection(id: string, ref: Ref): Promise<Collection> {
  const copied = { ...ref };
  return operation(workspace => {
    const collection = requireActiveCollection(workspace, id);
    collection.items = collection.items.filter(item => !sameRef(item, copied));
    if (collection.titles) delete collection.titles[refKey(copied)];
    return collection;
  });
}
export function renameItem(id: string, ref: Ref, title: string): Promise<Collection> {
  const copied = { ...ref };
  return operation(workspace => {
    const collection = requireActiveCollection(workspace, id);
    if (!collection.items.some(item => sameRef(item, copied))) throw new Error('内容不在这个阅读合集中。');
    collection.titles ??= {};
    collection.titles[refKey(copied)] = cleanTitle(title);
    return collection;
  });
}
export function transferItems(input: { from?: string; to: string; refs: Ref[]; mode: 'copy' | 'move'; before?: ContentRef }): Promise<Collection[]> {
  const { from, to, mode } = input;
  const refs = input.refs.map(ref => ({ ...ref }));
  const before = input.before ? { ...input.before } : undefined;
  return operation(workspace => {
    if (mode !== 'copy' && mode !== 'move') throw new Error('整理方式无效。');
    const target = requireActiveCollection(workspace, to);
    const source = from ? requireActiveCollection(workspace, from) : undefined;
    const selected = refs.filter((ref, index) => refs.findIndex(item => sameRef(item, ref)) === index);
    for (const ref of selected) {
      requireRef(workspace, ref);
      if (source && !source.items.some(item => sameRef(item, ref))) throw new Error('待整理内容已不在来源合集中。');
    }
    if (before && !target.items.some(item => sameRef(item, before))) throw new Error('放置位置已变化，请重试。');
    if (!selected.length) return [];
    if (source === target) {
      if (before && selected.some(ref => sameRef(ref, before))) return [target];
      const ordered = target.items.filter(ref => selected.some(item => sameRef(item, ref)));
      const remaining = target.items.filter(ref => !selected.some(item => sameRef(item, ref)));
      const index = before ? remaining.findIndex(ref => sameRef(ref, before)) : remaining.length;
      remaining.splice(index, 0, ...ordered);
      target.items = remaining;
      return [target];
    }
    // Copying uses references only. Existing destination items retain their position and alias.
    const ordered = source ? source.items.filter(ref => selected.some(item => sameRef(item, ref))) : selected;
    const additions = ordered.filter(ref => !target.items.some(item => sameRef(item, ref)));
    const insertion = before ? target.items.findIndex(ref => sameRef(ref, before)) : target.items.length;
    target.items.splice(insertion, 0, ...additions);
    for (const ref of ordered) {
      const alias = source?.titles?.[refKey(ref)];
      if (alias && !target.titles?.[refKey(ref)]) { target.titles ??= {}; target.titles[refKey(ref)] = alias; }
    }
    if (source && mode === 'move') {
      source.items = source.items.filter(ref => !selected.some(item => sameRef(item, ref)));
      if (source.titles) for (const ref of selected) delete source.titles[refKey(ref)];
      return [source, target];
    }
    return [target];
  });
}
export function moveInCollection(id: string, ref: ContentRef, direction: -1 | 1): Promise<Collection> {
  const copied = { ...ref };
  return operation(workspace => {
    if (direction !== -1 && direction !== 1) throw new Error('移动方向无效。');
    const collection = requireActiveCollection(workspace, id);
    const index = collection.items.findIndex(item => sameRef(item, copied));
    if (index < 0) throw new Error('内容不在这个阅读合集中。');
    const next = index + direction;
    if (next >= 0 && next < collection.items.length) [collection.items[index], collection.items[next]] = [collection.items[next], collection.items[index]];
    return collection;
  });
}
export function getProjection(ref: Ref, state: Pick<NotebookState, 'notes' | 'entries' | 'settings'>, now = Date.now()): Projection {
  requireRef(state, ref);
  const documentId = ref.kind === 'note' ? NOTE_DOCUMENT : SECTION_DOCUMENT;
  const entry = state.entries.find(item => item.id === memoryId(documentId, ref.id));
  const projected = projectReadingMemory(entry, readingReference(ref, state).contentHash, readingMarkdown(ref, state), state.settings, now);
  return { ...projected, entry };
}
export function readingReference(ref: Ref, state: Pick<NotebookState, 'notes'>): MemoryReference {
  requireRef(state, ref);
  return ref.kind === 'section' ? legacy.reference(ref.id) : noteReference(requireNote(state, ref.id));
}
export function readingMarkdown(ref: Ref, state: Pick<NotebookState, 'notes'>): string {
  return ref.kind === 'section' ? manual.sections.find(section => section.id === ref.id)!.parts.map(part => part.markdown).join('\n\n') : requireNote(state, ref.id).markdown;
}
function memoryOperation(ref: Ref, kind: 'enroll' | 'remove'): Promise<MemoryEntry> {
  const copied = { ...ref };
  return serialize(async () => {
    await ensureMigrated();
    const { workspace } = await snapshot();
    requireRef(workspace, copied);
    if (copied.kind === 'section') return kind === 'enroll' ? legacy.enroll(copied.id) : legacy.removeMemory(copied.id);
    const note = requireNote(workspace, copied.id);
    if (kind === 'remove') return removeMemory(memoryId(NOTE_DOCUMENT, copied.id));
    if (note.archivedAt !== undefined) throw new Error('请先恢复这条笔记。');
    if (note.kind === 'document' && !workspace.collections.some(collection => !isCollectionDeleted(collection.id, workspace) && collection.items.some(ref => sameRef(ref, copied)))) throw new Error('正文已被删除，请先从回收站恢复。');
    const reference = noteReference(note);
    return enrollMemory(reference);
  });
}
export const enrollRef = (ref: Ref) => memoryOperation(ref, 'enroll');
export const removeRef = (ref: Ref) => memoryOperation(ref, 'remove');

export function recordRef(ref: Ref, evidence: { source: 'focus' | 'manual'; sessionId: string; contentHash?: string; activeMs?: number; coverage?: number }, now = Date.now()) {
  return serialize(async () => {
    await ensureMigrated();
    const { workspace } = await snapshot();
    const reference = readingReference(ref, workspace);
    if (ref.kind === 'note' && requireNote(workspace, ref.id).archivedAt !== undefined) throw new Error('请先恢复这条笔记。');
    if (ref.kind === 'note' && requireNote(workspace, ref.id).kind === 'document' && !workspace.collections.some(collection => !isCollectionDeleted(collection.id, workspace) && collection.items.some(item => sameRef(item, ref)))) throw new Error('正文已被删除，本次停留未计入。');
    if (evidence.contentHash && evidence.contentHash !== reference.contentHash) throw new Error('内容已变更，本次停留未计入新版。');
    if (evidence.source === 'focus' && (evidence.activeMs ?? 0) < requiredActiveMs(estimateSeconds(readingMarkdown(ref, workspace)))) throw new Error('有效阅读时间不足。');
    return recordMemoryExposure(reference, evidence, now);
  });
}
/** Compatibility for existing callers; new UI uses recorded to distinguish a merged read. */
export async function readRef(ref: Ref, now = Date.now()) {
  return (await recordRef(ref, { source: 'manual', sessionId: crypto.randomUUID() }, now)).entry;
}
export const undoRef = (ref: Ref, eventId: string) => undoMemoryRead(memoryId(ref.kind === 'note' ? NOTE_DOCUMENT : SECTION_DOCUMENT, ref.id), eventId);
export const setRefPriority = (ref: Ref, value: number | undefined) => saveMemoryPriority(memoryId(ref.kind === 'note' ? NOTE_DOCUMENT : SECTION_DOCUMENT, ref.id), value);
export const setReadingSettings = (settings: MemorySettingsValue) => saveMemorySettings(settings);
export function applyAiPriorities(results: MemoryPriorityAssessment[]) {
  return serialize(async () => {
    const { workspace } = await snapshot();
    // Validate the whole response before writing anything; stale AI work never replaces current content scores.
    const checked = results.map(result => {
      const separator = result.id.indexOf(':');
      const kind = result.id.slice(0, separator);
      if (kind !== 'note' && kind !== 'section') throw new Error('评分内容标识无效。');
      const ref: Ref = { kind, id: result.id.slice(separator + 1) };
      const reference = readingReference(ref, workspace);
      if (reference.contentHash !== result.contentHash) throw new Error('评分期间内容已变更，请重新评分。');
      return { reference, result };
    });
    await saveMemoryAiPriorities(checked.map(({ reference, result }) => ({ id: memoryId(reference.documentId, reference.sectionId), assessment: result })));
  });
}
