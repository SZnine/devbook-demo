import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const parser = vi.hoisted(() => vi.fn(async (body: string) => `<p>parsed:${body}</p>`));
vi.mock('vditor/dist/method', () => ({ default: { md2html: parser } }));
vi.mock('dompurify', () => ({ default: { sanitize: (html: string) => html } }));

import { Markdown } from '../src/Markdown';
import { getRenderedMarkdown, renderMarkdown } from '../src/content/vditor-renderer';

afterEach(() => vi.unstubAllGlobals());

function loadedRuntime() {
  vi.stubGlobal('document', { getElementById: () => ({}) });
}

describe('Markdown completed render cache', () => {
  it('renders a revisited chapter from its completed tree without the fallback phase', async () => {
    loadedRuntime();
    const body = 'warm-chapter';
    expect(getRenderedMarkdown(body)).toBeUndefined();
    const pending = renderMarkdown(body);
    expect(renderMarkdown(body)).toBe(pending);
    expect(getRenderedMarkdown(body)).toBeUndefined();
    const result = await pending;
    expect(getRenderedMarkdown(body)).toBe(result);
    const calls = parser.mock.calls.length;
    const html = renderToStaticMarkup(createElement(Markdown, { body }));
    expect(html).toContain('data-markdown-engine="vditor"');
    expect(html).toContain('parsed:warm-chapter');
    expect(parser).toHaveBeenCalledTimes(calls);
    expect(getRenderedMarkdown('warm-chapter changed')).toBeUndefined();
  });

  it('does not retain a failed parse and retries the same content', async () => {
    loadedRuntime();
    parser.mockRejectedValueOnce(new Error('transient parse failure'));
    await expect(renderMarkdown('retry-chapter')).rejects.toThrow('transient parse failure');
    expect(getRenderedMarkdown('retry-chapter')).toBeUndefined();
    const result = await renderMarkdown('retry-chapter');
    expect(getRenderedMarkdown('retry-chapter')).toBe(result);
  });

  it('evicts settled entries and does not resurrect an evicted pending parse', async () => {
    loadedRuntime();
    await renderMarkdown('oldest-chapter');
    let finish!: (html: string) => void;
    parser.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    const late = renderMarkdown('late-chapter');
    // Start the delayed parse before queuing enough new chapters to evict it.
    await Promise.resolve();
    for (let index = 0; index < 160; index++) await renderMarkdown(`bounded-chapter-${index}`);
    expect(getRenderedMarkdown('oldest-chapter')).toBeUndefined();
    finish('<p>late result</p>');
    await late;
    expect(getRenderedMarkdown('late-chapter')).toBeUndefined();
    expect(getRenderedMarkdown('bounded-chapter-159')).toBeDefined();
  });
});
