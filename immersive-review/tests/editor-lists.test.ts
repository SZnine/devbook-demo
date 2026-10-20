// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { TextDecoder, TextEncoder } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { continuePreviousListItem, enterListParagraph, isEmptyListBlock, normalizeOrderedListMarkers } from '../src/notebook/editor-lists';

// Assert the saved Markdown too: the browser's visible counters hide stale
// data-marker values, and mixed inline/p children can lose paragraph breaks.
const runtime: Record<string, any> = { TextDecoder, TextEncoder, setTimeout, clearTimeout };
runInNewContext(readFileSync(resolve('node_modules/vditor/dist/js/lute/lute.min.js'), 'utf8'), runtime);
const lute = runtime.Lute.New();
const markdown = (root: HTMLElement) => lute.VditorDOM2Md(root.innerHTML) as string;

function editor(html: string) {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

function caret(node: Node, offset = node.childNodes.length) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  return range;
}

afterEach(() => document.body.replaceChildren());

describe('ordered-list continuation paragraphs', () => {
  it('turns an empty next item into a real paragraph without merging tight-list text', () => {
    const root = editor('<ol data-tight="true"><li data-marker="1."><strong>First</strong> item</li><li data-marker="2."><br></li></ol>');
    const list = root.firstElementChild as HTMLElement;
    const first = list.firstElementChild!;
    const bold = first.querySelector('strong');
    const continuation = continuePreviousListItem(list.lastElementChild as HTMLElement)!;
    expect(list.children).toHaveLength(1);
    expect(first.children).toHaveLength(2);
    expect(first.firstElementChild?.tagName).toBe('P');
    expect(first.firstElementChild?.textContent).toBe('First item');
    expect(first.querySelector('strong')).toBe(bold);
    expect(continuation.parentElement).toBe(first);
    expect(continuation.querySelector('br')).not.toBeNull();
    continuation.textContent = 'Supporting paragraph';
    expect(markdown(root)).toBe('1. **First** item\n\n   Supporting paragraph\n');
    expect(lute.SpinVditorDOM(root.innerHTML)).toContain('<p data-block="0">Supporting paragraph</p>');
  });

  it('preserves nested lists, code and media while attaching the next item', () => {
    const root = editor('<ol><li data-marker="1.">Parent<ol start="3"><li data-marker="3.">Child</li></ol><div data-type="code-block" data-block="0" data-marker="```"><pre><code class="language-python">print(1)\n</code></pre></div><img src="/figure.png" alt="Figure"></li><li data-marker="2."><p>Details <a href="https://example.com">source</a></p></li></ol>');
    const list = root.firstElementChild as HTMLElement;
    const first = list.firstElementChild!;
    const nested = first.querySelector('ol');
    const code = first.querySelector('[data-type="code-block"]');
    const image = first.querySelector('img');
    const paragraph = continuePreviousListItem(list.lastElementChild as HTMLElement)!;
    expect(first.querySelector('ol')).toBe(nested);
    expect(first.querySelector('[data-type="code-block"]')).toBe(code);
    expect(first.querySelector('img')).toBe(image);
    expect(paragraph.parentElement).toBe(first);
    expect(paragraph.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    const saved = markdown(root);
    expect(saved).toContain('1. Parent');
    expect(saved).toContain('3. Child');
    expect(saved).toContain('```python');
    expect(saved).toContain('print(1)');
    expect(saved).toContain('![Figure](/figure.png)');
    expect(saved).toContain('Details [source](https://example.com)');
  });

  it('moves a populated middle item to its predecessor and renumbers remaining items', () => {
    const root = editor('<ol start="9" data-marker="9."><li data-marker="9.">A<ol start="3"><li data-marker="3.">Child A</li><li data-marker="97.">Child B</li></ol></li><li data-marker="10."><p>Explanation</p><p>More detail</p></li><li data-marker="11.">B</li></ol>');
    const list = root.firstElementChild as HTMLElement;
    const moved = list.children[1] as HTMLElement;
    const next = list.children[2];
    const target = continuePreviousListItem(moved)!;
    expect(moved.isConnected).toBe(false);
    expect(target.isConnected).toBe(true);
    expect(target.parentElement).toBe(list.firstElementChild);
    expect(list.children).toHaveLength(2);
    expect(next.getAttribute('data-marker')).toBe('10.');
    expect(Array.from(list.querySelector('ol')!.children, node => node.getAttribute('data-marker'))).toEqual(['3.', '4.']);
    const saved = markdown(root);
    expect(saved).toContain('9. A');
    expect(saved).toContain('3. Child A');
    expect(saved).toContain('4. Child B');
    expect(saved).toContain('   Explanation\n\n   More detail');
    expect(saved).toContain('10. B');
    expect(saved).not.toMatch(/(?:11|97)\./);
  });

  it('leaves the first item and unordered lists to the native editor', () => {
    const root = editor('<ol><li>First</li></ol><ul><li>A</li><li>B</li></ul>');
    const before = root.innerHTML;
    expect(continuePreviousListItem(root.querySelector('ol > li') as HTMLElement)).toBeNull();
    expect(continuePreviousListItem(root.querySelector('ul > li:last-child') as HTMLElement)).toBeNull();
    expect(root.innerHTML).toBe(before);
  });

  it('splits a continuation in the same item and retains rich inline content and a valid caret', () => {
    const root = editor('<ol><li data-marker="1."><p>Title</p><p>Before <strong>middle</strong> after <a href="https://example.com">link</a></p></li><li data-marker="2.">Next</li></ol>');
    const paragraph = root.querySelectorAll('p')[1] as HTMLElement;
    const item = paragraph.parentElement;
    const range = caret(paragraph.querySelector('strong')!.firstChild!, 3);
    const next = enterListParagraph(paragraph, range);
    expect(paragraph.textContent).toBe('Before mid');
    expect(next.textContent).toBe('dle after link');
    expect(next.querySelector('strong')?.textContent).toBe('dle');
    expect(next.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(next.parentElement).toBe(item);
    expect(root.querySelector('ol')?.children).toHaveLength(2);
    expect(root.contains(range.startContainer)).toBe(true);
    expect(range.collapsed).toBe(true);
    expect(markdown(root)).toContain('Before **mid**\n\n   **dle** after [link](https://example.com)');
  });

  it('creates an empty continuation before Enter resumes the next number', () => {
    const root = editor('<ol start="9"><li data-marker="9."><p>Title</p><p>Details</p></li><li data-marker="10.">Existing next</li></ol>');
    const list = root.firstElementChild as HTMLElement;
    const paragraph = root.querySelectorAll('p')[1] as HTMLElement;
    const continuation = enterListParagraph(paragraph, caret(paragraph, paragraph.childNodes.length));
    expect(continuation.parentElement).toBe(list.firstElementChild);
    expect(list.children).toHaveLength(2);
    expect(isEmptyListBlock(continuation)).toBe(true);
    const next = enterListParagraph(continuation, caret(continuation));
    expect(continuation.isConnected).toBe(false);
    expect(next.isConnected).toBe(true);
    expect(next.parentElement).toBe(list.children[1]);
    expect(list.children).toHaveLength(3);
    expect(Array.from(list.children, node => node.getAttribute('data-marker'))).toEqual(['9.', '10.', '11.']);
    next.textContent = 'New numbered item';
    const saved = markdown(root);
    expect(saved).toContain('9. Title\n\n   Details');
    expect(saved).toContain('10. New numbered item\n11. Existing next');
  });

  it('does not exit a blank continuation that still has a following block', () => {
    const root = editor('<ol><li><p>Title</p><p><br></p><p>Later explanation</p></li></ol>');
    const paragraph = root.querySelectorAll('p')[1] as HTMLElement;
    const next = enterListParagraph(paragraph, caret(paragraph, 0));
    expect(next.parentElement).toBe(paragraph.parentElement);
    expect(next.nextElementSibling?.textContent).toBe('Later explanation');
    expect(root.querySelector('ol')?.children).toHaveLength(1);
  });

  it('resumes numbering within a nested list without escaping its parent', () => {
    const root = editor('<ol><li data-marker="1."><p>Parent</p><ol start="3"><li data-marker="3."><p>Child</p><p><br></p></li><li data-marker="4.">Following child</li></ol></li><li data-marker="2.">Following parent</li></ol>');
    const nested = root.querySelector('ol ol') as HTMLElement;
    const paragraph = nested.querySelector('li > p:last-child') as HTMLElement;
    const next = enterListParagraph(paragraph, caret(paragraph));
    expect(next.parentElement?.parentElement).toBe(nested);
    expect(root.firstElementChild?.children).toHaveLength(2);
    expect(Array.from(nested.children, node => node.getAttribute('data-marker'))).toEqual(['3.', '4.', '5.']);
    next.textContent = 'New child';
    expect(markdown(root)).toContain('4. New child\n   5. Following child');
    expect(markdown(root)).toContain('2. Following parent');
  });
});

describe('ordered-list metadata', () => {
  it('keeps explicit starts and delimiters while each nested list counts independently', () => {
    const root = editor('<ol start="9" data-marker="9)"><li data-marker="9)">A</li><li data-marker="9)">B<ol start="3"><li data-marker="3.">C</li><li data-marker="19.">D</li></ol></li><li data-marker="22)">E</li></ol>');
    normalizeOrderedListMarkers(root);
    expect(Array.from(root.firstElementChild!.children, node => node.getAttribute('data-marker'))).toEqual(['9)', '10)', '11)']);
    expect(Array.from(root.querySelector('ol ol')!.children, node => node.getAttribute('data-marker'))).toEqual(['3.', '4.']);
    expect(markdown(root)).toContain('10) B');
    expect(markdown(root)).toContain('11) E');
    expect(root.querySelector('ol ol')?.getAttribute('start')).toBe('3');
  });

  it('serializes two-digit continuation indentation with the correct marker width', () => {
    const root = editor('<ol start="10"><li data-marker="10."><p>Title</p><p>Details</p></li><li data-marker="1.">Next</li></ol>');
    normalizeOrderedListMarkers(root.firstElementChild as HTMLElement);
    expect(markdown(root)).toBe('10. Title\n\n    Details\n11. Next\n');
  });

  it('does not treat non-text content as an empty continuation', () => {
    const root = editor('<p>\u200b<br></p><p><img src="/image.png"></p><p><input type="checkbox"></p><div data-type="code-block"><pre><code>\n</code></pre></div>');
    expect(isEmptyListBlock(root.children[0])).toBe(true);
    expect(isEmptyListBlock(root.children[1])).toBe(false);
    expect(isEmptyListBlock(root.children[2])).toBe(false);
    const wrapper = document.createElement('div');
    wrapper.append(root.children[3]);
    expect(isEmptyListBlock(wrapper)).toBe(false);
  });
});
