// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { collectBookOutline } from '../src/notebook/useBookOutline';

function workspace(html: string) {
  const element = document.createElement('div');
  element.className = 'cw-workspace is-page';
  element.innerHTML = html;
  document.body.replaceChildren(element);
  return element;
}

function identity() {
  const ids = new WeakMap<HTMLElement, string>();
  let sequence = 0;
  return (element: HTMLElement) => {
    if (!ids.has(element)) ids.set(element, `heading-${++sequence}`);
    return ids.get(element)!;
  };
}

describe('book page outline', () => {
  it('includes live, static, summary and read-through titles without collecting examples or controls', () => {
    const page = workspace(`
      <nav class="cw-chapter-directory"><header><h2>Chapters</h2></header></nav>
      <section class="cw-summary"><div class="markdown"><h2>Overview</h2></div></section>
      <article class="cw-content"><section class="chapter-editor" data-source-mode="false"><div class="vditor-wysiwyg"><pre contenteditable="true"><h1>First</h1><h3>Nested topic</h3><blockquote><h2>Quote example</h2></blockquote><ul><li><h2>List example</h2></li></ul><div data-type="code-block"><pre><code><h2>Code example</h2></code></pre></div><div class="vditor-wysiwyg__preview"><h2>Preview duplicate</h2></div></pre></div></section></article>
      <section class="cw-reading-chapter"><h2>Child chapter</h2><div class="cw-prose"><h3>Linked source</h3><div class="markdown"><h4>Source topic</h4></div></div></section>
      <dialog><div class="markdown"><h2>Dialog</h2></div></dialog>
      <blockquote><div class="markdown"><h2>Rendered quote</h2></div></blockquote>
      <div class="markdown" hidden><h2>Hidden</h2></div>
      <div class="markdown"><details><summary>Closed example</summary><h2>Closed</h2></details></div>
    `);
    const entries = collectBookOutline(page, identity());
    expect(entries.map(({ title, depth }) => [title, depth])).toEqual([
      ['Overview', 2], ['First', 1], ['Nested topic', 3], ['Child chapter', 2], ['Linked source', 4], ['Source topic', 5],
    ]);
    expect(page.querySelectorAll('[id]')).toHaveLength(0);
  });

  it('keeps duplicate titles separately anchored through rename, insertion and removal', () => {
    const page = workspace('<div class="markdown"><h2>Same</h2><p>One</p><h2>Same</h2><p>Two</p></div>');
    const identify = identity();
    const before = collectBookOutline(page, identify);
    expect(before[0].id).not.toBe(before[1].id);
    before[1].element.textContent = 'Renamed';
    const inserted = document.createElement('h2'); inserted.textContent = 'Same';
    before[0].element.before(inserted);
    const changed = collectBookOutline(page, identify);
    expect(changed[1].id).toBe(before[0].id);
    expect(changed[2]).toMatchObject({ id: before[1].id, title: 'Renamed', element: before[1].element });
    before[0].element.remove();
    expect(collectBookOutline(page, identify).map(entry => entry.id)).toEqual([changed[0].id, before[1].id]);
  });

  it('drops hidden rich-text titles in source mode and clears the arrange view', () => {
    const page = workspace('<section class="chapter-editor" data-source-mode="true"><div class="vditor-wysiwyg"><pre contenteditable="true"><h2>Old rich text</h2></pre></div></section><div class="cw-prose" style="display:none"><h2>Hidden</h2></div><div class="markdown"><h2>Visible</h2></div>');
    const identify = identity();
    expect(collectBookOutline(page, identify).map(entry => entry.title)).toEqual(['Visible']);
    page.className = 'cw-workspace is-cards';
    expect(collectBookOutline(page, identify)).toEqual([]);
  });
});
