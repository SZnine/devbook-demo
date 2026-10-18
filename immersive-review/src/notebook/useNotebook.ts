import { useEffect, useRef, useState } from 'react';
import * as store from './store';
import { motionChange } from './motion';
import { MEMORY_CHANGED_EVENT } from '../memory/memory-store.mjs';

export function useNotebook() {
  const [state, setState] = useState<store.NotebookState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const lock = useRef(false);
  useEffect(() => {
    let alive = true;
    store.loadNotebook().then(value => { if (alive) setState(value); }).catch(reason => { if (alive) setError(String(reason)); });
    const tick = () => setNow(Date.now());
    let refreshing = false, queued = false;
    const refreshMemory = async () => {
      if (refreshing) { queued = true; return; }
      refreshing = true;
      try {
        const memory = await store.loadNotebookMemory();
        if (alive) { setState(current => current ? { ...current, ...memory } : current); tick(); }
      } catch (reason) { if (alive) setError(reason instanceof Error ? reason.message : String(reason)); }
      finally { refreshing = false; if (queued && alive) { queued = false; void refreshMemory(); } }
    };
    const visible = () => { tick(); if (document.visibilityState === 'visible') void refreshMemory(); };
    window.addEventListener(MEMORY_CHANGED_EVENT, refreshMemory);
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(MEMORY_CHANGED_EVENT) : null;
    if (channel) channel.onmessage = refreshMemory;
    const timer = window.setInterval(tick, 10_000);
    document.addEventListener('visibilitychange', visible);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener(MEMORY_CHANGED_EVENT, refreshMemory); channel?.close(); };
  }, []);
  const run = async <T,>(operation: () => Promise<T>, acceptStoredDraft = false): Promise<T | undefined> => {
    if (!state || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await operation();
      const fresh = await store.loadNotebook();
      await motionChange(() => {
        setState(current => ({ ...fresh, draft: acceptStoredDraft ? fresh.draft : current?.draft ?? fresh.draft })); setNow(Date.now());
      });
      return result;
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { lock.current = false; setBusy(false); }
  };
  // Text autosaves join the store's existing serialization queue. They must
  // not take the UI lock: typing and navigation continue while a write finishes.
  const commitContent = async (input: { id?: string; markdown: string; collectionId?: string }) => {
    const note = input.id ? await store.saveDocumentContent({ collectionId: input.collectionId!, id: input.id, markdown: input.markdown })
      : await store.createNoteInCollection(input.collectionId!, input.markdown);
    const fresh = await store.loadNotebook();
    setState(current => ({ ...fresh, draft: current?.draft ?? fresh.draft }));
    return note;
  };
  const commitSummary = async (id: string, summary: string): Promise<store.Collection> => {
    const collection = await store.saveCollectionSummary(id, summary);
    const fresh = await store.loadNotebook();
    setState(current => ({ ...fresh, draft: current?.draft ?? fresh.draft }));
    return collection;
  };
  return { state, busy, error, now, run, commitContent, commitSummary, reportError: (message: string) => setError(message), dismissError: () => setError(''),
    draft(value: store.Draft) {
      if (!state || lock.current) return;
      setState(state => state ? { ...state, draft: value } : state);
      void store.saveDraft(value).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
    },
  };
}
