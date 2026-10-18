import { useEffect, useMemo, useRef } from 'react';
import { createFocusState, estimateSeconds, sampleFocus, type FocusState } from './memory-policy';
import { visibleReadingRange } from './reading-viewport';
import { manual } from './content';
import * as store from './store';

type Bucket = { focus: FocusState; sessionId: string; done: boolean; pending: boolean; completedAt: number; lastSampleAt: number; retryAt: number };
type Target = { ref: store.Ref; hash: string; seconds: number };

/** Observe saved full text. Enrollment happens only after a qualified exposure is persisted. */
export function useReadingActivity(state: store.NotebookState | null, reportError: (message: string) => void) {
  const targets = useMemo(() => {
    const result = new Map<string, Target>();
    if (!state) return result;
    const paused = new Set(state.entries.filter(entry => entry.trackingPaused).map(entry => `${entry.documentId === 'read-notebook' ? 'note' : 'section'}:${entry.sectionId}`));
    const candidates: store.Ref[] = [
      ...state.notes.filter(note => note.archivedAt === undefined).map(note => ({ kind: 'note' as const, id: note.id })),
      ...manual.sections.map(section => ({ kind: 'section' as const, id: section.id })),
    ];
    for (const ref of candidates) {
      if (paused.has(`${ref.kind}:${ref.id}`)) continue;
      try {
        result.set(`${ref.kind}:${ref.id}`, { ref, hash: store.readingReference(ref, state).contentHash, seconds: estimateSeconds(store.readingMarkdown(ref, state)) });
      } catch { /* Old unavailable source content retains its history without earning new exposure. */ }
    }
    return result;
  }, [state?.notes, state?.entries]);
  const latest = useRef({ targets, reportError });
  latest.current = { targets, reportError };

  useEffect(() => {
    const buckets = new Map<string, Bucket>();
    let previous = performance.now(), lastActivity = -Infinity, lastEdit = -Infinity;
    let pointer: { x: number; y: number } | null = null;
    const activity = (event: Event) => {
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest('.na-panel,.component-library')) { lastActivity = -Infinity; return; }
      if (event instanceof PointerEvent) pointer = { x: event.clientX, y: event.clientY };
      if (event.type === 'input' || event.type === 'beforeinput' || event.type === 'compositionstart') lastEdit = performance.now();
      lastActivity = performance.now();
    };
    const events = ['pointermove', 'pointerdown', 'keydown', 'scroll', 'input', 'beforeinput', 'compositionstart'] as const;
    events.forEach(name => document.addEventListener(name, activity, { passive: true, capture: true }));
    const resetClock = () => { previous = performance.now(); if (document.visibilityState !== 'visible' || !document.hasFocus()) lastActivity = -Infinity; };
    document.addEventListener('visibilitychange', resetClock);
    window.addEventListener('blur', resetClock);
    window.addEventListener('focus', resetClock);
    const timer = window.setInterval(() => {
      const at = performance.now(), deltaMs = at - previous;
      previous = at;
      if (document.visibilityState !== 'visible' || !document.hasFocus() || at - lastEdit < 8_000
        || document.activeElement?.closest('.na-panel,.component-library,input,textarea,select')) return;
      const openDialog = Array.from(document.querySelectorAll('dialog[open]')).at(-1);
      const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-reading-key]'));
      let candidate: { key: string; target?: Target; blocked: boolean; range: readonly [number, number]; score: number } | undefined;
      for (const element of elements) {
        if (openDialog && !openDialog.contains(element) || element.closest('[inert],[hidden]') || !element.getClientRects().length) continue;
        const target = latest.current.targets.get(element.dataset.readingKey!);
        const core = element.querySelector<HTMLElement>('[data-reading-core]') ?? element.querySelector<HTMLElement>(':scope > .markdown') ?? element;
        const blocked = Boolean(element.querySelector('[data-reading-dirty="true"],[aria-busy="true"]') || core.querySelector('details:not([open])'));
        const rect = core.getBoundingClientRect();
        let viewport = { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
        // Include every scroll clipping ancestor (e.g. modal + main pane).
        for (let parent = core.parentElement; parent; parent = parent.parentElement) {
          if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) continue;
          const clip = parent.getBoundingClientRect();
          viewport = { top: Math.max(viewport.top, clip.top), bottom: Math.min(viewport.bottom, clip.bottom), left: Math.max(viewport.left, clip.left), right: Math.min(viewport.right, clip.right) };
        }
        // The fixed reading toolbar occupies the first strip of the main viewport.
        if (element.closest('.nb-main')) viewport.top += 64;
        const range = visibleReadingRange(rect, viewport);
        if (!range) continue;
        const hovered = pointer && pointer.x >= Math.max(rect.left, viewport.left) && pointer.x <= Math.min(rect.right, viewport.right)
          && pointer.y >= Math.max(rect.top, viewport.top) && pointer.y <= Math.min(rect.bottom, viewport.bottom);
        const score = (range[1] - range[0]) * rect.height + (hovered ? innerHeight : 0);
        if (!candidate || score > candidate.score) candidate = { key: `${element.dataset.readingKey}:${target?.hash}`, target, blocked, range, score };
      }
      // One foreground content at a time; multiple visible blocks cannot all earn the same seconds.
      if (!candidate?.target || candidate.blocked || candidate.target.seconds <= 0) return;
      const { key, target, range } = candidate;
      let bucket = buckets.get(key);
      if (!bucket || !bucket.pending && at - (bucket.done ? bucket.completedAt : bucket.lastSampleAt) >= 30 * 60_000) {
        bucket = { focus: createFocusState(), sessionId: crypto.randomUUID(), done: false, pending: false, completedAt: 0, lastSampleAt: at, retryAt: 0 };
        buckets.set(key, bucket);
      }
      if (bucket.done || bucket.pending || at < bucket.retryAt) return;
      if (at - lastActivity <= 90_000) bucket.lastSampleAt = at;
      bucket.focus = sampleFocus(bucket.focus, { deltaMs, visible: true, focused: true, reading: true, engaged: Number.isFinite(lastActivity), idleMs: at - lastActivity, range }, target.seconds);
      if (!bucket.focus.qualified) return;
      bucket.pending = true;
      // Resolve the exact saved version again in the write queue; an edit during reading invalidates this snapshot.
      void store.recordRef(target.ref, { source: 'focus', sessionId: bucket.sessionId, contentHash: target.hash, activeMs: bucket.focus.activeMs, coverage: bucket.focus.coverage })
        .then(() => { bucket!.done = true; bucket!.completedAt = performance.now(); })
        .catch(reason => {
          bucket!.retryAt = performance.now() + 10_000;
          latest.current.reportError(`自动阅读未保存：${reason instanceof Error ? reason.message : String(reason)}`);
        })
        .finally(() => { bucket!.pending = false; });
    }, 500);
    return () => {
      clearInterval(timer);
      events.forEach(name => document.removeEventListener(name, activity, true));
      document.removeEventListener('visibilitychange', resetClock);
      window.removeEventListener('blur', resetClock); window.removeEventListener('focus', resetClock);
    };
  }, []);
}
