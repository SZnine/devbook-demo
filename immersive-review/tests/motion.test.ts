import { afterEach, describe, expect, it, vi } from 'vitest';
import { motionChange, type MotionKind } from '../src/notebook/motion';

afterEach(() => vi.unstubAllGlobals());

describe('control-only updates', () => {
  it('commits before callers schedule focus or scroll positioning', async () => {
    let mounted = false;
    const result = motionChange(() => { mounted = true; });
    expect(mounted).toBe(true);
    await result;
  });

  it('applies every rapid toggle immediately and exactly once', async () => {
    let open = false;
    let count = 0;
    const actions = Array.from({ length: 12 }, () => motionChange(() => { open = !open; count++; }, 'layout'));
    expect({ open, count }).toEqual({ open: false, count: 12 });
    await Promise.all(actions);
    expect({ open, count }).toEqual({ open: false, count: 12 });
  });

  it('keeps nested navigation and follow-up focus in the same synchronous action', async () => {
    const order: string[] = [];
    await motionChange(() => {
      order.push('before');
      void motionChange(() => order.push('navigate'));
      order.push('focus');
    });
    expect(order).toEqual(['before', 'navigate', 'focus']);
  });

  it('never captures or clones the page for any existing action kind', async () => {
    const startViewTransition = vi.fn();
    const querySelectorAll = vi.fn();
    vi.stubGlobal('document', { startViewTransition, querySelectorAll });
    for (const kind of ['content', 'layout', 'popover', 'theme'] satisfies MotionKind[]) {
      await motionChange(() => {}, kind);
    }
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(querySelectorAll).not.toHaveBeenCalled();
  });

  it('propagates failures without delaying or dropping the next action', async () => {
    const failure = motionChange(() => { throw new Error('failed update'); });
    let following = false;
    await motionChange(() => { following = true; });
    expect(following).toBe(true);
    await expect(failure).rejects.toThrow('failed update');
  });
});
