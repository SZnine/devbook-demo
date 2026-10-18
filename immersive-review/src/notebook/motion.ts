import { useState, type Dispatch, type SetStateAction } from 'react';

export type MotionKind = 'content' | 'layout' | 'popover' | 'theme';

// Compatibility for existing action handlers. Commit synchronously: local CSS
// controls disclosure/hover feedback; no page snapshots, cloned DOM or delayed jobs.
export function motionChange(update: () => void, _kind: MotionKind = 'content'): Promise<void> {
  try { update(); return Promise.resolve(); }
  catch (error) { return Promise.reject(error); }
}

export function useMotionState<T>(initial: T | (() => T), _kind: MotionKind = 'content'): [T, Dispatch<SetStateAction<T>>] {
  return useState(initial);
}
