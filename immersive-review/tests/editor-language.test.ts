import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { setLanguage } from '../src/i18n';
import { createDirectInsertion, MarkdownInsertMenu } from '../src/notebook/MarkdownInsertMenu';

afterEach(() => setLanguage('en'));

describe('editor language', () => {
  it('changes block labels on the next render without reloading the module', () => {
    const render = () => renderToStaticMarkup(createElement(MarkdownInsertMenu, {
      onInsert: () => {}, onClose: () => {}, variant: 'floating',
    }));
    setLanguage('en');
    expect(render()).toContain('aria-label="Heading"');
    setLanguage('zh-CN');
    expect(render()).toContain('aria-label="标题"');
    setLanguage('en');
    expect(render()).toContain('aria-label="Heading"');
  });

  it('preserves selected Markdown when the interface language changes', () => {
    const source = 'const title = "标题";\nconst detail = "Keep this content";';
    setLanguage('en');
    const english = createDirectInsertion('code', source);
    setLanguage('zh-CN');
    expect(createDirectInsertion('code', source)).toEqual(english);
    expect(english.markdown).toContain(source);
  });

  it('ships both official editor dictionaries locally', () => {
    for (const [locale, heading] of [['en_US', 'Heading'], ['zh_CN', '标题']]) {
      const context = { window: { VditorI18n: {} as Record<string, string> } };
      runInNewContext(readFileSync(new URL(`../public/vendor/vditor/dist/js/i18n/${locale}.js`, import.meta.url), 'utf8'), context);
      expect(context.window.VditorI18n.headings).toContain(heading);
      expect(Object.keys(context.window.VditorI18n).length).toBeGreaterThan(50);
    }
  });
});
