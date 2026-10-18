import { describe, expect, it } from 'vitest';
import { visibleReadingRange } from '../src/notebook/reading-viewport';
const viewport = { top: 100, bottom: 700, left: 0, right: 1000 };
describe('reading viewport coverage', () => {
  it('counts the visible fraction of a long section rather than requiring the whole section on screen', () => {
    expect(visibleReadingRange({ top: 0, bottom: 2000, left: 200, right: 800 }, viewport)).toEqual([.05, .35]);
  });
  it('short fully visible content earns full coverage', () => {
    expect(visibleReadingRange({ top: 200, bottom: 300, left: 200, right: 800 }, viewport)).toEqual([0, 1]);
  });
  it('does not count offscreen content, tiny slivers, or a horizontally covered pane', () => {
    expect(visibleReadingRange({ top: 701, bottom: 900, left: 0, right: 500 }, viewport)).toBeNull();
    expect(visibleReadingRange({ top: 690, bottom: 1000, left: 0, right: 500 }, viewport)).toBeNull();
    expect(visibleReadingRange({ top: 200, bottom: 300, left: 980, right: 1100 }, viewport)).toBeNull();
  });
});
