import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import type { Element } from 'hast';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { ExpressiveCodeBlock } from './content/ExpressiveCode';
import { MathFormula, MermaidDiagram } from './content/RichMedia';
import { getRenderedMarkdown, renderMarkdown, scopeAnchors, textOf, type RenderedMarkdown } from './content/vditor-renderer';
import './content/markdown.css';

const components = {
  a: ({ children, href, node: _node, ...props }: React.ComponentProps<'a'> & { node?: Element }) => <a {...props} href={href}
    target={href?.startsWith('#') ? undefined : '_blank'} rel={href?.startsWith('#') ? undefined : 'noopener noreferrer'}>{children}</a>,
  table: ({ children }: React.ComponentProps<'table'>) => <div className="table-scroll" tabIndex={0}><table>{children}</table></div>,
  input: ({ checked }: React.ComponentProps<'input'>) => <input type="checkbox" checked={!!checked} disabled aria-label="原文勾选项" />,
  img: ({ node: _node, ...props }: React.ComponentProps<'img'> & { node?: Element }) => <img {...props} loading="lazy" decoding="async" />,
};

function Code({ node }: { node?: Element }) {
  const child = node?.children.find(item => item.type === 'element' && item.tagName === 'code');
  const source = child ? textOf(child) : node ? textOf(node) : '';
  const language = String(node?.properties.dataCodeLanguage || (child?.type === 'element'
    ? (child.properties.className as string[] | undefined)?.find(item => item.startsWith('language-'))?.slice(9) : '') || '');
  if (language === 'mermaid') return <MermaidDiagram source={source} />;
  return <ExpressiveCodeBlock code={source} language={language} meta={String(node?.properties.dataCodeMeta || '')} />;
}

export function Markdown({ body }: { body: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const host = useRef<HTMLDivElement>(null);
  const restore = useRef<{ body: string; details: boolean[]; scroll: { element: HTMLElement; top: number; left: number }[]; y: number; x: number } | null>(null);
  const [rendered, setRendered] = useState<{ body: string; result: RenderedMarkdown } | null>(null);
  const [failed, setFailed] = useState(false);
  const result = rendered?.body === body ? rendered.result : getRenderedMarkdown(body);
  useEffect(() => {
    if (result) return;
    let current = true;
    setFailed(false);
    renderMarkdown(body).then(result => {
      if (!current) return;
      // The readable fallback can already be in use when the local parser finishes loading.
      // Preserve its disclosure/scroll state across this one-time change of renderer.
      if (host.current) {
        const scroll: { element: HTMLElement; top: number; left: number }[] = [];
        let ancestor = host.current.parentElement;
        while (ancestor) {
          if (ancestor.scrollTop || ancestor.scrollLeft) scroll.push({ element: ancestor, top: ancestor.scrollTop, left: ancestor.scrollLeft });
          ancestor = ancestor.parentElement;
        }
        restore.current = { body, details: Array.from(host.current.querySelectorAll('details')).map(detail => detail.open),
          scroll, y: window.scrollY, x: window.scrollX };
      }
      setRendered({ body, result });
    })
      .catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [body, result]);
  useLayoutEffect(() => {
    const snapshot = restore.current;
    if (!snapshot || snapshot.body !== body || rendered?.body !== body) return;
    host.current?.querySelectorAll('details').forEach((detail, index) => {
      if (snapshot.details[index] !== undefined) detail.open = snapshot.details[index];
    });
    snapshot.scroll.forEach(({ element, top, left }) => { element.scrollTop = top; element.scrollLeft = left; });
    if (window.scrollX !== snapshot.x || window.scrollY !== snapshot.y) window.scrollTo({ left: snapshot.x, top: snapshot.y, behavior: 'instant' });
    restore.current = null;
  }, [rendered, body]);
  const content = useMemo(() => {
    if (!result) return null;
    return toJsxRuntime(scopeAnchors(result.tree, `md-${id}-`), {
      Fragment, jsx, jsxs, passNode: true,
      components: { ...components, pre: Code,
        span: ({ node, ...props }) => (props.className || '').split(' ').includes('language-math')
          ? <MathFormula source={textOf(node!)} block={false} /> : <span {...props} />,
        div: ({ node, ...props }) => {
          const language = String(props.className || '').split(' ').find(value => value.startsWith('language-'))?.slice(9);
          if (language === 'math') return <MathFormula source={textOf(node!)} block />;
          if (language === 'mermaid') return <MermaidDiagram source={textOf(node!)} />;
          if (language) return <ExpressiveCodeBlock code={textOf(node!)} language={language} />;
          return <div {...props} />;
        },
      },
    });
  }, [result, id]);
  return <div ref={host} className="markdown" data-testid="unit-body" data-markdown-engine={content ? 'vditor' : failed ? 'fallback' : 'loading'}>
    {content || <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]}
      components={components}>{body}</ReactMarkdown>}
  </div>;
}
