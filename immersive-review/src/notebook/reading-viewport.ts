export type ReadingRect = { top: number; bottom: number; left: number; right: number };

/** Coverage is measured against the whole content, never a percentage of the viewport. */
export function visibleReadingRange(content: ReadingRect, viewport: ReadingRect): readonly [number, number] | null {
  const height = content.bottom - content.top;
  const width = Math.min(content.right, viewport.right) - Math.max(content.left, viewport.left);
  const top = Math.max(content.top, viewport.top), bottom = Math.min(content.bottom, viewport.bottom);
  if (height <= 0 || width < 80 || bottom - top < Math.min(48, height * .5)) return null;
  return [(top - content.top) / height, (bottom - content.top) / height];
}
