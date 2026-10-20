import { describe, expect, it } from 'vitest';
import katex from 'katex';
import { findMathExpressions, normalizeMathMarkdown } from '../src/content/math-source';

const render = (source: string) => katex.renderToString(source, { displayMode: true, throwOnError: true, strict: 'ignore' });

describe('chat-export math source', () => {
  it('recognizes single, doubled and mixed display boundaries', () => {
    for (const source of [String.raw`\[ 6-2=4 \]`, String.raw`\\[ 6-2=4 \\]`, String.raw`\[ 6-2=4 \\]`]) {
      const expressions = findMathExpressions(source);
      expect(expressions).toEqual([{ start: 0, end: source.length, source: '6-2=4', block: true }]);
      expect(normalizeMathMarkdown(source)).toBe('$$\n6-2=4\n$$');
      expect(() => render(expressions[0].source)).not.toThrow();
    }
  });

  it('preserves real commands when ChatGPT only escapes delimiters', () => {
    const source = String.raw`\\[ \text{元素值}\rightarrow\text{元素下标} \\]`;
    const expression = findMathExpressions(source)[0];
    expect(expression.source).toBe(String.raw`\text{元素值}\rightarrow\text{元素下标}`);
    expect(() => render(expression.source)).not.toThrow();
    expect(normalizeMathMarkdown(source)).toBe('$$\n' + expression.source + '\n$$');
  });

  it('repairs consistently escaped recognized commands without global slash replacement', () => {
    const source = String.raw`\[ \\text{元素值}\\rightarrow\\text{元素下标} \\]`;
    const expression = findMathExpressions(source)[0];
    expect(expression.source).toBe(String.raw`\text{元素值}\rightarrow\text{元素下标}`);
    expect(() => render(expression.source)).not.toThrow();
    expect(findMathExpressions(String.raw`\\[ \text{one} + \\text{two} \\]`)[0].source)
      .toBe(String.raw`\text{one} + \\text{two}`);
  });

  it('preserves aligned and matrix rows and repairs uniformly escaped environments', () => {
    for (const source of [String.raw`\\[ \begin{aligned}a&=b\\c&=d\end{aligned} \\]`,
      String.raw`\\[ \\begin{aligned}a&=b\\\\c&=d\\end{aligned} \\]`]) {
      const expression = findMathExpressions(source)[0];
      expect(expression.source).toBe(String.raw`\begin{aligned}a&=b\\c&=d\end{aligned}`);
      expect(() => render(expression.source)).not.toThrow();
    }
    const matrix = findMathExpressions(String.raw`\\[ \begin{bmatrix}1&2\\3&4\end{bmatrix} \\]`)[0];
    expect(matrix.source).toBe(String.raw`\begin{bmatrix}1&2\\3&4\end{bmatrix}`);
    expect(() => render(matrix.source)).not.toThrow();
  });

  it('normalizes credible inline math and leaves escaped prose or unpaired markers alone', () => {
    expect(normalizeMathMarkdown(String.raw`Cost \(O(n^2)\) and \\(x+1\\).`)).toBe('Cost $O(n^2)$ and $x+1$.');
    for (const source of [String.raw`\\(escaped\)`, String.raw`\\[filename\\]`, String.raw`\[unclosed`, String.raw`\\\[ x+1 \\\]`]) {
      expect(normalizeMathMarkdown(source)).toBe(source);
    }
  });

  it('preserves code, fenced code, links, images, HTML and existing dollar math', () => {
    const source = ['`' + String.raw`\[6-2=4\]` + '`',
      '```tex\n' + String.raw`\\[\text{example}\\]` + '\n```',
      String.raw`[\(x+1\)](https://example.com)`,
      String.raw`![\[x+1\]](https://example.com/image.png)`,
      String.raw`<pre>\[x+1\]</pre>`,
      '$$\n' + String.raw`\text{Literal \[x+1\]}` + '\n$$',
      String.raw`$\text{Literal \(x+1\)}$`].join('\n\n');
    expect(normalizeMathMarkdown(source)).toBe(source);
  });

  it('retains blockquote and list membership for multi-line display formulas', () => {
    expect(normalizeMathMarkdown(String.raw`> \[6-2=4\]`)).toBe('> $$\n> 6-2=4\n> $$');
    expect(normalizeMathMarkdown('> \\[\n> 6-2=4\n> \\]')).toBe('> $$\n> 6-2=4\n> $$');
    expect(normalizeMathMarkdown(String.raw`- \[6-2=4\]`)).toBe('- $$\n  6-2=4\n  $$');
    expect(normalizeMathMarkdown(String.raw`> - \[6-2=4\]`)).toBe('> - $$\n>   6-2=4\n>   $$');
    expect(normalizeMathMarkdown(String.raw`Before \[6-2=4\] afterward.`)).toBe('Before \n\n$$\n6-2=4\n$$\n\n afterward.');
  });

  it('normalization is idempotent', () => {
    const source = String.raw`An equation \\(x+1\\), then \\[ \text{元素值}\rightarrow\text{元素下标} \\].`;
    const normalized = normalizeMathMarkdown(source);
    expect(normalizeMathMarkdown(normalized)).toBe(normalized);
  });
});
