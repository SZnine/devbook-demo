const blocks = 'p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,pre,table,div,hr';
const atoms = 'img,input,video,audio,iframe,hr,table,[data-type="code-block"],[data-type="math-block"]';

export function isEmptyListBlock(node: Element) {
  return !node.textContent?.replace(/\u200b/g, '').trim() && !node.querySelector(atoms);
}

/** Vditor stores tight items as inline nodes; loose items require real paragraphs. */
function paragraphize(item: HTMLElement) {
  let paragraph: HTMLParagraphElement | null = null;
  for (const node of Array.from(item.childNodes)) {
    if (node instanceof Element && node.matches(blocks)) { paragraph = null; continue; }
    if (!paragraph) {
      paragraph = item.ownerDocument.createElement('p');
      paragraph.dataset.block = '0';
      node.before(paragraph);
    }
    paragraph.append(node);
  }
}

export function continuePreviousListItem(item: HTMLElement): HTMLElement | null {
  const list = item.parentElement;
  const previous = item.previousElementSibling as HTMLElement | null;
  if (list?.tagName !== 'OL' || previous?.tagName !== 'LI') return null;
  paragraphize(previous);
  paragraphize(item);
  if (!item.firstElementChild) {
    const p = item.ownerDocument.createElement('p');
    p.dataset.block = '0';
    p.append(item.ownerDocument.createElement('br'));
    item.append(p);
  }
  const target = item.firstElementChild as HTMLElement;
  previous.append(...item.childNodes);
  item.remove();
  list.dataset.tight = 'false';
  normalizeOrderedListMarkers(list);
  return target;
}

/** Split a continuation paragraph locally; an empty final paragraph resumes numbering. */
export function enterListParagraph(paragraph: HTMLElement, range: Range): HTMLElement {
  const item = paragraph.parentElement!;
  const list = item.parentElement!;
  const document = paragraph.ownerDocument;
  const next = document.createElement('p');
  next.dataset.block = '0';
  if (isEmptyListBlock(paragraph) && !paragraph.nextElementSibling) {
    const sibling = document.createElement('li');
    next.append(document.createElement('br'));
    sibling.append(next);
    item.after(sibling);
    paragraph.remove();
  } else {
    const tail = range.cloneRange();
    tail.setEnd(paragraph, paragraph.childNodes.length);
    next.append(tail.extractContents());
    if (!next.hasChildNodes()) next.append(document.createElement('br'));
    if (!paragraph.hasChildNodes()) paragraph.append(document.createElement('br'));
    paragraph.after(next);
  }
  list.dataset.tight = 'false';
  normalizeOrderedListMarkers(list);
  return next;
}

export function normalizeOrderedListMarkers(root: HTMLElement) {
  const lists = [...(root.matches('ol') ? [root] : []), ...root.querySelectorAll<HTMLOListElement>('ol')];
  for (const list of lists) {
    const start = Number.parseInt(list.getAttribute('start') || '1', 10);
    const first = Number.isFinite(start) ? start : 1;
    const delimiter = list.getAttribute('data-marker')?.endsWith(')') ? ')' : '.';
    if (list.getAttribute('data-marker') !== `${first}${delimiter}`) list.setAttribute('data-marker', `${first}${delimiter}`);
    Array.from(list.children).filter(item => item.tagName === 'LI').forEach((item, index) => {
      const marker = `${first + index}${delimiter}`;
      if (item.getAttribute('data-marker') !== marker) item.setAttribute('data-marker', marker);
    });
  }
}
