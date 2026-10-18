import { describe, expect, it } from 'vitest';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExpressiveCodeBlock, getRenderedExpressiveCode, renderExpressiveCode } from '../src/content/ExpressiveCode';

describe('Expressive Code renderer', () => {
  it('renders explicit filenames, syntax, line marks, diff markers and optional line numbers', async () => {
    const result = await renderExpressiveCode({ code: 'const one = 1;\nconst two = 2;\nconst added = true;\nconst removed = false;',
      language: 'ts', meta: 'title="example.ts" {2} ins={3} del={4} showLineNumbers' });
    expect(result.html).toContain('example.ts');
    expect(result.html).toContain('highlight');
    expect(result.html).toContain('ins'); expect(result.html).toContain('del');
    expect(result.html).toContain('class="ln"');
    expect(result.html).toContain('data-selection-ignore');
    expect(result.html).toContain('aria-hidden="true"');
    expect(result.styles.join('')).toContain('.expressive-code');
    expect(result.styles.join('')).toContain('data-read-theme');
    expect(result.styles.join('')).toContain(':root[data-read-theme="dark"]');
    expect(result.styles.join('')).toContain(':root,:root:not([data-read-theme="light"])');
    expect(result.styles.join('')).not.toContain('.manual-demo');
    expect(result.styles.join('')).toContain('--ec-codeBg:#141517');
    expect(() => {
      for (const css of result.styles) {
        postcss.parse(css).walkRules(rule => { selectorParser().astSync(rule.selector); });
      }
    }).not.toThrow();
  });

  it('escapes hostile code and metadata without dropping a source filename comment', async () => {
    const result = await renderExpressiveCode({ language: 'html', meta: 'title="<img src=x onerror=alert(1)>"',
      code: '<!-- source.html -->\n<script>alert("bad")</script>\n<img src=x onerror="alert(1)">' });
    expect(result.html).not.toMatch(/<script|<img/);
    expect(result.html).toContain('source.html');
    expect(result.html).toContain('onerror');
  });

  it('keeps unknown languages readable and shares concurrent rendering work', async () => {
    const input = { language: 'unknown-study-language', code: '保留 <>&\n  exact whitespace\n' };
    const first = renderExpressiveCode(input); const second = renderExpressiveCode(input);
    expect(first).toBe(second);
    const result = await first;
    expect(result.html).toContain('保留');
    expect(result.html.replace(/<[^>]+>/g, '')).toContain('  exact whitespace');
    expect(result.html).toContain('&#x3C;');
  });

  it('uses completed code on the first render when revisiting a chapter', async () => {
    const input = { code: 'const chapterReturn = true;', language: 'ts', meta: 'title="return.ts"' };
    expect(getRenderedExpressiveCode(input)).toBeUndefined();
    const pending = renderExpressiveCode(input);
    expect(getRenderedExpressiveCode(input)).toBeUndefined();
    const result = await pending;
    expect(getRenderedExpressiveCode(input)).toBe(result);
    const html = renderToStaticMarkup(createElement(ExpressiveCodeBlock, input));
    expect(html).toContain('data-code-status="rendered"');
    expect(html).not.toContain('class="code-fallback"');
    expect(html).toContain('return.ts');
    expect(getRenderedExpressiveCode({ ...input, code: 'const chapterReturn = false;' })).toBeUndefined();
    expect(getRenderedExpressiveCode({ ...input, language: 'text' })).toBeUndefined();
    expect(getRenderedExpressiveCode({ ...input, meta: '' })).toBeUndefined();
  });

  it('evicts completed code together with its bounded render entry', async () => {
    const input = { code: 'oldest-cache-test', language: 'text' };
    await renderExpressiveCode(input);
    for (let index = 0; index < 80; index++) await renderExpressiveCode({ code: `cache-test-${index}`, language: 'text' });
    expect(getRenderedExpressiveCode(input)).toBeUndefined();
    expect(getRenderedExpressiveCode({ code: 'cache-test-79', language: 'text' })).toBeDefined();
  });
});
