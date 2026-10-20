import DOMPurify from 'dompurify';
import { findMathExpressions, normalizeMathMarkdown } from '../content/math-source';

export const normalizePastedMath = normalizeMathMarkdown;

/** Recover raw TeX before HTML2Md escapes its slashes as ordinary prose. */
function normalizeHtmlMath(root: HTMLElement) {
  type TextRun = { text: string; nodes: { node: Text; start: number; end: number }[] };
  const runs: TextRun[] = [];
  let run: TextRun = { text: '', nodes: [] };
  const flush = () => { if (run.nodes.length) runs.push(run); run = { text: '', nodes: [] }; };
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const start = run.text.length;
      run.text += node.textContent || '';
      run.nodes.push({ node: node as Text, start, end: run.text.length });
    } else if (node instanceof Element) {
      if (node.matches('pre,code,a,script,style,math,.language-math,.katex,[data-math-source],img,hr,video,audio,canvas,svg,input')) { flush(); return; }
      if (node.tagName === 'BR') { run.text += '\n'; return; }
      const block = node.matches('p,div,li,td,th,blockquote,h1,h2,h3,h4,h5,h6');
      if (block) flush();
      node.childNodes.forEach(visit);
      if (block) flush();
    }
  };
  visit(root); flush();
  for (const { text, nodes } of runs.reverse()) {
    // An existing dollar-delimited formula owns its literal TeX, including any
    // bracket/parenthesis examples inside it. Other formulas in the run remain eligible.
    const existingMath = Array.from(text.matchAll(/(?<![\\$])\$\$(?!\$)[\s\S]+?(?<![\\$])\$\$(?!\$)|(?<![\\$])\$(?!\$)[^\n$]+?(?<!\\)\$(?!\$)/g), match => {
      const block = match[0].startsWith('$$');
      const count = block ? 2 : 1;
      return { start: match.index!, end: match.index! + match[0].length, block, source: match[0].slice(count, -count) };
    });
    const candidates = findMathExpressions(text);
    const expressions = [
      ...candidates.filter(candidate => !existingMath.some(math => candidate.start < math.end && candidate.end > math.start)),
      // Carry the enclosing source through Lute as math instead of allowing it
      // to escape the dollar markers and expose the inner example a second time.
      ...existingMath.filter(math => candidates.some(candidate => candidate.start < math.end && candidate.end > math.start)),
    ].sort((left, right) => right.start - left.start);
    for (const match of expressions) {
      const start = nodes.find(part => part.start <= match.start && part.end > match.start);
      const end = nodes.find(part => part.start < match.end && part.end >= match.end);
      if (!start || !end) continue;
      const range = root.ownerDocument.createRange();
      range.setStart(start.node, match.start - start.start);
      range.setEnd(end.node, match.end - end.start);
      const math = root.ownerDocument.createElement(match.block ? 'div' : 'span');
      math.className = 'language-math';
      math.textContent = match.source;
      range.deleteContents(); range.insertNode(math);
    }
  }
}

function codeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (node instanceof Element && node.tagName === 'BR') return '\n';
  const children = Array.from(node.childNodes);
  const isLine = (child: Node) => child instanceof HTMLElement && (
    child.matches('div,p,.cm-line,.ec-line,.line') || child.style.display === 'block'
  );
  if (!children.some(isLine)) return children.map(codeText).join('');

  // Highlighting spans are inline; explicit line wrappers are not. Do this
  // before sanitizing styles, including wrappers nested inside another div.
  const lines: string[] = [];
  let inline = '';
  const flush = () => { if (inline.trim()) lines.push(inline); inline = ''; };
  for (const child of children) {
    if (!isLine(child)) { inline += codeText(child); continue; }
    flush();
    let text = codeText(child);
    // BR placeholders and already-terminated lines need only one separator.
    if (child !== children.at(-1) || (child.lastChild instanceof Element && child.lastChild.tagName === 'BR')) text = text.replace(/\n$/, '');
    lines.push(text);
  }
  flush();
  return lines.join('\n');
}

function fencedCodeSources(markdown: string) {
  const blocks: { text: string; language: string }[] = [];
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const opening = lines[i].match(/^ {0,3}(`{3,}|~{3,})([^\s`]*)[^\n]*$/);
    if (!opening) continue;
    const closing = new RegExp(`^ {0,3}${opening[1][0]}{${opening[1].length},}\\s*$`);
    const start = ++i;
    while (i < lines.length && !closing.test(lines[i])) i++;
    if (i < lines.length) blocks.push({ text: lines.slice(start, i).join('\n'), language: opening[2] });
  }
  return blocks;
}

function plainPythonCode(text: string): string | null {
  const source = text.replace(/\r\n?/g, '\n');
  // Code-only copy buttons provide no HTML or language metadata. Recognize a
  // complete Python definition before Markdown consumes its significant indent.
  // Prose, existing Markdown and ambiguous snippets stay with native paste.
  if (/^\s*(`{3,}|~{3,})/m.test(source)) return null;
  const lines = source.split('\n');
  const topLevel = lines.filter(line => line.trim() && !/^[ \t]/.test(line));
  if (!topLevel.length || !topLevel.every(line => /^(?:#|@\w|(?:async )?def\s+\w+\s*\(|class\s+\w+[(:]|(?:from\s+[\w.]+\s+)?import\s|[\w.]+\s*(?::[^=]+)?=(?!=))/.test(line) || /^(?:if|elif|for|while|with|try|except|finally|else)\b.*:\s*(?:#.*)?$/.test(line))) return null;
  if (!lines.some((line, i) => /^(?:class\s+\w+(?:\([^\n]*\))?|(?:async )?def\s+\w+\([^\n]*\)(?:\s*->[^:]+)?):\s*$/.test(line) && /^[ \t]+\S/.test(lines.slice(i + 1).find(next => next.trim()) || ''))) return null;
  const fence = '`'.repeat(Math.max(3, ...Array.from(source.matchAll(/`+/g), match => match[0].length + 1)));
  return `${fence}python\n${source}${source.endsWith('\n') ? '' : '\n'}${fence}\n`;
}

/** Work on a detached document. Never insert copied page HTML into the editor. */
export function normalizeClipboardHtml(html: string, plain = ''): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const root = document.body;

  // CodeMirror splits a single code block into divs and syntax spans. Restore
  // line boundaries before stripping page controls and presentation attributes.
  root.querySelectorAll<HTMLElement>('.cm-content').forEach(content => {
    const lines = content.querySelectorAll('.cm-line');
    if (!lines.length) return;
    const wrapper = content.closest('[data-code-block], [data-markdown-copy="code-block"]') || content.closest('pre') || content;
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    const language = content.getAttribute('data-language') || '';
    if (/^[\w+#.-]+$/.test(language)) code.className = `language-${language}`;
    code.textContent = codeText(content);
    pre.append(code);
    wrapper.replaceWith(pre);
  });

  // Selection-copy may omit the editor's outer container entirely.
  root.querySelectorAll('.cm-line').forEach(first => {
    if (!root.contains(first) || first.closest('pre')) return;
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    const lines: string[] = [];
    let line: Element | null = first;
    while (line?.classList.contains('cm-line')) {
      lines.push(codeText(line).replace(/\n$/, ''));
      const next: Element | null = line.nextElementSibling;
      if (line === first) line.before(pre);
      line.remove();
      line = next;
    }
    code.textContent = lines.join('\n');
    pre.append(code);
  });

  root.querySelectorAll('[data-markdown-copy="exclude"], [data-code-block-controls], button, [role="button"], script, style, iframe, object, embed').forEach(node => node.remove());

  // ChatGPT's copy button provides source explicitly; selection-copy carries
  // KaTeX's accessible TeX annotation alongside a second, visual glyph tree.
  root.querySelectorAll<HTMLElement>('[data-math-source], .katex-display, .katex').forEach(node => {
    if (!root.contains(node)) return;
    const source = node.getAttribute('data-math-source') ?? node.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    if (!source) return;
    const block = node.getAttribute('data-math-display') === 'true' || node.classList.contains('katex-display') || node.classList.contains('math-block');
    const math = document.createElement(block ? 'div' : 'span');
    math.className = 'language-math';
    math.textContent = source;
    node.replaceWith(math);
  });

  normalizeHtmlMath(root);

  const plainBlocks = fencedCodeSources(plain);
  root.querySelectorAll('pre').forEach(pre => {
    pre.querySelectorAll('.gutter,.line-number,.line-numbers-rows,.cm-gutters').forEach(node => node.remove());
    const original = pre.querySelector('code') || pre;
    let text = codeText(original);
    const code = document.createElement('code');
    let language = original.className.match(/(?:^|\s)(?:language|lang)-([\w+#.-]+)/)?.[1] || original.getAttribute('data-language') || pre.getAttribute('data-language');
    // Some browsers preserve source in text/plain while flattening HTML.
    // Match every character except line endings; never reindent or guess code.
    const match = plainBlocks.findIndex(block => block.text.replace(/\n/g, '') === text.replace(/\r?\n/g, ''));
    if (match >= 0) {
      const [source] = plainBlocks.splice(match, 1);
      if (source.text.split('\n').length >= text.split('\n').length) text = source.text;
      language ||= source.language;
    }
    if (language && /^[\w+#.-]+$/.test(language)) code.className = `language-${language}`;
    code.textContent = text;
    pre.replaceChildren(code);
  });

  root.querySelectorAll<HTMLElement>('span').forEach(node => {
    const weight = node.getAttribute('data-d-weight');
    if (weight !== 'bold' && weight !== 'semibold' && !['bold', '600', '700'].includes(node.style.fontWeight)) return;
    const strong = document.createElement('strong');
    strong.append(...node.childNodes);
    node.replaceWith(strong);
  });
  root.querySelectorAll('[style]').forEach(node => node.removeAttribute('style'));

  return DOMPurify.sanitize(root.innerHTML, { USE_PROFILES: { html: true, mathMl: true },
    FORBID_TAGS: ['button', 'form', 'textarea', 'select', 'svg', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['contenteditable'], ALLOW_DATA_ATTR: false });
}

export function clipboardMarkdown(html: string, plain: string, html2md: (html: string) => string): string | null {
  if (!html.trim()) {
    const code = plainPythonCode(plain);
    if (code) return code;
    const normalized = normalizePastedMath(plain);
    return normalized === plain ? null : normalized;
  }
  // Keep native image/file, URL and internal editor clipboard handling.
  if (/class=["'][^"']*vditor-(?:wysiwyg|ir|sv)/.test(html)) return null;
  if (!/<(?:p|h[1-6]|pre|ul|ol|table|blockquote)\b|\b(?:data-math-source|katex|cm-content|cm-line)\b|\\[([]/i.test(html)) return null;
  const markdown = html2md(normalizeClipboardHtml(html, plain));
  return markdown.trim() ? normalizePastedMath(markdown) : null;
}
