// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { TextDecoder, TextEncoder } from 'node:util';
import { describe, expect, it } from 'vitest';
import { clipboardMarkdown, normalizeClipboardHtml, normalizePastedMath } from '../src/notebook/editor-paste';

// Use the editor's real converter: stubbing HTML2Md would miss escaping,
// dropped code tokens and duplicated formula output at this boundary.
const runtime: Record<string, any> = { TextDecoder, TextEncoder, setTimeout, clearTimeout };
runInNewContext(readFileSync(resolve('node_modules/vditor/dist/js/lute/lute.min.js'), 'utf8'), runtime);
const lute = runtime.Lute.New();
const convert = (html: string, plain = '') => clipboardMarkdown(html, plain, (value) => lute.HTML2Md(value));

describe('rich clipboard imports', () => {
  it('keeps a wrapped reply with a single code block as a document', () => {
    const md = convert('<div><h2>Example</h2><p>A <strong>small</strong> program.</p><pre><code class="language-python"><span>print</span>("one")\n<span>print</span>("two")</code></pre><p>Afterward.</p></div>');
    expect(md).toContain('## Example');
    expect(md).toContain('A **small** program.');
    expect(md).toContain('```python\nprint("one")\nprint("two")\n```');
    expect(md).toContain('Afterward.');
    expect(md?.startsWith('```')).toBe(false);
  });

  it('preserves CodeMirror lines, indentation, blank lines and language', () => {
    const md = convert('<div><h3>Loop</h3><div data-code-block="true"><div data-markdown-copy="exclude">Python<button>Copy</button></div><div class="cm-content" data-language="python"><div class="cm-line"><span>for</span> value in items:</div><div class="cm-line">    print(value)</div><div class="cm-line"><br></div><div class="cm-line">done = True</div></div></div></div>');
    expect(md).toContain('```python\nfor value in items:\n    print(value)\n\ndone = True\n```');
    expect(md).not.toContain('Copy');
    expect(md).not.toContain('Python');
  });

  it('preserves span-wrapped code lines without splitting syntax spans', () => {
    const html = '<pre><code class="language-python"><span class="line"><span class="token keyword">class</span> Example:</span><span class="line">\tdef read(self):</span><span class="line"></span><span class="line">\t\treturn <span class="token number">1</span></span></code></pre>';
    expect(convert(html)?.trim()).toBe('```python\nclass Example:\n\tdef read(self):\n\n\t\treturn 1\n```');
  });

  it('preserves nested div code lines and empty line placeholders', () => {
    const html = '<pre><code class="language-python"><div><div>class Example:</div><div>    def read(self):</div><div><br></div><div>        return 1</div></div></code></pre>';
    expect(convert(html)?.trim()).toBe('```python\nclass Example:\n    def read(self):\n\n        return 1\n```');
  });

  it('preserves explicit block-display line boundaries before removing styles', () => {
    const html = '<pre><code class="language-python"><span style="display: block"><span>if</span> ready:</span><span style="display: block">    run()</span><span style="display: block"><br></span><span style="display: block">done = True</span></code></pre>';
    expect(convert(html)?.trim()).toBe('```python\nif ready:\n    run()\n\ndone = True\n```');
  });

  it('copies Expressive Code line contents without line-number gutters', () => {
    const html = '<pre><code class="language-python"><div class="ec-line"><div class="gutter"><span>1</span></div><div class="code"><span>if</span> ready:</div></div><div class="ec-line"><div class="gutter">2</div><div class="code">    run()</div></div><div class="ec-line"><div class="gutter">3</div><div class="code"><br></div></div><div class="ec-line"><div class="gutter">4</div><div class="code">done = True</div></div></code></pre>';
    expect(convert(html)?.trim()).toBe('```python\nif ready:\n    run()\n\ndone = True\n```');
  });

  it('recognizes a partial CodeMirror selection without its outer editor container', () => {
    const html = '<div class="cm-line">if ready:</div><div class="cm-line">\trun()</div><div class="cm-line"><br></div><div class="cm-line">    done = True</div>';
    expect(convert(html)?.trim()).toBe('```\nif ready:\n\trun()\n\n    done = True\n```');
  });

  it('does not delete code lines carrying line-number metadata', () => {
    expect(convert('<pre><code><span class="line" data-line-number="1">class Example:</span><span class="line" data-line-number="2">    pass</span></code></pre>')?.trim()).toBe('```\nclass Example:\n    pass\n```');
  });

  it('does not double existing newlines between explicit code lines', () => {
    const html = '<pre><code class="language-python"><span class="line">a = 1\n</span><span class="line">b = 2\n</span><span class="line">c = 3</span></code></pre>';
    expect(convert(html)?.trim()).toBe('```python\na = 1\nb = 2\nc = 3\n```');
  });

  it('recovers line breaks and language from matching fenced clipboard source', () => {
    const source = 'class Example:\n    def read(self):\n\n        return 1';
    const html = '<h2>Example</h2><pre><code>class Example:    def read(self):        return 1</code></pre><p><a href="https://example.com/docs">Docs</a></p>';
    const plain = 'Unformatted heading\n\n```python\n' + source + '\n```\n\nDocs';
    const md = convert(html, plain);
    expect(md).toContain('```python\n' + source + '\n```');
    expect(md).toContain('## Example');
    expect(md).toContain('[Docs](https://example.com/docs)');
    expect(md).not.toContain('Unformatted heading');
  });

  it('never replaces code with an unrelated fenced clipboard block', () => {
    const html = '<pre><code class="language-python">print("keep")print("this")</code></pre>';
    const plain = '```python\nprint("different")\nprint("source")\n```';
    expect(convert(html, plain)?.trim()).toBe('```python\nprint("keep")print("this")\n```');
  });

  it('matches multiple clipboard code blocks by their content instead of position', () => {
    const html = '<p>First</p><pre><code>const first = 1;console.log(first);</code></pre><p>Second</p><pre><code>value = 2print(value)</code></pre>';
    const plain = '```python\nvalue = 2\nprint(value)\n```\n\n```javascript\nconst first = 1;\nconsole.log(first);\n```';
    const md = convert(html, plain)!;
    const first = '```javascript\nconst first = 1;\nconsole.log(first);\n```';
    const second = '```python\nvalue = 2\nprint(value)\n```';
    expect(md).toContain(first);
    expect(md).toContain(second);
    expect(md.indexOf(first)).toBeLessThan(md.indexOf(second));
  });

  it.each([
    ['print("hello world")print("next")', 'print("hello  world")\nprint("next")'],
    ['if ready:    run()', 'if ready:\n  run()'],
    ['if ready:\trun()', 'if ready:\n    run()'],
  ])('does not reconcile code that differs in spaces or tabs: %s', (original, other) => {
    const html = '<pre><code class="language-python">' + original + '</code></pre>';
    expect(convert(html, '```python\n' + other + '\n```')?.trim()).toBe('```python\n' + original + '\n```');
  });

  it('does not treat code lines containing HTML text as markup', () => {
    expect(convert('<pre><code class="language-html">&lt;h1&gt;Hi&lt;/h1&gt;<br>&lt;script&gt;bad()&lt;/script&gt;</code></pre>')).toContain('<h1>Hi</h1>\n<script>bad()</script>');
  });

  it('keeps inline and display math from the chat copy button', () => {
    const md = convert('<p>Cost <span data-math-source="O(n^2)" data-math-display="false">\\(O(n^2)\\)</span>.</p><span data-math-source="\\frac{a}{b}" data-math-display="true">ignored glyphs</span>');
    expect(md).toContain('Cost $O(n^2)$.');
    expect(md).toContain('$$\n\\frac{a}{b}\n$$');
    expect(md).not.toContain('ignored glyphs');
  });

  it.each([
    String.raw`<p>\[ 6-2=4 \]</p>`,
    String.raw`<span>\[ 6-2=4 \\]</span>`,
    String.raw`<div>\\[ 6-2=4 \\]</div>`,
    String.raw`<p>\[<br>6-2=4<br>\]</p>`,
    String.raw`<p>\[ <strong>6-2</strong>=4 \]</p>`,
  ])('recovers display math before rich text conversion escapes it: %s', html => {
    expect(convert(html)?.trim()).toBe('$$\n6-2=4\n$$');
  });

  it('keeps Chinese text and arrows from a raw formula selection', () => {
    const md = convert(String.raw`<p>\[ \text{元素值}\rightarrow\text{元素下标} \]</p>`);
    expect(md?.trim()).toBe('$$\n\\text{元素值}\\rightarrow\\text{元素下标}\n$$');
  });

  it('keeps multiple raw formulas separate across inline markup', () => {
    const md = convert(String.raw`<p>First \(<em>x</em>+1\), then \(y+2\).</p>`);
    expect(md?.trim()).toBe('First $x+1$, then $y+2$.');
  });

  it('does not interpret TeX examples inside code or links as formulas', () => {
    const html = String.raw`<p>Literal <code>\[6-2=4\]</code> and <a href="https://example.com">\(x+1\)</a>.</p>`;
    expect(normalizeClipboardHtml(html)).not.toContain('language-math');
    expect(convert(html)).toContain('`\\[6-2=4\\]`');
  });

  it('does not consume images or other atomic content between delimiter fragments', () => {
    const html = String.raw`<p>\[a <img src="https://example.com/diagram.png" alt="Diagram"> + b\] then \(x+1\).</p>`;
    const normalized = normalizeClipboardHtml(html);
    const parsed = new DOMParser().parseFromString(normalized, 'text/html');
    expect(parsed.querySelector('img')?.getAttribute('src')).toBe('https://example.com/diagram.png');
    expect(Array.from(parsed.querySelectorAll('.language-math'), node => node.textContent)).toEqual(['x+1']);
    expect(convert(html)).toContain('![Diagram](https://example.com/diagram.png)');
    for (const atom of ['<hr>', '<video src="clip.mp4"></video>', '<audio src="clip.mp3"></audio>', '<canvas></canvas>', '<input type="checkbox">']) {
      const safe = normalizeClipboardHtml(String.raw`<div>\[a ` + atom + String.raw` + b\]</div>`);
      expect(safe).not.toContain('language-math');
      expect(safe).toContain(atom.match(/^<(\w+)/)![1]);
    }
  });

  it('preserves literal delimiters inside existing dollar math without blocking neighboring formulas', () => {
    const literal = String.raw`$$\text{Literal \(x+1\)}$$`;
    const html = `<p>${literal} and \\(y+2\\).</p>`;
    const normalized = normalizeClipboardHtml(html);
    const parsed = new DOMParser().parseFromString(normalized, 'text/html');
    expect(Array.from(parsed.querySelectorAll('.language-math'), node => node.textContent)).toEqual([String.raw`\text{Literal \(x+1\)}`, 'y+2']);
    expect(convert(html)).toContain(String.raw`\text{Literal \(x+1\)}`);
    expect(convert(html)).toContain('$y+2$');
  });

  it('preserves aligned equation line breaks through HTML conversion', () => {
    const source = String.raw`\begin{aligned}a&=b\\c&=d\end{aligned}`;
    expect(convert(`<p>\\[ ${source.replaceAll('&', '&amp;')} \\]</p>`)?.trim()).toBe(`$$\n${source}\n$$`);
  });

  it('uses TeX once rather than copying the two KaTeX render trees', () => {
    const md = convert('<p>Cost <span class="katex"><span class="katex-mathml"><math><semantics><mrow>rendered</mrow><annotation encoding="application/x-tex">O(n^2)</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">On2</span></span></p>');
    expect(md?.trim()).toBe('Cost $O(n^2)$');
  });

  it('renders numeric-leading inline formulas independently and round-trips their source', () => {
    const editorLute = runtime.Lute.New();
    editorLute.SetInlineMathAllowDigitAfterOpenMarker(true);
    const markdown = convert('<p>Cost <span data-math-source="2^n">\\(2^n\\)</span> and <span data-math-source="10">\\(10\\)</span>.</p>')!;
    const dom = editorLute.Md2VditorDOM(markdown);
    const document = new DOMParser().parseFromString(dom, 'text/html');
    expect(Array.from(document.querySelectorAll('code[data-type="math-inline"]'), node => node.textContent?.replace(/\u200b/g, ''))).toEqual(['2^n', '10']);
    expect(editorLute.VditorDOM2Md(dom).trim()).toBe('Cost $2^n$ and $10$.');
  });

  it('preserves tables, nested lists, quotes, links and images', () => {
    const md = convert('<div><blockquote><p>Note</p></blockquote><ol start="3"><li>Three<ul><li>Child</li></ul></li></ol><table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody><tr><td>A</td><td><code>10</code></td></tr></tbody></table><p><a href="https://example.com/docs">Docs</a><img src="https://example.com/chart.png" alt="Chart"></p></div>');
    expect(md).toContain('> Note');
    expect(md).toContain('3. Three');
    expect(md).toContain('* Child');
    expect(md).toContain('| Key');
    expect(md).toContain('`10`');
    expect(md).toContain('[Docs](https://example.com/docs)');
    expect(md).toContain('![Chart](https://example.com/chart.png)');
  });

  it('removes copied page controls and executable content', () => {
    const safe = normalizeClipboardHtml('<p onclick="bad()">Hello</p><button>Copy</button><script>bad()</script><iframe src="https://example.com"></iframe><a href="javascript:bad()">link</a><img src="https://example.com/x" onerror="bad()">');
    expect(safe).not.toMatch(/onclick|onerror|javascript:|<script|<iframe|<button/);
    expect(safe).toContain('Hello');
  });

  it('does not guess line boundaries that the source already discarded', () => {
    expect(convert('<pre><code>a = 1b = 2</code></pre>')).toContain('a = 1b = 2');
  });

  it('pastes a code-only Python definition without Markdown consuming indentation', () => {
    const source = 'class Example:\n    def read(self) -> int:\n        value = 1\n\n        return value';
    const md = clipboardMarkdown('', source, lute.HTML2Md)!;
    expect(md).toBe('```python\n' + source + '\n```\n');
    const dom = new DOMParser().parseFromString(lute.Md2VditorDOM(md), 'text/html');
    expect(dom.querySelector('pre code')?.textContent).toBe(source + '\n');
  });

  it('does not guess that prose or an incomplete definition is raw code', () => {
    expect(clipboardMarkdown('', 'An example:\nclass Example:\n    pass', lute.HTML2Md)).toBeNull();
    expect(clipboardMarkdown('', 'class Example:', lute.HTML2Md)).toBeNull();
    expect(clipboardMarkdown('', 'class Example:\n    pass\n\nfor further details see below', lute.HTML2Md)).toBeNull();
  });

  it('leaves ordinary plain Markdown, URL-only and image-only paste to the editor', () => {
    expect(clipboardMarkdown('', '## Heading\n\n```ts\nx()\n```', lute.HTML2Md)).toBeNull();
    expect(clipboardMarkdown('<a href="https://example.com">https://example.com</a>', 'https://example.com', lute.HTML2Md)).toBeNull();
    expect(clipboardMarkdown('<img src="data:image/png;base64,AAAA">', '', lute.HTML2Md)).toBeNull();
  });
});

describe('pasted TeX delimiters', () => {
  it('normalizes inline and display math in plain Markdown', () => {
    expect(normalizePastedMath('Cost \\(O(n^2)\\).')).toBe('Cost $O(n^2)$.');
    expect(normalizePastedMath('\\[\nx^2 + y^2\n\\]')).toContain('$$\nx^2 + y^2\n$$');
  });

  it('leaves inline code, code fences, links and escaped delimiters untouched', () => {
    const source = '`\\(literal\\)`\n\n```python\nvalue = "\\(literal\\)"\n```\n\n[\\(link\\)](https://example.com)\n\\\\(escaped\\)';
    expect(normalizePastedMath(source)).toBe(source);
  });
});
