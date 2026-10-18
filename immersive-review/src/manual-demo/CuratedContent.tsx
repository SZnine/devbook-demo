import { Markdown } from '../Markdown';
import core from './research/core.json';
import applied from './research/applied.json';
import supplemental from './research/supplemental.json';

export type ResearchSource = { id: string; title: string; url: string; publisher: string; checkedAt: string; kind: string };
export type Addition = { id: string; kind: string; title: string; body: string; sourceIds: string[] };
export type SectionReview = { sectionId: string; decision: string; reason: string; sourceIds: string[]; additions: Addition[] };
export type ResearchFile = { sources: ResearchSource[]; reviews: SectionReview[] };

export const research: ResearchFile[] = [core, applied, supplemental];
const sources = new Map(research.flatMap(file => file.sources).map(source => [source.id, source]));
const additions = new Map(research.flatMap(file => file.reviews).map(review => [review.sectionId, review.additions]));

function Arrow() {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>;
}

function Sources({ ids, cards = false }: { ids: string[]; cards?: boolean }) {
  return <div className={cards ? 'md-source-cards not-content' : 'md-sources not-content'}>
    {ids.map(id => { const source = sources.get(id); if (!source) return null;
      return cards ? <div className="sl-link-card" key={id}>
        <span className="sl-flex stack"><a data-reference-link href={source.url} target="_blank" rel="noopener noreferrer"><span className="title">{source.title}</span></a>
          <span className="description">{source.publisher} · {source.kind === 'lab' ? '原始教程' : source.kind === 'paper' ? '研究原文' : '原始资料'}</span></span><Arrow />
      </div> : <a key={id} data-reference-link href={source.url} target="_blank" rel="noopener noreferrer">{source.title}<span aria-hidden="true"> ↗</span></a>;
    })}
  </div>;
}

/** Concrete content blocks for this manual, using Starlight's licensed markup and styles. */
export function CuratedContent({ sectionId }: { sectionId: string }) {
  const items = additions.get(sectionId);
  if (!items?.length) return null;
  return <div className="md-curated" data-section-research={sectionId}>
    {items.map(item => {
      if (item.kind === 'aside') return <aside key={item.id} className="starlight-aside starlight-aside--note" aria-label={item.title} data-addition-id={item.id}>
        <p className="starlight-aside__title" aria-hidden="true"><svg className="starlight-aside__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7v1" /></svg>{item.title}</p>
        <div className="starlight-aside__content"><Markdown body={item.body} /><Sources ids={item.sourceIds} /></div>
      </aside>;
      if (item.kind === 'diagram') return <figure key={item.id} className="md-research-diagram" data-addition-id={item.id}>
        <h3>{item.title}</h3><Markdown body={item.body} />
        <figcaption>据下列资料整理绘制</figcaption><Sources ids={item.sourceIds} />
      </figure>;
      return <details key={item.id} className={`md-research-detail md-research-${item.kind}`} data-addition-id={item.id}>
        <summary>{item.title}{item.kind === 'lab' && <span className="md-resource-type">实验</span>}</summary>
        <div className={item.kind === 'lab' || item.kind === 'steps' ? 'md-lab-steps' : undefined}><Markdown body={item.body} /></div>
        <Sources ids={item.sourceIds} cards />
      </details>;
    })}
  </div>;
}
