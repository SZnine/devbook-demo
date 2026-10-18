import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { contentFingerprint, projectMemory, type MemoryProjection } from '../memory/memory-engine.mjs';
import {
  enrollMemory, memoryId, readMemoryState, recordManualRead, removeMemory as removeEntry,
  type MemoryEntry, type MemoryReference, type MemorySettingsValue,
} from '../memory/memory-store.mjs';
import manual from './manual.json';

export type { MemoryEntry, MemoryProjection, MemorySettingsValue };
export type Memo = { id: string; sectionId: string; markdown: string; createdAt: number; updatedAt: number; archivedAt?: number };
export type Draft = { sectionId: string; markdown: string; editingId?: string };

const DOCUMENT_ID = `read-manual:${manual.documentId}`;
const MEMO_DB = 'read-manual-memos-v1';
const sections = new Map(manual.sections.map(section => [section.id, section]));
const fingerprints = new Map(manual.sections.map(section => [section.id, contentFingerprint(section)]));
// Personal memos never enter the source identity or invalidate its memory history.
const documentRevision = `sha256:${bytesToHex(sha256(new TextEncoder().encode(JSON.stringify({
  documentId: DOCUMENT_ID, title: manual.title, sections: [...fingerprints],
}))))}`;

let writes: Promise<void> = Promise.resolve();
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = writes.then(operation);
  writes = result.then(() => undefined, () => undefined);
  return result;
}
function requireSection(sectionId: string) {
  const section = sections.get(sectionId);
  if (!section) throw new Error('这一节不存在，请刷新手册后重试。');
  return section;
}
export function reference(sectionId: string): MemoryReference {
  const section = requireSection(sectionId);
  return { documentId: DOCUMENT_ID, documentTitle: manual.title, documentRevision,
    sectionId, title: section.title, sectionVersion: 1, contentHash: fingerprints.get(sectionId)! };
}
function requireTime(now: number) {
  if (!Number.isFinite(now) || now < 0 || now > 8_640_000_000_000_000) throw new Error('记录时间无效。');
}
function requireMarkdown(markdown: string) {
  if (typeof markdown !== 'string' || markdown.length > 2_000_000) throw new Error('随笔内容无效或过长。');
}
function requireMemo(value: Memo | undefined): Memo {
  if (!value || !sections.has(value.sectionId)) throw new Error('这条随笔不存在。');
  return value;
}

function openMemoDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MEMO_DB, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      request.result.createObjectStore('memos', { keyPath: 'id' });
      request.result.createObjectStore('drafts', { keyPath: 'sectionId' });
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(new Error('无法打开本地随笔。'));
    request.onblocked = () => { blocked = true; reject(new Error('随笔存储被其他标签页占用，请关闭后重试。')); };
  });
}

/** All memo/draft writes finish on transaction commit, not on the individual request. */
async function memoTransaction<T>(run: (memos: IDBObjectStore, drafts: IDBObjectStore, done: (value: T) => void, fail: (reason: unknown) => void) => void): Promise<T> {
  const db = await openMemoDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['memos', 'drafts'], 'readwrite');
    let result: T;
    let failure: unknown;
    const fail = (reason: unknown) => { failure = reason; tx.abort(); };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = () => { db.close(); reject(failure ?? new Error('随笔保存失败，本次修改未计入。')); };
    try { run(tx.objectStore('memos'), tx.objectStore('drafts'), value => { result = value; }, fail); }
    catch (reason) { fail(reason); }
  });
}

export async function loadBusiness(): Promise<{ entries: MemoryEntry[]; memos: Memo[]; drafts: Draft[]; settings: MemorySettingsValue }> {
  await writes;
  const memory = await readMemoryState();
  const db = await openMemoDatabase();
  const notes = await new Promise<{ memos: Memo[]; drafts: Draft[] }>((resolve, reject) => {
    const tx = db.transaction(['memos', 'drafts'], 'readonly');
    const memos = tx.objectStore('memos').getAll();
    const drafts = tx.objectStore('drafts').getAll();
    tx.oncomplete = () => {
      db.close();
      resolve({ memos: (memos.result as Memo[]).filter(memo => sections.has(memo.sectionId)),
        drafts: (drafts.result as Draft[]).filter(draft => sections.has(draft.sectionId)) });
    };
    tx.onabort = () => { db.close(); reject(new Error('随笔读取失败，原记录未修改。')); };
  });
  return { ...notes, entries: memory.entries.filter(entry => entry.documentId === DOCUMENT_ID && sections.has(entry.sectionId)), settings: memory.settings };
}

export function enroll(sectionId: string): Promise<MemoryEntry> {
  return serialize(() => enrollMemory(reference(sectionId)));
}
export function recordRead(sectionId: string): Promise<MemoryEntry> {
  return serialize(() => recordManualRead(reference(sectionId)));
}
export function removeMemory(sectionId: string): Promise<MemoryEntry> {
  return serialize(() => { requireSection(sectionId); return removeEntry(memoryId(DOCUMENT_ID, sectionId)); });
}
export function projection(entry: MemoryEntry | null | undefined, sectionId: string, settings: MemorySettingsValue, now: number): MemoryProjection {
  requireSection(sectionId);
  const belongs = entry?.documentId === DOCUMENT_ID && entry.sectionId === sectionId;
  return projectMemory(belongs ? entry : null, fingerprints.get(sectionId)!, settings, now);
}

export function saveMemo(input: { id?: string; sectionId: string; markdown: string }, now = Date.now()): Promise<Memo> {
  // Capture input before queueing: later editor changes cannot alter this save.
  const { id, sectionId, markdown } = input;
  return serialize(async () => {
    requireSection(sectionId); requireMarkdown(markdown); requireTime(now);
    if (!markdown.trim()) throw new Error('请先写下随笔内容。');
    return memoTransaction<Memo>((memos, drafts, done, fail) => {
      const save = (previous?: Memo) => {
        try {
          if (id) {
            requireMemo(previous);
            if (previous!.sectionId !== sectionId) throw new Error('不能把随笔移到另一节。');
            if (previous!.archivedAt !== undefined) throw new Error('请先恢复这条随笔，再进行编辑。');
          }
          const memo: Memo = { id: id ?? crypto.randomUUID(), sectionId, markdown,
            createdAt: previous?.createdAt ?? now, updatedAt: now };
          memos.put(memo); drafts.delete(sectionId); done(memo);
        } catch (reason) { fail(reason); }
      };
      if (id) { const request = memos.get(id); request.onsuccess = () => save(request.result as Memo | undefined); }
      else save();
    });
  });
}

function changeArchive(id: string, archived: boolean): Promise<Memo> {
  return serialize(() => memoTransaction<Memo>((memos, _drafts, done, fail) => {
    const request = memos.get(id);
    request.onsuccess = () => {
      try {
        const previous = requireMemo(request.result as Memo | undefined);
        const memo = { ...previous };
        if (archived) memo.archivedAt ??= Date.now();
        else delete memo.archivedAt;
        memos.put(memo); done(memo);
      } catch (reason) { fail(reason); }
    };
  }));
}
export const archiveMemo = (id: string): Promise<Memo> => changeArchive(id, true);
export const restoreMemo = (id: string): Promise<Memo> => changeArchive(id, false);

export function saveDraft(input: Draft): Promise<void> {
  const { sectionId, markdown, editingId } = input;
  return serialize(async () => {
    requireSection(sectionId); requireMarkdown(markdown);
    return memoTransaction<void>((memos, drafts, done, fail) => {
      const save = () => {
        if (!markdown.trim()) drafts.delete(sectionId);
        else drafts.put({ sectionId, markdown, ...(editingId ? { editingId } : {}) });
        done(undefined);
      };
      if (!markdown.trim() || !editingId) { save(); return; }
      const request = memos.get(editingId);
      request.onsuccess = () => {
        try {
          const previous = requireMemo(request.result as Memo | undefined);
          if (previous.sectionId !== sectionId || previous.archivedAt !== undefined) throw new Error('这条随笔当前不能编辑。');
          save();
        } catch (reason) { fail(reason); }
      };
    });
  });
}
