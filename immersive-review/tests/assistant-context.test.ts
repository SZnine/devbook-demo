import { setLanguage } from '../src/i18n';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildAssistantContext, markdownHeadingTitles, snapshotAssistantSelection } from '../src/notebook/assistant-context';
import { markdownForSourceSelection, markdownSectionAt } from '../src/notebook/editor-selection';

const metadata = {
  id: 'note:example:selection', title: '参数', bodyMarkdown: '## 参数\n\n当前正文',
  chapterTitle: '函数与模块', chapterHeadings: ['参数', '返回值'], bookTitle: 'Python 手册',
};

beforeEach(() => setLanguage('zh-CN'));

describe('explicit assistant context', () => {
  it('captures the correct repeated paragraph by source position, retaining the full section and its code', () => {
    const body = '## 第一节\n\n相同的正文。\n\n## 第二节\n\n相同的正文。\n\n```python\nprint("正文部分")\n```\n\n## 第三节\n\n无关正文';
    const position = body.lastIndexOf('相同的正文。');
    const selection = snapshotAssistantSelection({ text: '相同的正文。', markdown: '相同的正文。', context: markdownSectionAt(body, position) }, { ...metadata, bodyMarkdown: body });
    expect(selection?.sectionTitle).toBe('第二节');
    expect(selection?.title).toBe('第二节');
    expect(selection?.sectionMarkdown).toBe('## 第二节\n\n相同的正文。\n\n```python\nprint("正文部分")\n```');
    expect(buildAssistantContext(selection!, 'section')).not.toContain('无关正文');
  });

  it('keeps code selections as Markdown without losing indentation or fence language', () => {
    const body = '## 函数\n\n```python\ndef run():\n    return 1\n```';
    const position = body.indexOf('    return');
    const markdown = markdownForSourceSelection(body, position, position + '    return 1'.length);
    const selection = snapshotAssistantSelection({ text: '    return 1', markdown, context: markdownSectionAt(body, position) }, { ...metadata, bodyMarkdown: body });
    expect(selection?.selectedMarkdown).toBe('```python\n    return 1\n```');
    expect(buildAssistantContext(selection!, 'selection')).toContain(markdown);
  });

  it('does not attach higher-level context unless the user selects it', () => {
    const selection = snapshotAssistantSelection({ text: '关键句', markdown: '**关键句**' }, metadata)!;
    const minimal = buildAssistantContext(selection, 'selection');
    expect(minimal).toContain('**关键句**');
    expect(minimal).not.toContain('当前正文');
    expect(minimal).not.toContain('函数与模块');
    expect(minimal).not.toContain('Python 手册');
    const section = buildAssistantContext(selection, 'section');
    expect(section).toContain(metadata.bodyMarkdown);
    expect(section).not.toContain('Python 手册');
    const chapter = buildAssistantContext(selection, 'chapter');
    expect(chapter).toContain('所属书籍：Python 手册');
    expect(chapter).toContain('所属章节：函数与模块');
    expect(chapter).toContain('- 参数\n\n- 返回值');
  });

  it('returns no attachment for a cleared selection, without retaining a previous snapshot', () => {
    const original = snapshotAssistantSelection({ text: '上次内容', markdown: '上次内容' }, metadata);
    expect(original?.selectedMarkdown).toBe('上次内容');
    expect(snapshotAssistantSelection(null, metadata)).toBeNull();
    expect(snapshotAssistantSelection({ text: '', markdown: '残留 Markdown' }, metadata)).toBeNull();
    expect(snapshotAssistantSelection({ text: ' ', markdown: ' ' }, metadata)).toBeNull();
    expect(snapshotAssistantSelection({ text: '新内容', markdown: '新内容' }, metadata)?.selectedMarkdown).toBe('新内容');
  });

  it('takes an independent outline snapshot and preserves duplicate titles in document order', () => {
    const headings = ['例子', '例子'];
    const selection = snapshotAssistantSelection({ text: '正文', markdown: '正文' }, { ...metadata, chapterHeadings: headings })!;
    headings.push('后续添加');
    expect(selection.chapterHeadings).toEqual(['例子', '例子']);
  });

  it('parses real Markdown headings, excluding code, quoted examples, nested list headings and hashtags', () => {
    const source = '# **第一节** 与 `code`\n\n> ## 引用中的标题\n\n- ### 列表中的标题\n\n```markdown\n# 代码中的标题\n```\n\n#hashtag\n\n下一节\n----\n\n## [链接](https://example.com)\n\n## 下一节';
    expect(markdownHeadingTitles(source)).toEqual(['第一节 与 code', '下一节', '链接', '下一节']);
  });

  it('does not fabricate book or chapter labels for a standalone memo', () => {
    const selection = snapshotAssistantSelection({ text: '独立随笔', markdown: '独立随笔' }, { id: 'memo:1', title: '独立随笔', bodyMarkdown: '独立随笔\n\n后续内容' })!;
    const context = buildAssistantContext(selection, 'chapter');
    expect(context).toContain('后续内容');
    expect(context).not.toContain('所属书籍');
    expect(context).not.toContain('所属章节');
    expect(context).not.toContain('章节内小节标题');
  });

  it('keeps long full-section context intact and leaves request length validation to the sender', () => {
    const body = `## 一节\n\n${'正文'.repeat(50_000)}`;
    const selection = snapshotAssistantSelection({ text: '正文', markdown: '正文' }, { id: 'long', title: '一节', bodyMarkdown: body })!;
    expect(buildAssistantContext(selection, 'section')).toContain(body);
    expect(buildAssistantContext([], 'section')).toBe('');
  });

  it('includes only passed-in selections, preserving independent source titles', () => {
    const first = snapshotAssistantSelection({ text: '第一选区', markdown: '第一选区' }, metadata)!;
    const second = snapshotAssistantSelection({ text: '第二选区', markdown: '第二选区' }, { ...metadata, id: 'two', title: '另一个小节' })!;
    expect(buildAssistantContext([second], 'selection')).not.toContain(first.selectedMarkdown);
    expect(buildAssistantContext([first, second], 'selection')).toContain('参考 2 · 另一个小节');
  });
});
