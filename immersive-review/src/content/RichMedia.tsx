import { t } from '../i18n';
import { useEffect, useId, useState } from 'react';
import DOMPurify from 'dompurify';
import { ExpressiveCodeBlock } from './ExpressiveCode';
import 'katex/dist/katex.min.css';

export function MathFormula({ source, block }: { source: string; block: boolean }) {
  const [rendered, setRendered] = useState({ source: '', html: '' });
  useEffect(() => {
    let current = true;
    import('katex').then(({ default: katex }) => {
      const value = katex.renderToString(source, { displayMode: block, throwOnError: false, trust: false,
        output: 'htmlAndMathml', strict: 'ignore', maxExpand: 500, maxSize: 20 });
      if (current) setRendered({ source, html: value });
    }).catch(() => {});
    return () => { current = false; };
  }, [source, block]);
  const Tag = block ? 'div' : 'span';
  return <Tag className={`math-formula ${block ? 'math-block' : 'math-inline'}`} data-math-source={source}>
    {rendered.source === source && rendered.html ? <span dangerouslySetInnerHTML={{ __html: rendered.html }} /> : source}
  </Tag>;
}

let mermaidEngine: Promise<typeof import('mermaid')['default']> | undefined;
function loadMermaid() {
  mermaidEngine ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark', htmlLabels: false,
      suppressErrorRendering: true, flowchart: { htmlLabels: false },
      themeVariables: { fontFamily: 'system-ui, sans-serif', primaryColor: '#293445', primaryTextColor: '#dedfe3',
        primaryBorderColor: '#6d86ad', lineColor: '#94a3b8', mainBkg: '#293445', nodeBorder: '#6d86ad' } });
    return mermaid;
  }).catch(error => { mermaidEngine = undefined; throw error; });
  return mermaidEngine;
}

export function MermaidDiagram({ source }: { source: string }) {
  const id = 'diagram-' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const [result, setResult] = useState({ source: '', svg: '', error: false });
  const [showSource, setShowSource] = useState(false);
  useEffect(() => {
    let current = true;
    loadMermaid().then(async mermaid => {
      const { svg } = await mermaid.render(id, source);
      const safe = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['foreignObject'], FORBID_ATTR: ['onload','onclick'] });
      if (current) setResult({ source, svg: safe, error: false });
    }).catch(() => { if (current) setResult({ source, svg: '', error: true }); });
    return () => { current = false; };
  }, [source, id]);
  const ready = result.source === source && !!result.svg;
  return <figure className="document-diagram" data-diagram-status={ready ? 'ready' : result.error ? 'fallback' : 'loading'}>
    {ready && <>
      <div className="diagram-surface" role="img" aria-label={t("文档图示", "Diagram")} dangerouslySetInnerHTML={{ __html: result.svg }} />
      <button type="button" className="diagram-source-toggle" data-content-control aria-pressed={showSource}
        onClick={() => setShowSource(!showSource)}>{showSource ? t("收起源码", "Hide source") : t("源码", "Source")}</button>
    </>}
    {(!ready || showSource) && <ExpressiveCodeBlock code={source} language="mermaid" />}
    {result.error && <figcaption>{t("图示无法解析，已保留源码。", "Could not render diagram. Source shown below.")}</figcaption>}
  </figure>;
}
