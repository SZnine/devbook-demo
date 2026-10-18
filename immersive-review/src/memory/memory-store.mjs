// Read activity is isolated from content import/version transactions. Neither can fabricate the other.
export const MEMORY_DB = 'read-content-memory-v1';
export const MEMORY_CHANGED_EVENT = 'read-memory-changed';
export const MEMORY_CHANGED_CHANNEL = 'read-memory-changed';
export const defaultMemorySettings = Object.freeze({ retentionScale: 1, forgettingExponent: 1 });
const MAX_TIME = 8_640_000_000_000_000;
const MERGE_GAP_MS = 30 * 60_000;
const validTime = value => Number.isFinite(value) && value >= 0 && value <= MAX_TIME;
function normalizeSettings(settings) {
  return {
    retentionScale: Number.isFinite(settings?.retentionScale) && settings.retentionScale >= 0.25 && settings.retentionScale <= 4 ? settings.retentionScale : 1,
    forgettingExponent: Number.isFinite(settings?.forgettingExponent) && settings.forgettingExponent >= 0.5 && settings.forgettingExponent <= 2 ? settings.forgettingExponent : 1,
  };
}
function notifyMemoryChange(id) {
  if (typeof window === 'undefined') return;
  try { window.dispatchEvent(new CustomEvent(MEMORY_CHANGED_EVENT, { detail: { id } })); }
  catch { /* A committed transaction remains successful if the UI is already closing. */ }
  // A short-lived sender avoids pinning workers/tabs. Receivers own their subscriptions.
  if (typeof BroadcastChannel !== 'undefined') {
    try { const channel = new BroadcastChannel(MEMORY_CHANGED_CHANNEL); channel.postMessage({ id }); channel.close(); }
    catch { /* Persistence succeeded; notification availability cannot turn it into a failure. */ }
  }
}
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MEMORY_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('entries', { keyPath: 'id' });
      request.result.createObjectStore('settings');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开本地记忆库。'));
  });
}
export const memoryId = (documentId, sectionId) => JSON.stringify([documentId, sectionId]);
export async function readMemoryState() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['entries', 'settings'], 'readonly');
    const entries = transaction.objectStore('entries').getAll();
    const settings = transaction.objectStore('settings').get('profile');
    transaction.oncomplete = () => {
      db.close(); resolve({ entries: entries.result, settings: normalizeSettings(settings.result) });
    };
    transaction.onabort = () => { db.close(); reject(new Error('记忆库读取失败，原记录未修改。')); };
  });
}
function validReference(ref) {
  if (!ref || !ref.documentId || !ref.sectionId || typeof ref.title !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(ref.contentHash) ||
    !/^sha256:[a-f0-9]{64}$/.test(ref.documentRevision) || !Number.isInteger(ref.sectionVersion) || ref.sectionVersion < 1) throw new Error('内容身份无效，请刷新材料后重试。');
}
async function changeEntry(id, change) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('entries', 'readwrite');
    const store = transaction.objectStore('entries');
    const request = store.get(id);
    let saved, problem;
    request.onsuccess = () => {
      try { saved = change(request.result || null); store.put(saved); }
      catch (error) { problem = error; transaction.abort(); }
    };
    transaction.oncomplete = () => { db.close(); notifyMemoryChange(id); resolve(saved); };
    transaction.onabort = () => { db.close(); reject(problem || new Error('记忆活动保存失败，本次未计入。')); };
  });
}
export async function enrollMemory(ref, now = Date.now()) {
  validReference(ref);
  const id = memoryId(ref.documentId, ref.sectionId);
  return changeEntry(id, previous => ({ ...(previous || { id, addedAt: now, events: [] }),
    documentId: ref.documentId, sectionId: ref.sectionId, documentTitle: ref.documentTitle, title: ref.title, active: true, trackingPaused: false }));
}
export async function removeMemory(id) {
  return changeEntry(id, previous => {
    if (!previous) throw new Error('这部分还未加入记忆库。');
    return { ...previous, active: false, trackingPaused: true };
  });
}
export async function recordManualRead(ref, now = Date.now()) {
  validReference(ref);
  if (!Number.isFinite(now) || now < 0) throw new Error('记录时间无效。');
  return changeEntry(memoryId(ref.documentId, ref.sectionId), previous => {
    if (!previous?.active) throw new Error('请先将这部分纳入记忆库。');
    const event = { id: crypto.randomUUID(), at: now, contentHash: ref.contentHash, sectionVersion: ref.sectionVersion, documentRevision: ref.documentRevision };
    return { ...previous, title: ref.title, documentTitle: ref.documentTitle, events: [...previous.events, event] };
  });
}
/**
 * Check and append in one IDB read/write transaction. Multiple observers/tabs cannot
 * inflate the count; suppressed repeats never move the stored episode's timestamp.
 */
export async function recordMemoryExposure(ref, exposure, now = Date.now()) {
  validReference(ref);
  if (!validTime(now)) throw new Error('记录时间无效。');
  if (!exposure || !['manual', 'focus'].includes(exposure.source) || typeof exposure.sessionId !== 'string'
    || !exposure.sessionId.trim() || exposure.sessionId.length > 256) throw new Error('阅读活动身份无效。');
  if (exposure.source === 'focus' && (!Number.isFinite(exposure.activeMs) || exposure.activeMs < 20_000
    || !Number.isFinite(exposure.coverage) || exposure.coverage < 0.65 || exposure.coverage > 1)) throw new Error('阅读时间或正文覆盖不足，本次未计入。');
  const id = memoryId(ref.documentId, ref.sectionId);
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('entries', 'readwrite');
    const store = transaction.objectStore('entries');
    const request = store.get(id);
    let result, problem, changed = false;
    request.onsuccess = () => {
      try {
        const stored = request.result;
        if (exposure.source === 'focus' && stored?.trackingPaused) { result = { entry: stored, recorded: false }; return; }
        if (exposure.source === 'manual' && !stored?.active) throw new Error('请先将这部分纳入记忆库。');
        // Automatic reading creates its entry and fact together. Old inactive entries
        // without an explicit pause flag migrate on valid reading, retaining every log.
        const previous = stored?.active ? stored : {
          ...(stored || { id, addedAt: now, events: [] }),
          documentId: ref.documentId, sectionId: ref.sectionId,
          documentTitle: ref.documentTitle, title: ref.title, active: true, trackingPaused: false,
        };
        const duplicate = previous.events.some(event => event && typeof event.id === 'string' && event.id
          && validTime(event.at) && event.at <= now && event.contentHash === ref.contentHash
          && (event.source === undefined || event.source === 'manual'
            || (event.source === 'focus' && typeof event.sessionId === 'string' && event.sessionId
              && Number.isFinite(event.activeMs) && event.activeMs >= 20_000
              && Number.isFinite(event.coverage) && event.coverage >= 0.65 && event.coverage <= 1))
          // Undo consumes that session too: an observer retry must not resurrect a withdrawn activity.
          && (event.sessionId === exposure.sessionId || (event.voidedAt == null && now - event.at < MERGE_GAP_MS)));
        if (duplicate) {
          if (previous !== stored) { store.put(previous); changed = true; }
          result = { entry: previous, recorded: false }; return;
        }
        const event = { id: crypto.randomUUID(), at: now, contentHash: ref.contentHash,
          sectionVersion: ref.sectionVersion, documentRevision: ref.documentRevision,
          source: exposure.source, sessionId: exposure.sessionId,
          ...(exposure.source === 'focus' ? { activeMs: exposure.activeMs, coverage: exposure.coverage } : {}) };
        const entry = { ...previous, title: ref.title, documentTitle: ref.documentTitle, events: [...previous.events, event] };
        store.put(entry);
        changed = true;
        result = { entry, recorded: true, eventId: event.id };
      } catch (error) { problem = error; transaction.abort(); }
    };
    transaction.oncomplete = () => { db.close(); if (changed) notifyMemoryChange(id); resolve(result); };
    transaction.onabort = () => { db.close(); reject(problem || new Error('记忆活动保存失败，本次未计入。')); };
  });
}
export async function saveMemoryPriority(id, manual) {
  if (manual !== undefined && (!Number.isFinite(manual) || manual < 0 || manual > 1)) throw new Error('重要性应在 0～1 之间。');
  return changeEntry(id, previous => {
    if (!previous?.active) throw new Error('请先将这部分纳入记忆库。');
    const priority = { ...previous.priority };
    if (manual === undefined) delete priority.manual;
    else priority.manual = manual;
    return { ...previous, priority };
  });
}
function validateAiPriority(assessment) {
  if (!assessment || !Number.isFinite(assessment.score) || assessment.score < 0 || assessment.score > 1
    || !/^sha256:[a-f0-9]{64}$/.test(assessment.contentHash) || !validTime(assessment.scoredAt)
    || typeof assessment.reason !== 'string' || !assessment.reason.trim() || assessment.reason.length > 2_000
    || typeof assessment.goal !== 'string' || assessment.goal.length > 2_000
    || !['providerId', 'model', 'rubricVersion'].every(key => typeof assessment[key] === 'string' && assessment[key].trim() && assessment[key].length <= 256)) {
    throw new Error('AI 重要性结果格式无效。');
  }
  const hasRank = assessment.rank !== undefined || assessment.populationSize !== undefined || assessment.rubricVersion === 'memory-title-priority/2' || assessment.rubricVersion === 'memory-context-priority/3';
  if (hasRank && (!Number.isInteger(assessment.rank) || !Number.isInteger(assessment.populationSize)
    || assessment.populationSize < 1 || assessment.populationSize > 20 || assessment.rank < 1 || assessment.rank > assessment.populationSize)) {
    throw new Error('AI 重要性排名格式无效。');
  }
  return { score: assessment.score, reason: assessment.reason, contentHash: assessment.contentHash,
    goal: assessment.goal, providerId: assessment.providerId, model: assessment.model,
    rubricVersion: assessment.rubricVersion, scoredAt: assessment.scoredAt,
    ...(hasRank ? { rank: assessment.rank, populationSize: assessment.populationSize } : {}) };
}
export async function saveMemoryAiPriority(id, assessment) {
  return (await saveMemoryAiPriorities([{ id, assessment }]))[0];
}
/** All selected entries remain enrolled or the entire scoring batch is discarded. */
export async function saveMemoryAiPriorities(updates) {
  if (!Array.isArray(updates) || updates.length < 1 || updates.length > 20) throw new Error('每次可评估 1～20 项内容。');
  const ids = new Set();
  const changes = updates.map(update => {
    if (!update || typeof update.id !== 'string' || !update.id || ids.has(update.id)) throw new Error('AI 重要性批次包含无效或重复内容。');
    ids.add(update.id);
    return { id: update.id, ai: validateAiPriority(update.assessment) };
  });
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('entries', 'readwrite');
    const store = transaction.objectStore('entries');
    const saved = new Array(changes.length);
    let remaining = changes.length, problem;
    changes.forEach((change, index) => {
      const request = store.get(change.id);
      request.onsuccess = () => {
        try {
          const previous = request.result;
          if (!previous?.active) throw new Error('部分内容已移出记忆库，本批评分未保存。');
          saved[index] = { ...previous, priority: { ...previous.priority, ai: change.ai } };
          remaining--;
          if (!remaining) for (const entry of saved) store.put(entry);
        } catch (error) { problem = error; transaction.abort(); }
      };
    });
    transaction.oncomplete = () => { db.close(); for (const entry of saved) notifyMemoryChange(entry.id); resolve(saved); };
    transaction.onabort = () => { db.close(); reject(problem || new Error('AI 重要性批次保存失败，原评分未修改。')); };
  });
}
export async function undoMemoryRead(id, eventId, now = Date.now()) {
  return changeEntry(id, previous => {
    const event = previous?.events.find(event => event.id === eventId);
    if (!event) throw new Error('这条已读记录不存在。');
    if (event.voidedAt != null) return previous;
    return { ...previous, events: previous.events.map(event => event.id === eventId ? { ...event, voidedAt: now } : event) };
  });
}
export async function saveMemorySettings(settings) {
  if (!settings || !Number.isFinite(settings.retentionScale) || settings.retentionScale < 0.25 || settings.retentionScale > 4) throw new Error('保持时长系数应在 0.25～4 之间。');
  if (settings.forgettingExponent !== undefined && (!Number.isFinite(settings.forgettingExponent) || settings.forgettingExponent < 0.5 || settings.forgettingExponent > 2)) throw new Error('遗忘影响系数应在 0.5～2 之间。');
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('settings', 'readwrite');
    const store = transaction.objectStore('settings');
    const request = store.get('profile');
    let saved;
    request.onsuccess = () => {
      saved = { ...normalizeSettings(request.result), retentionScale: settings.retentionScale,
        ...(settings.forgettingExponent === undefined ? {} : { forgettingExponent: settings.forgettingExponent }) };
      store.put(saved, 'profile');
    };
    transaction.oncomplete = () => { db.close(); notifyMemoryChange(null); resolve(saved); };
    transaction.onabort = () => { db.close(); reject(new Error('系数未保存，请重试。')); };
  });
}
