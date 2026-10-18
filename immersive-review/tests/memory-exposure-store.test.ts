import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { enrollMemory, MEMORY_DB, memoryId, readMemoryState, recordManualRead, recordMemoryExposure,
  removeMemory, saveMemoryAiPriority, saveMemoryAiPriorities, saveMemoryPriority, undoMemoryRead, type MemoryAiPriority,
  saveMemorySettings, type MemoryEntry, type MemoryReference } from '../src/memory/memory-store.mjs';
import { projectReadingMemory } from '../src/notebook/memory-policy';

const T = Date.UTC(2026, 9, 17, 4);
const HOUR = 3_600_000;
const HASH = `sha256:${'a'.repeat(64)}`;
const OTHER = `sha256:${'b'.repeat(64)}`;
const ref: MemoryReference = { documentId: 'book', sectionId: 'note', documentTitle: '书', title: '节', contentHash: HASH, documentRevision: HASH, sectionVersion: 1 };
const id = memoryId(ref.documentId, ref.sectionId);
const exposure = (sessionId: string) => ({ source: 'focus' as const, sessionId, activeMs: 60_000, coverage: 0.8 });
const ai: MemoryAiPriority = { score: 0.8, reason: '理解后续内容的基础', contentHash: HASH, goal: '开发', providerId: 'deepseek', model: 'test', rubricVersion: '1', scoredAt: T };
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

async function writeRaw(entry: MemoryEntry) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(MEMORY_DB, 1);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('entries', 'readwrite');
      tx.objectStore('entries').put(entry);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  });
}

describe('Atomic memory exposure storage', () => {
  it('deduplicates simultaneous exposure callbacks in one transaction and keeps one event id', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => recordMemoryExposure(ref, exposure(`tab-${i}`), T)));
    expect(results.filter(result => result.recorded)).toHaveLength(1);
    expect((await readMemoryState()).entries[0].events).toHaveLength(1);
    expect(results.find(result => result.recorded)?.eventId).toBe((await readMemoryState()).entries[0].events[0].id);
    expect((await readMemoryState()).entries[0]).toMatchObject({ id, title: ref.title, documentId: ref.documentId, active: true, addedAt: T });
  });

  it('suppresses same-session repeats even hours later and accepts a new session at exactly thirty minutes', async () => {
    await enrollMemory(ref, T);
    const first = await recordMemoryExposure(ref, exposure('one'), T);
    expect((await recordMemoryExposure(ref, exposure('two'), T + 29 * 60_000)).recorded).toBe(false);
    expect((await recordMemoryExposure(ref, exposure('one'), T + 3 * HOUR)).recorded).toBe(false);
    expect((await recordMemoryExposure(ref, exposure('two'), T + 30 * 60_000)).recorded).toBe(true);
    expect((await readMemoryState()).entries[0].events[0]).toEqual(first.entry.events[0]);
  });

  it('respects legacy activity without rewriting old fields or appending a nearby new click', async () => {
    await enrollMemory(ref, T);
    const old = await recordManualRead(ref, T);
    const duplicate = await recordMemoryExposure(ref, { source: 'manual', sessionId: 'manual-new' }, T + 1000);
    expect(duplicate.recorded).toBe(false);
    expect(duplicate.entry).toEqual(old);
    const later = await recordMemoryExposure(ref, exposure('later'), T + HOUR);
    expect(later.entry.events[0]).toEqual(old.events[0]);
    expect(later.entry.events[0]).not.toHaveProperty('source');
    expect(later.entry.events[1].source).toBe('focus');
  });

  it('undo consumes the old session while allowing an explicit new session and preserving the voided log', async () => {
    await enrollMemory(ref, T);
    const first = await recordMemoryExposure(ref, exposure('one'), T);
    const undone = await undoMemoryRead(id, first.eventId!, T + 1000);
    expect(undone.events[0].voidedAt).toBe(T + 1000);
    expect((await recordMemoryExposure(ref, exposure('one'), T + 2000)).recorded).toBe(false);
    const reread = await recordMemoryExposure(ref, exposure('new-session'), T + 2000);
    expect(reread.recorded).toBe(true);
    expect(reread.entry.events).toHaveLength(2);
    expect(reread.entry.events[0]).toEqual(undone.events[0]);
    const projection = projectReadingMemory(reread.entry, HASH, '正文', undefined, T + 2000);
    expect(projection.readCount).toBe(1);
    expect(projection.history).toHaveLength(2);
  });

  it('does not let future-dated activity or other content versions suppress the current read', async () => {
    await enrollMemory(ref, T);
    await recordManualRead(ref, T + 3 * HOUR);
    const current = await recordMemoryExposure(ref, exposure('current'), T);
    expect(current.recorded).toBe(true);
    const changed = await recordMemoryExposure({ ...ref, contentHash: OTHER, documentRevision: OTHER, sectionVersion: 2 }, exposure('current'), T + 1000);
    expect(changed.recorded).toBe(true);
    expect(changed.entry.events).toHaveLength(3);
  });

  it('ignores invalid old automated evidence during duplicate detection', async () => {
    const enrolled = await enrollMemory(ref, T);
    await writeRaw({ ...enrolled, events: [{ id: 'invalid-focus', at: T, contentHash: HASH, documentRevision: HASH, sectionVersion: 1,
      source: 'focus', sessionId: 'old', activeMs: 1, coverage: 1 }] });
    expect((await recordMemoryExposure(ref, exposure('current'), T)).recorded).toBe(true);
  });

  it('requires valid focus evidence before auto-enrolling; manual supplementation is an explicit source', async () => {
    await expect(recordMemoryExposure(ref, { source: 'manual', sessionId: 'manual-before' }, T)).rejects.toThrow('纳入记忆库');
    for (const invalid of [{ ...exposure('one'), activeMs: 19_999 }, { ...exposure('one'), coverage: 0.64 }, { ...exposure('one'), coverage: 1.1 }, { ...exposure('one'), activeMs: Infinity }]) {
      await expect(recordMemoryExposure(ref, invalid, T)).rejects.toThrow('不足');
    }
    await expect(recordMemoryExposure(ref, exposure(''), T)).rejects.toThrow('身份');
    await expect(recordMemoryExposure(ref, exposure('one'), NaN)).rejects.toThrow('时间');
    expect((await readMemoryState()).entries).toHaveLength(0);
    await enrollMemory(ref, T);
    const manual = await recordMemoryExposure(ref, { source: 'manual', sessionId: 'manual-one' }, T);
    expect(manual.entry.events[0].source).toBe('manual');
    expect(manual.entry.events[0]).not.toHaveProperty('activeMs');
  });

  it('removal blocks new exposure but reenrollment retains previous logs and priority', async () => {
    await enrollMemory(ref, T);
    await recordMemoryExposure(ref, exposure('one'), T);
    await saveMemoryPriority(id, 0.75);
    const removed = await removeMemory(id);
    expect(removed.trackingPaused).toBe(true);
    expect(await recordMemoryExposure(ref, exposure('two'), T + HOUR)).toEqual({ entry: removed, recorded: false });
    const restored = await enrollMemory(ref, T + HOUR);
    expect(restored.events).toEqual(removed.events);
    expect(restored.priority).toEqual(removed.priority);
    expect(restored.trackingPaused).toBe(false);
    expect((await recordMemoryExposure(ref, exposure('two'), T + HOUR)).recorded).toBe(true);
  });

  it('migrates historical inactive entries on valid reading without deleting their history or override', async () => {
    await enrollMemory(ref, T - HOUR);
    const read = await recordManualRead(ref, T - HOUR);
    const legacy = { ...read, active: false, priority: { manual: 0.7 } };
    delete legacy.trackingPaused;
    await writeRaw(legacy);
    const result = await recordMemoryExposure(ref, exposure('current'), T);
    expect(result.recorded).toBe(true);
    expect(result.entry.addedAt).toBe(T - HOUR);
    expect(result.entry.events[0]).toEqual(legacy.events[0]);
    expect(result.entry.priority).toEqual(legacy.priority);
    expect(result.entry.active).toBe(true);
  });

  it('reactivates a legacy inactive entry even when a nearby old reading suppresses the new fact', async () => {
    await enrollMemory(ref, T);
    const read = await recordManualRead(ref, T);
    const legacy = { ...read, active: false };
    delete legacy.trackingPaused;
    await writeRaw(legacy);
    const result = await recordMemoryExposure(ref, exposure('current'), T + 1000);
    expect(result.recorded).toBe(false);
    expect(result.entry.active).toBe(true);
    expect(result.entry.events).toEqual(legacy.events);
    expect((await readMemoryState()).entries[0]).toEqual(result.entry);
  });
});

describe('Independent memory priority settings', () => {
  it('manual adjustment wins, clearing it restores AI, and learning history remains identical', async () => {
    await enrollMemory(ref, T);
    const reading = await recordMemoryExposure(ref, exposure('one'), T);
    await saveMemoryAiPriority(id, ai);
    const manual = await saveMemoryPriority(id, 0);
    expect(manual.priority).toEqual({ manual: 0, ai });
    const updatedAi = await saveMemoryAiPriority(id, { ...ai, score: 0.9 });
    expect(updatedAi.priority?.manual).toBe(0);
    const cleared = await saveMemoryPriority(id);
    expect(cleared.priority).toEqual({ ai: { ...ai, score: 0.9 } });
    expect(cleared.events).toEqual(reading.entry.events);
  });

  it('serializes simultaneous manual and AI updates without losing either field', async () => {
    await enrollMemory(ref, T);
    await Promise.all([saveMemoryPriority(id, 0.25), saveMemoryAiPriority(id, ai)]);
    expect((await readMemoryState()).entries[0].priority).toEqual({ manual: 0.25, ai });
  });

  it('rejects malformed scores and metadata without changing the existing entry', async () => {
    const enrolled = await enrollMemory(ref, T);
    for (const invalid of [-0.1, 1.1, NaN, Infinity]) await expect(saveMemoryPriority(id, invalid)).rejects.toThrow('重要性');
    for (const invalid of [{ ...ai, score: 2 }, { ...ai, contentHash: 'wrong' }, { ...ai, reason: '' }, { ...ai, model: '' }, { ...ai, scoredAt: Infinity }]) {
      await expect(saveMemoryAiPriority(id, invalid)).rejects.toThrow('格式');
    }
    expect((await readMemoryState()).entries[0]).toEqual(enrolled);
  });

  it('atomically writes a bounded batch while retaining manual priorities and unrelated fields', async () => {
    const secondRef = { ...ref, sectionId: 'other' };
    const secondId = memoryId(secondRef.documentId, secondRef.sectionId);
    await enrollMemory(ref, T);
    await enrollMemory(secondRef, T);
    await saveMemoryPriority(id, 0.2);
    const saved = await saveMemoryAiPriorities([{ id, assessment: ai }, { id: secondId, assessment: { ...ai, contentHash: OTHER } }]);
    expect(saved.map(item => item.id)).toEqual([id, secondId]);
    expect(saved[0].priority).toEqual({ manual: 0.2, ai });
    expect(saved[1].priority?.ai?.contentHash).toBe(OTHER);
    expect(saved.every(item => item.events.length === 0)).toBe(true);
  });

  it('rolls back the entire scoring batch if a later item is removed or invalid', async () => {
    const secondRef = { ...ref, sectionId: 'other' };
    const secondId = memoryId(secondRef.documentId, secondRef.sectionId);
    await enrollMemory(ref, T);
    await enrollMemory(secondRef, T);
    await saveMemoryAiPriority(id, ai);
    await removeMemory(secondId);
    const before = await readMemoryState();
    await expect(saveMemoryAiPriorities([{ id, assessment: { ...ai, score: 0.1 } }, { id: secondId, assessment: ai }])).rejects.toThrow('未保存');
    expect(await readMemoryState()).toEqual(before);
    await expect(saveMemoryAiPriorities([{ id, assessment: ai }, { id: secondId, assessment: { ...ai, score: NaN } }])).rejects.toThrow('格式');
    expect(await readMemoryState()).toEqual(before);
  });

  it('rejects empty, oversized, and duplicate-id batches before writing', async () => {
    const enrolled = await enrollMemory(ref, T);
    await expect(saveMemoryAiPriorities([])).rejects.toThrow('1～20');
    await expect(saveMemoryAiPriorities(Array.from({ length: 21 }, (_, index) => ({ id: `id-${index}`, assessment: ai })))).rejects.toThrow('1～20');
    await expect(saveMemoryAiPriorities([{ id, assessment: ai }, { id, assessment: ai }])).rejects.toThrow('重复');
    expect((await readMemoryState()).entries[0]).toEqual(enrolled);
  });

  it('preserves relative comparison metadata while continuing to accept historical AI scores', async () => {
    await enrollMemory(ref, T);
    const relative = { ...ai, rubricVersion: 'memory-title-priority/2', rank: 2, populationSize: 20 };
    const result = await saveMemoryAiPriority(id, relative);
    expect(result.priority?.ai).toEqual(relative);
    for (const invalid of [{ ...relative, rank: 0 }, { ...relative, rank: 21 }, { ...relative, populationSize: 21 }, { ...relative, rank: undefined }]) {
      await expect(saveMemoryAiPriority(id, invalid)).rejects.toThrow('排名');
    }
    expect((await saveMemoryAiPriority(id, ai)).priority?.ai).toEqual(ai);
  });

  it('stores twenty comparisons atomically', async () => {
    const refs = Array.from({ length: 20 }, (_, index) => ({ ...ref, sectionId: `recent-${index}` }));
    await Promise.all(refs.map(item => recordMemoryExposure(item, exposure('read'), T)));
    const updates = refs.map((item, index) => ({ id: memoryId(item.documentId, item.sectionId), assessment: {
      ...ai, rubricVersion: 'memory-title-priority/2', rank: index + 1, populationSize: 20,
    } }));
    expect(await saveMemoryAiPriorities(updates)).toHaveLength(20);
    expect((await readMemoryState()).entries.every(item => item.priority?.ai?.populationSize === 20)).toBe(true);
  });
});

describe('Memory coefficient settings', () => {
  it('defaults both coefficients and preserves independent settings on legacy writes', async () => {
    expect((await readMemoryState()).settings).toEqual({ retentionScale: 1, forgettingExponent: 1 });
    await saveMemorySettings({ retentionScale: 2, forgettingExponent: 1.8 });
    await saveMemorySettings({ retentionScale: 3 });
    expect((await readMemoryState()).settings).toEqual({ retentionScale: 3, forgettingExponent: 1.8 });
  });

  it('upgrades the read view of a legacy profile without rewriting reading facts', async () => {
    const reading = await recordMemoryExposure(ref, exposure('one'), T);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(MEMORY_DB, 1);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('settings', 'readwrite');
        tx.objectStore('settings').put({ retentionScale: 2.5 }, 'profile');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    const state = await readMemoryState();
    expect(state.settings).toEqual({ retentionScale: 2.5, forgettingExponent: 1 });
    expect(state.entries[0]).toEqual(reading.entry);
  });

  it('rejects invalid forgetting coefficients without modifying saved settings or events', async () => {
    await recordMemoryExposure(ref, exposure('one'), T);
    await saveMemorySettings({ retentionScale: 1, forgettingExponent: 1.5 });
    const before = await readMemoryState();
    for (const forgettingExponent of [0.49, 2.01, NaN, Infinity]) {
      await expect(saveMemorySettings({ retentionScale: 1, forgettingExponent })).rejects.toThrow('0.5～2');
    }
    expect(await readMemoryState()).toEqual(before);
  });
});
