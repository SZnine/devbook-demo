import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Nodes } from 'mdast';

export interface MathExpression {
  start: number;
  end: number;
  source: string;
  block: boolean;
}

// Recognition is deliberately bounded: a doubled backslash can also be literal
// prose or a TeX row separator. Only known commands justify repairing an export.
const commands = new Set((
  'text textrm textsf texttt textbf textit textnormal textcolor color ' +
  'frac dfrac tfrac cfrac sqrt binom dbinom tbinom ' +
  'begin end left right middle big Big bigg Bigg bigl bigr Bigl Bigr biggl biggr Biggl Biggr ' +
  'mathbf mathrm mathit mathsf mathtt mathbb mathcal mathscr mathfrak boldsymbol ' +
  'operatorname overline underline overbrace underbrace overset underset stackrel ' +
  'hat widehat bar vec dot ddot tilde widetilde acute grave breve check ' +
  'sum prod coprod int iint iiint oint lim limsup liminf min max sup inf ' +
  'sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh log ln exp det gcd ' +
  'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega ' +
  'Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega ' +
  'rightarrow leftarrow leftrightarrow Rightarrow Leftarrow Leftrightarrow longrightarrow longleftarrow longleftrightarrow Longrightarrow Longleftarrow Longleftrightarrow mapsto to gets ' +
  'uparrow downarrow updownarrow Uparrow Downarrow Updownarrow ' +
  'times cdot div pm mp le leq ge geq ne neq approx sim simeq equiv propto in notin ni subset supset subseteq supseteq ' +
  'cup cap setminus land lor neg forall exists emptyset varnothing infinity infty partial nabla degree ' +
  'ldots cdots vdots ddots dots quad qquad hspace vspace displaystyle textstyle scriptstyle scriptscriptstyle ' +
  'langle rangle lceil rceil lfloor rfloor vert Vert lvert rvert lVert rVert ' +
  'underbracket overbracket cancel bcancel xcancel phantom hphantom vphantom not label tag'
).split(/\s+/));

function hasMathEvidence(source: string): boolean {
  return /[=+*/^_<>−×÷≤≥≈∑∫√]|\d\s*[-–]\s*\d/.test(source)
    || Array.from(source.matchAll(/\\+([A-Za-z]+)/g)).some(match => commands.has(match[1]));
}

function restoreExportedCommands(source: string, escapedBoundary: boolean): string {
  if (!escapedBoundary) return source;
  const runs = Array.from(source.matchAll(/(\\+)([A-Za-z]+)/g));
  const recognized = runs.filter(match => commands.has(match[2]));
  if (!recognized.length || runs.some(match => match[1].length === 1)
      || recognized.some(match => match[1].length !== 2)) return source;
  let repaired = source.replace(/(\\+)([A-Za-z]+)/g, (match, slashes: string, command: string) =>
    slashes.length === 2 && commands.has(command) ? `\\${command}` : match);
  // A consistently escaped environment also escapes its row delimiters. A
  // normal environment contains single-slash commands and never reaches here.
  if (/\\begin\{(?:[bpBvV]?matrix|smallmatrix|aligned|alignedat|gathered|array|cases)\}/.test(repaired)) {
    repaired = repaired.replace(/\\+/g, run => run.length === 4 ? '\\\\' : run);
  }
  return repaired;
}

/** Find chat-export TeX delimiters in visible text, before HTML2Md escapes it. */
export function findMathExpressions(text: string): MathExpression[] {
  const result: MathExpression[] = [];
  const marker = /\\+([()[\]])/g;
  let opening: { start: number; end: number; slashes: number; block: boolean } | undefined;
  for (const match of text.matchAll(marker)) {
    const slashes = match[0].length - 1;
    const character = match[1];
    if (slashes > 2) { opening = undefined; continue; }
    if (character === '(' || character === '[') {
      opening = { start: match.index!, end: match.index! + match[0].length, slashes, block: character === '[' };
      continue;
    }
    if (!opening || character !== (opening.block ? ']' : ')')) continue;
    const source = text.slice(opening.end, match.index).trim();
    const escaped = opening.slashes === 2 || slashes === 2;
    if (source && (!escaped || hasMathEvidence(source))) {
      result.push({ start: opening.start, end: match.index! + match[0].length,
        source: restoreExportedCommands(source, escaped), block: opening.block });
    }
    opening = undefined;
  }
  return result;
}

function protectedMarkdownRanges(markdown: string): [number, number][] {
  const ranges: [number, number][] = [];
  const visit = (node: Nodes) => {
    if (['code', 'inlineCode', 'html', 'link', 'image'].includes(node.type) && node.position) {
      ranges.push([node.position.start.offset!, node.position.end.offset!]);
    } else if ('children' in node) node.children.forEach(visit);
  };
  visit(unified().use(remarkParse).parse(markdown));
  const dollars = /\$+/g;
  let opening: { start: number; end: number; count: number } | undefined;
  for (const match of markdown.matchAll(dollars)) {
    const start = match.index!;
    let slashes = 0;
    for (let index = start - 1; index >= 0 && markdown[index] === '\\'; index--) slashes++;
    if (slashes % 2 || match[0].length > 2 || ranges.some(([from, to]) => start >= from && start < to)) continue;
    if (opening && opening.count === 1 && markdown.slice(opening.end, start).includes('\n')) opening = undefined;
    if (opening && opening.count === match[0].length) {
      ranges.push([opening.start, start + match[0].length]);
      opening = undefined;
    } else if (!opening) opening = { start, end: start + match[0].length, count: match[0].length };
  }
  return ranges;
}

function displayMarkdown(markdown: string, expression: MathExpression): string {
  const lineStart = markdown.lastIndexOf('\n', expression.start - 1) + 1;
  const before = markdown.slice(lineStart, expression.start);
  const context = before.match(/^((?:[ \t]{0,3}>[ \t]?)*)([ \t]*)(?:([-+*]|\d+[.)])([ \t]+))?/)!;
  const quotes = context[1];
  const indentation = context[2] + (context[3] ? ' '.repeat(context[3].length + context[4].length) : '');
  const continuation = quotes + indentation;
  const source = expression.source.split('\n').map(line => {
    if (continuation && line.startsWith(continuation)) return line.slice(continuation.length);
    if (quotes && line.trimEnd() === quotes.trimEnd()) return '';
    return line;
  }).join('\n').trim();
  const body = ['$$', ...source.split('\n'), '$$'].join(`\n${continuation}`);
  const prefix = before === context[0] ? '' : `\n${continuation}\n${continuation}`;
  const endLine = markdown.indexOf('\n', expression.end);
  const after = markdown.slice(expression.end, endLine < 0 ? undefined : endLine);
  const suffix = after.trim() ? `\n${continuation}\n${continuation}` : '';
  return prefix + body + suffix;
}

/** Normalize chat-export math without changing code, links or existing math. */
export function normalizeMathMarkdown(markdown: string): string {
  const expressions = findMathExpressions(markdown);
  if (!expressions.length) return markdown;
  const protectedRanges = protectedMarkdownRanges(markdown);
  let output = '';
  let cursor = 0;
  for (const expression of expressions) {
    if (protectedRanges.some(([start, end]) => expression.start < end && expression.end > start)) continue;
    output += markdown.slice(cursor, expression.start);
    output += expression.block ? displayMarkdown(markdown, expression) : `$${expression.source}$`;
    cursor = expression.end;
  }
  return output + markdown.slice(cursor);
}
