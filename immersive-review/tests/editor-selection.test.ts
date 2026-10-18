import { describe, expect, it } from 'vitest';
import { captureChapterSelection, fencedSelection, isDocumentOutlineHeading, markdownForSourceSelection, markdownSectionAt, markdownSectionForRenderedHeading, recoverLegacyQuoteMarkdown, registerChapterSelection, type ChapterSelection } from '../src/notebook/editor-selection';

describe('Markdown selection snapshots', () => {
  it('keeps code language and uses a longer fence when selected code contains backticks', () => {
    expect(fencedSelection('print("```")', 'python')).toBe('````python\nprint("```")\n````');
  });

  it('preserves intentional indentation and blank lines inside a code selection', () => {
    expect(fencedSelection('\n    return value\n', 'python')).toBe('```python\n\n    return value\n```');
  });

  it('quotes a source-mode code selection with its enclosing language', () => {
    const source = '# 标题\n\n```typescript\nconst n = 1;\nconsole.log(n);\n```\n';
    const start = source.indexOf('console');
    expect(markdownForSourceSelection(source, start, start + 'console.log(n);'.length)).toBe('```typescript\nconsole.log(n);\n```');
    expect(markdownForSourceSelection(source, 0, 4)).toBe('# 标题');
  });

  it('keeps an already-selected complete source fence without double wrapping it', () => {
    const code = '```python\nprint("hello")\n```';
    const source = `## 标题\n\n${code}\n\n说明`;
    const start = source.indexOf('```');
    expect(markdownForSourceSelection(source, start, start + code.length)).toBe(code);
  });

  it('keeps ordinary Markdown source syntax instead of converting it as rich text', () => {
    const source = '说明 **重点** 和 [资料](https://example.com)';
    expect(markdownForSourceSelection(source, 3, source.length)).toBe('**重点** 和 [资料](https://example.com)');
  });

  it('recovers an exact legacy code snapshot without changing the original fence or language', () => {
    const source = '背景\n\n~~~python\nprint("hello")\n~~~\n\n后文';
    expect(recoverLegacyQuoteMarkdown('print("hello")', source)).toBe('~~~python\nprint("hello")\n~~~');
  });

  it('does not infer code formatting from a partial or changed quote', () => {
    const source = '```python\nprint("hello")\nprint("world")\n```';
    expect(recoverLegacyQuoteMarkdown('print("hello")', source)).toBeNull();
    expect(recoverLegacyQuoteMarkdown('hello world', source)).toBeNull();
    expect(recoverLegacyQuoteMarkdown('普通正文', '普通正文')).toBe('普通正文');
  });

  it('refuses ambiguous legacy matches even when two code blocks share identical text', () => {
    const source = '```js\nconst n = 1;\n```\n\n```ts\nconst n = 1;\n```';
    expect(recoverLegacyQuoteMarkdown('const n = 1;', source)).toBeNull();
  });

  it('does not recover an unfinished fence or an empty quote', () => {
    expect(recoverLegacyQuoteMarkdown('value', '```js\nvalue')).toBeNull();
    expect(recoverLegacyQuoteMarkdown('', '```\n\n```')).toBeNull();
  });

  it('recovers a whole legacy heading, explanation, list and code with only layout whitespace differences', () => {
    const source = '## 示例\n\n先保留**重点**。\n\n- 输入参数\n- 查看结果\n\n```python\nprint("hello")\nprint("world")\n```';
    const text = '示例先保留重点。输入参数查看结果print("hello")\nprint("world")';
    expect(recoverLegacyQuoteMarkdown(text, source)).toBe(source);
    expect(recoverLegacyQuoteMarkdown('示例\n先保留重点。\n输入参数\n查看结果\nprint("hello")\nprint("world")\n', source)).toBe(source);
  });

  it('does not recover a partial whole-document quote or change whitespace inside code', () => {
    const source = '## 示例\n\n解释。\n\n```python\nprint( "hello" )\n```';
    expect(recoverLegacyQuoteMarkdown('解释。print( "hello" )', source)).toBeNull();
    expect(recoverLegacyQuoteMarkdown('示例解释。print("hello")', source)).toBeNull();
  });

  it('does not guess visible text for embedded HTML or media', () => {
    expect(recoverLegacyQuoteMarkdown('标题正文', '# 标题\n\n<div>正文</div>')).toBeNull();
    expect(recoverLegacyQuoteMarkdown('标题图片', '# 标题\n\n![图片](test.png)')).toBeNull();
  });
});

describe('heading-scoped quote context', () => {
  it('includes headings inside Vditor PRE hosts but excludes actual nested code and quoted examples', () => {
    const element = (tag: string, parent: Element | null = null) => ({ parentElement: parent,
      matches: (selector: string) => selector.split(',').includes(tag) } as unknown as Element);
    const outsideQuote = element('blockquote');
    const field = element('pre', outsideQuote);
    expect(isDocumentOutlineHeading(element('h2', field), field)).toBe(true);
    expect(isDocumentOutlineHeading(element('h3', element('div', field)), field)).toBe(true);
    expect(isDocumentOutlineHeading(element('h2', element('pre', field)), field)).toBe(false);
    expect(isDocumentOutlineHeading(element('h2', element('blockquote', field)), field)).toBe(false);
    expect(isDocumentOutlineHeading(element('h2', outsideQuote), field)).toBe(false);
  });

  it('never reuses the previous quote or falls through to hidden DOM when the editor selection is cleared', () => {
    const host = {} as HTMLElement;
    const scope = { closest: () => host, querySelectorAll: () => [],
      querySelector: () => { throw new Error('An owned editor must not inspect hidden DOM fallback'); } } as unknown as HTMLElement;
    let current: ChapterSelection | null = { text: '第一次选区', markdown: '**第一次选区**', before: '', after: '', canDelete: false, deleteSelection: () => false };
    const unregister = registerChapterSelection(host, () => current, () => '当前正文');
    try {
      expect(captureChapterSelection(scope)?.markdown).toBe('**第一次选区**');
      current = { ...current!, text: '第二次选区', markdown: '`第二次选区`' };
      expect(captureChapterSelection(scope)?.markdown).toBe('`第二次选区`');
      current = null;
      expect(captureChapterSelection(scope)).toBeNull();
    } finally { unregister(); }
  });

  it('keeps the nearest heading, its body and children, stopping before its next sibling', () => {
    const source = '# 手册\n\n总述\n\n## 参数\n\n这一节\n\n### 示例\n\nprint(1)\n\n## 返回值\n\n下一节';
    expect(markdownSectionAt(source, source.indexOf('这一节'))).toMatchObject({
      title: '参数', depth: 2, markdown: '## 参数\n\n这一节\n\n### 示例\n\nprint(1)',
      start: source.indexOf('## 参数'), end: source.indexOf('## 返回值'),
    });
    expect(markdownSectionAt(source, source.indexOf('print(1)'))).toMatchObject({ title: '示例', depth: 3, markdown: '### 示例\n\nprint(1)' });
  });

  it('uses source position rather than the first occurrence of repeated text or headings', () => {
    const source = '## 例子\n\n重复正文\n\n## 例子\n\n重复正文\n\n尾句';
    const selected = source.lastIndexOf('重复正文');
    expect(markdownSectionAt(source, selected)).toMatchObject({ start: source.lastIndexOf('## 例子'), markdown: '## 例子\n\n重复正文\n\n尾句' });
    expect(markdownSectionForRenderedHeading(source, [{ title: '例子', depth: 2 }, { title: '例子', depth: 2 }], 1)).toMatchObject({
      start: source.lastIndexOf('## 例子'), markdown: '## 例子\n\n重复正文\n\n尾句',
    });
  });

  it('follows CommonMark Setext headings and ignores heading-looking code or hashtags', () => {
    const source = '参数\n====\n\n正文\n\n```python\n# 不是标题\nprint(1)\n```\n\n    ## 缩进代码\n\n#hashtag\n\n下一节\n----\n\n结束';
    const context = markdownSectionAt(source, source.indexOf('print(1)'));
    expect(context.title).toBe('参数');
    expect(context.depth).toBe(1);
    // 下一节 is level two and remains a child of the level-one 参数 section.
    expect(context.markdown).toBe(source);
    expect(markdownSectionAt(source, source.indexOf('结束'))).toMatchObject({ title: '下一节', depth: 2, markdown: '下一节\n----\n\n结束' });
  });

  it('uses the current body without a heading and isolates the introduction before the first heading', () => {
    const plain = '普通正文\n\n```js\n# not a heading\n```';
    expect(markdownSectionAt(plain, 4)).toEqual({ markdown: plain, start: 0, end: plain.length });
    const source = '引言\n\n## 小节\n\n正文';
    expect(markdownSectionAt(source, 1)).toEqual({ markdown: '引言', start: 0, end: source.indexOf('##') });
  });

  it('does not let headings inside quoted examples replace the document outline', () => {
    const source = '## 主题\n\n说明\n\n> # 引用内的示例标题\n> 引用内容\n\n正文续写\n\n## 下一节';
    expect(markdownSectionAt(source, source.indexOf('正文续写'))).toMatchObject({ title: '主题', markdown: source.slice(0, source.indexOf('## 下一节')).trimEnd() });
  });

  it('falls back to the current body if DOM headings do not match the source outline', () => {
    const source = '## 真正的小节\n\n正文';
    expect(markdownSectionForRenderedHeading(source, [{ title: '外部展示标题', depth: 3 }, { title: '真正的小节', depth: 2 }], 1))
      .toEqual({ markdown: source, start: 0, end: source.length });
  });
});
