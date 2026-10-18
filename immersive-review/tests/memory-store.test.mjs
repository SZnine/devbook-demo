import 'fake-indexeddb/auto';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { enrollMemory, removeMemory, recordManualRead, undoMemoryRead, readMemoryState, saveMemorySettings } from '../src/memory/memory-store.mjs';
const ref = { documentId: 'test-memory', sectionId: 'one', documentTitle: '测试', title: '一节', contentHash: `sha256:${'1'.repeat(64)}`, documentRevision: `sha256:${'2'.repeat(64)}`, sectionVersion: 1 };

test('收录不制造已读，取消收录保留日志，再纳入恢复原记录', async () => {
  const first = await enrollMemory(ref, 1000); assert.deepEqual(first.events, []);
  const read = await recordManualRead(ref, 2000); assert.equal(read.events.length, 1);
  const removed = await removeMemory(first.id); assert.equal(removed.active, false); assert.deepEqual(removed.events, read.events);
  await assert.rejects(recordManualRead(ref, 3000), /纳入记忆库/);
  const restored = await enrollMemory(ref, 4000); assert.equal(restored.addedAt, 1000); assert.deepEqual(restored.events, read.events);
});
test('并发显式活动原子追加，各自保留内容版本，撤销留痕且幂等', async () => {
  const other = { ...ref, sectionId: 'concurrent' };
  await enrollMemory(other, 1000);
  await Promise.all([recordManualRead(other, 2000), recordManualRead({ ...other, contentHash: `sha256:${'3'.repeat(64)}`, sectionVersion: 2 }, 3000)]);
  const item = (await readMemoryState()).entries.find(entry => entry.sectionId === other.sectionId);
  assert.equal(item.events.length, 2); assert.deepEqual(item.events.map(event => event.sectionVersion).sort(), [1, 2]);
  const undone = await undoMemoryRead(item.id, item.events[0].id, 4000);
  const repeated = await undoMemoryRead(item.id, item.events[0].id, 5000);
  assert.deepEqual(repeated, undone); assert.equal(undone.events[0].voidedAt, 4000); assert.equal(undone.events.length, 2);
});
test('系数存储隔离于活动事实，非法系数不能落盘', async () => {
  const before = (await readMemoryState()).entries;
  await saveMemorySettings({ retentionScale: 2 });
  await assert.rejects(saveMemorySettings({ retentionScale: 10 }), /0.25/);
  const after = await readMemoryState(); assert.equal(after.settings.retentionScale, 2); assert.deepEqual(after.entries, before);
});
