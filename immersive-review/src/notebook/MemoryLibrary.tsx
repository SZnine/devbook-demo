import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../manual-demo/icons';
import type { MemoryEntry, MemorySettingsValue } from '../memory/memory-store.mjs';
import type { Ref } from './store';
import type { ReadingMemoryProjection } from './memory-policy';
import { getAssistantConfig, type AssistantConfig } from './assistant-client';
import { assessMemoryPriority, type MemoryPriorityAssessment } from './memory-priority-client';
import './memory-library.css';

export type MemoryLibraryItem = {
  ref: Ref; title: string; excerpt: string; markdown: string; source: string;
  contentHash: string; entry: MemoryEntry; projection: ReadingMemoryProjection;
  scoringContext: { chapterTitle?: string; sectionTitle?: string; summary: string };
};
export type MemoryLibraryProps = {
  items: MemoryLibraryItem[]; now: number; query: string; busy: boolean; configVersion: number;
  settings: MemorySettingsValue;
  onSaveSettings: (settings: MemorySettingsValue) => Promise<void>;
  onOpen: (ref: Ref) => void;
  onRead: (ref: Ref) => Promise<void>;
  onUndo: (ref: Ref, eventId: string) => Promise<void>;
  onPriority: (ref: Ref, value: number | undefined) => Promise<void>;
  onAIResults: (results: MemoryPriorityAssessment[]) => Promise<void>;
  onSettings: () => void;
};

const keyOf = (item: MemoryLibraryItem) => `${item.ref.kind}:${item.ref.id}`;
const isStale = (item: MemoryLibraryItem) => Boolean(item.projection.aiPriority && item.projection.aiPriority.contentHash !== item.contentHash);
const dateLabel = (at: number) => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Shanghai' }).format(at);
const clockLabel = (at: number) => new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' }).format(at);
const numberLabel = (value: number) => value.toFixed(3);
const readPreference = (key: string) => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } };
const savePreference = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* Preferences are optional. */ } };

function Glyph({ name }: { name: 'spark' | 'close' | 'arrow' | 'undo' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'spark' ? <><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z" /><path d="M20 2v4m-2-2h4" /></>
      : name === 'close' ? <path d="m6 6 12 12M18 6 6 18" />
        : name === 'arrow' ? <path d="M5 12h14m-5-5 5 5-5 5" />
          : <path d="m8 5-4 4 4 4M4 9h9a6 6 0 0 1 0 12" />}
  </svg>;
}

function LibraryDialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = ref.current;
    if (element && !element.open) element.showModal();
    return () => { element?.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} className="ml-dialog" aria-label={title}
    onCancel={event => { event.preventDefault(); closeRef.current(); }}
    onKeyDown={event => event.stopPropagation()}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeRef.current();
    }}>
    <header className="ml-dialog-header"><h2>{title}</h2><button className="ml-icon-button" type="button" aria-label={`关闭${title}`} title="关闭 · Esc" onClick={close}><Glyph name="close" /></button></header>
    {children}
  </dialog>;
}

function HistoryDialog({ item, busy, close, onOpen, onRead, onUndo, onPriority }: {
  item: MemoryLibraryItem; busy: boolean; close: () => void;
  onOpen: () => void; onRead: () => Promise<void>;
  onUndo: (id: string) => Promise<void>; onPriority: (value: number | undefined) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [manual, setManual] = useState(item.projection.priority);
  const locked = busy || pending;
  const history = [...item.projection.history].sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
  useEffect(() => setManual(item.projection.priority), [item.projection.priority]);
  async function run(action: () => Promise<void>) {
    if (locked) return;
    setPending(true); setError('');
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试。'); }
    finally { setPending(false); }
  }
  const ai = item.projection.aiPriority;
  return <LibraryDialog title="学习记录" close={close}>
    <div className="ml-detail-heading"><h3>{item.title}</h3><button type="button" className="ml-text-button" onClick={onOpen}>打开内容<Glyph name="arrow" /></button></div>
    <details className="ml-detail-controls"><summary>系数与调整</summary>
      <dl className="ml-coefficients"><div><dt>原生评分</dt><dd>{numberLabel(item.projection.priority)}</dd></div><div><dt>遗忘因素</dt><dd>{numberLabel(item.projection.forgettingFactor)}</dd></div><div><dt>推荐系数</dt><dd>{numberLabel(item.projection.recommendation)}</dd></div></dl>
      <form className="ml-priority-form" onSubmit={event => { event.preventDefault(); void run(() => onPriority(manual)); }}><label htmlFor="ml-manual-priority">手动评分<output htmlFor="ml-manual-priority">{manual.toFixed(2)}</output></label><input id="ml-manual-priority" type="range" min="0" max="1" step="0.01" value={manual} disabled={locked} onChange={event => setManual(Number(event.target.value))} /><div><button type="submit" className="ml-secondary-button" disabled={locked}>保存评分</button>{item.entry.priority?.manual !== undefined && <button type="button" className="ml-text-button" disabled={locked} onClick={() => void run(() => onPriority(undefined))}>恢复自动评分</button>}</div></form>
      {ai && <div className="ml-priority-reason"><p>{ai.reason}</p><small>{ai.model} · {dateLabel(ai.scoredAt)}{isStale(item) ? ' · 内容已更新，旧评分不再采用' : ''}{item.entry.priority?.manual !== undefined ? ' · 手动设置优先' : ''}</small></div>}
    </details>
    <section className="ml-history-section" aria-label="全部学习活动"><div className="ml-section-heading"><h3>阅读记录</h3><button type="button" className="ml-text-button" disabled={locked} onClick={() => void run(onRead)}>补记</button></div>
      {history.length === 0 ? <p className="ml-history-empty">正常阅读后，记录会出现在这里。</p> : <ol className="ml-history-list">{history.map((event, index) => {
        const showDay = index === 0 || dateLabel(history[index - 1].at) !== dateLabel(event.at);
        const status = event.voidedAt ? '已撤销' : event.future ? '未来时间，未计入' : !event.currentVersion ? '旧版本' : event.effective ? '' : '同轮合并';
        return <li key={event.id} className={event.voidedAt ? 'is-voided' : undefined}>{showDay && <h4>{dateLabel(event.at)}</h4>}<div className="ml-history-event"><time dateTime={new Date(event.at).toISOString()}>{clockLabel(event.at)}</time><div><strong>{event.source === 'focus' ? '自动阅读' : event.source === 'legacy-manual' ? '原有学习记录' : '手动补记'}</strong>{status && <span>{status}</span>}{event.source === 'focus' && <small>有效停留 {Math.round((event.activeMs ?? 0) / 1000)} 秒</small>}</div>{!event.voidedAt && !event.future && <button type="button" className="ml-icon-button" disabled={locked} aria-label={`撤销 ${dateLabel(event.at)} ${clockLabel(event.at)} 的阅读记录`} title="撤销这条阅读记录" onClick={() => void run(() => onUndo(event.id))}><Glyph name="undo" /></button>}</div></li>;
      })}</ol>}
    </section>
    {error && <p role="alert" className="ml-error ml-detail-error">{error}</p>}
  </LibraryDialog>;
}

function ConfigurationDialog({ items, settings, configVersion, close, onSaveSettings, onSettings, onResults }: {
  items: MemoryLibraryItem[]; settings: MemorySettingsValue; configVersion: number; close: () => void;
  onSaveSettings: (settings: MemorySettingsValue) => Promise<void>; onSettings: () => void;
  onResults: (results: MemoryPriorityAssessment[]) => Promise<void>;
}) {
  const [retentionScale, setRetentionScale] = useState(settings.retentionScale);
  const [forgettingExponent, setForgettingExponent] = useState(settings.forgettingExponent ?? 1);
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [modelKey, setModelKey] = useState(() => readPreference('read-assistant-model-v1'));
  const [goal, setGoal] = useState(() => readPreference('read-memory-priority-goal-v1'));
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const controllerRef = useRef<AbortController | null>(null);
  const recent = useMemo(() => [...items].filter(item => item.projection.lastReadAt !== null).sort((a, b) => (b.projection.lastReadAt ?? 0) - (a.projection.lastReadAt ?? 0) || keyOf(a).localeCompare(keyOf(b))).slice(0, 20), [items]);
  const contextCharacters = recent.reduce((sum, item) => sum + item.title.length + (item.scoringContext.chapterTitle?.length ?? 0) + (item.scoringContext.sectionTitle?.length ?? 0) + item.scoringContext.summary.length, 0);
  const oversized = contextCharacters > 16_000 || recent.some(item => item.title.length > 200 || (item.scoringContext.chapterTitle?.length ?? 0) > 160 || (item.scoringContext.sectionTitle?.length ?? 0) > 160 || item.scoringContext.summary.length > 600);
  const models = (config?.providers ?? []).filter(provider => provider.configured).flatMap(provider => provider.models.map(model => ({ key: `${provider.id}:${model}`, provider, model })));
  const currentModel = models.find(model => model.key === modelKey);
  const locked = running || saving;
  const settingsChanged = retentionScale !== settings.retentionScale || forgettingExponent !== (settings.forgettingExponent ?? 1);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    getAssistantConfig(controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setConfig(value);
      const available = value.providers.filter(provider => provider.configured && provider.models.length);
      setModelKey(current => available.some(provider => provider.models.some(model => `${provider.id}:${model}` === current)) ? current : available[0] ? `${available[0].id}:${available[0].models[0]}` : '');
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法读取 AI 设置。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [configVersion, attempt]);
  useEffect(() => () => controllerRef.current?.abort(), []);
  const closeDialog = () => { if (saving) return; controllerRef.current?.abort(); close(); };
  async function saveSettings() {
    if (locked || !settingsChanged) return;
    setSaving(true); setError(''); setStatus('');
    try { await onSaveSettings({ ...settings, retentionScale, forgettingExponent }); setStatus('系数已保存'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '配置保存失败，请重试。'); }
    finally { setSaving(false); }
  }
  async function assess() {
    if (!currentModel || !recent.length || locked || oversized) return;
    const controller = new AbortController(); controllerRef.current = controller;
    setRunning(true); setError(''); setStatus('');
    savePreference('read-memory-priority-goal-v1', goal.trim());
    savePreference('read-assistant-model-v1', modelKey);
    try {
      const result = await assessMemoryPriority({ providerId: currentModel.provider.id, model: currentModel.model, goal: goal.trim(), items: recent.map(item => ({ id: keyOf(item), contentHash: item.contentHash, title: item.title, ...item.scoringContext })) }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setSaving(true);
      await onResults(result.items);
      setStatus(`已更新 ${result.items.length} 项原生评分`);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '评分失败，请重试。');
    } finally {
      if (controllerRef.current === controller) { setRunning(false); setSaving(false); controllerRef.current = null; }
    }
  }
  return <LibraryDialog title="记忆库配置" close={closeDialog}>
    <section className="ml-config-section"><h3>系数</h3>
      <label className="ml-range-label" htmlFor="ml-retention-scale">保持时长<output htmlFor="ml-retention-scale">{retentionScale.toFixed(2)} ×</output></label><input id="ml-retention-scale" aria-describedby="ml-retention-hint" type="range" min="0.25" max="4" step="0.05" value={retentionScale} disabled={locked} onChange={event => { setRetentionScale(Number(event.target.value)); setStatus(''); }} /><p className="ml-hint" id="ml-retention-hint">越大，阅读后的新鲜度保持越久。</p>
      <label className="ml-range-label" htmlFor="ml-forgetting-exponent">遗忘权重<output htmlFor="ml-forgetting-exponent">{forgettingExponent.toFixed(2)}</output></label><input id="ml-forgetting-exponent" aria-describedby="ml-forgetting-hint" type="range" min="0.5" max="2" step="0.05" value={forgettingExponent} disabled={locked} onChange={event => { setForgettingExponent(Number(event.target.value)); setStatus(''); }} /><p className="ml-hint" id="ml-forgetting-hint">越大，越侧重已经渐远的内容。</p>
      <details className="ml-formula"><summary>系数计算</summary><p>推荐系数 = 原生评分 × (1 − 新鲜度)<sup>遗忘权重</sup></p><p>绿条使用固定的 0–1 刻度。新鲜度依据阅读接触估计，不是记忆测验结果。</p></details>
      <div className="ml-config-actions"><button type="button" className="ml-secondary-button" disabled={locked || !settingsChanged} onClick={() => void saveSettings()}>{saving && !running ? '正在保存…' : '保存系数'}</button></div>
    </section>
    <section className="ml-config-section ml-ai-config"><h3>AI 原生评分</h3>
      {loading ? <p className="ml-hint" role="status">正在读取已配置的模型…</p> : !config ? <button type="button" className="ml-secondary-button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>重新读取模型</button> : !models.length ? <button type="button" className="ml-secondary-button" onClick={() => { close(); onSettings(); }}>配置 AI 模型</button> : <>
        <label className="ml-field">模型<select aria-label="评分模型" value={modelKey} disabled={locked} onChange={event => setModelKey(event.target.value)}>{config.providers.filter(provider => provider.configured && provider.models.length).map(provider => <optgroup key={provider.id} label={provider.name}>{provider.models.map(model => <option value={`${provider.id}:${model}`} key={model}>{model}</option>)}</optgroup>)}</select></label>
        <label className="ml-field">关注方向<input value={goal} maxLength={2000} placeholder="可选，例如：构建能交付的 Agent 应用" disabled={locked} onChange={event => setGoal(event.target.value)} /></label>
        <p className="ml-hint">比较最近浏览的 {recent.length} 项，发送标题、所属章与节、简短正文摘要和关注方向。</p>
        <details className="ml-formula"><summary>比较范围与评分方式</summary><p>对最近浏览的最多 20 项进行相对排序，再映射到 0.15–1.00 的分散系数。单项为 0.50；手动评分始终优先。</p><ol className="ml-comparison-titles">{recent.map(item => <li key={keyOf(item)}>{item.title}</li>)}</ol></details>
        {oversized && <p className="ml-error" role="alert">评分上下文超过长度限制，请精简标题或摘要后重试；不会自动截断发送。</p>}
        <div className="ml-config-actions">{running && <button type="button" className="ml-text-button" disabled={saving} onClick={() => { controllerRef.current?.abort(); setStatus('已取消评分'); }}>取消评分</button>}<button type="button" className="ml-primary-button" disabled={locked || !currentModel || !recent.length || oversized} onClick={() => void assess()}><Glyph name="spark" />{saving && running ? '正在保存…' : running ? '正在比较…' : '更新最近浏览评分'}</button></div>
      </>}
    </section>
    {(error || status) && <div className="ml-config-feedback">{error && <p role="alert" className="ml-error">{error}</p>}{status && <p role="status" className="ml-hint">{status}</p>}</div>}
  </LibraryDialog>;
}

export function MemoryLibrary(props: MemoryLibraryProps) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showConfiguration, setShowConfiguration] = useState(false);
  const visible = useMemo(() => {
    const needle = props.query.trim().toLocaleLowerCase();
    return props.items.filter(item => !needle || `${item.title} ${item.excerpt} ${item.source}`.toLocaleLowerCase().includes(needle)).sort((a, b) => b.projection.recommendation - a.projection.recommendation || (b.projection.lastReadAt ?? 0) - (a.projection.lastReadAt ?? 0) || keyOf(a).localeCompare(keyOf(b)));
  }, [props.items, props.query]);
  const detail = props.items.find(item => keyOf(item) === detailId);
  return <div className="ml-library">
    <div className="ml-list-heading"><span>推荐系数</span><button type="button" className="ml-icon-button" aria-label="记忆库配置" title="记忆库配置" onClick={() => setShowConfiguration(true)}><Icon name="settings" /></button></div>
    {!visible.length ? <div className="ml-empty"><p>{props.items.length ? '没有匹配的内容' : '阅读过的内容会自动出现在这里'}</p></div> : <div className="ml-list" aria-label="按推荐系数排列的阅读内容">{visible.map(item => {
      const breakdown = `原生评分 ${numberLabel(item.projection.priority)} × 遗忘因素 ${numberLabel(item.projection.forgettingFactor)} = 推荐系数 ${numberLabel(item.projection.recommendation)}`;
      return <article key={keyOf(item)} className="ml-item"><button type="button" className="ml-item-title" onClick={() => props.onOpen(item.ref)}>{item.title}</button><div className="ml-recommendation-track" role="meter" tabIndex={0} aria-label={`${item.title}的推荐系数`} aria-valuemin={0} aria-valuemax={1} aria-valuenow={item.projection.recommendation} aria-valuetext={breakdown} title={breakdown}><span style={{ width: `${item.projection.recommendation * 100}%` }} /></div><button type="button" className="ml-icon-button ml-history-button" title="学习记录" aria-label={`查看 ${item.title} 的学习记录`} onClick={() => setDetailId(keyOf(item))}><Icon name="history" /></button></article>;
    })}</div>}
    {detail && <HistoryDialog key={detailId} item={detail} busy={props.busy} close={() => setDetailId(null)} onOpen={() => { setDetailId(null); props.onOpen(detail.ref); }} onRead={() => props.onRead(detail.ref)} onUndo={id => props.onUndo(detail.ref, id)} onPriority={value => props.onPriority(detail.ref, value)} />}
    {showConfiguration && <ConfigurationDialog items={props.items} settings={props.settings} configVersion={props.configVersion} close={() => setShowConfiguration(false)} onSaveSettings={props.onSaveSettings} onSettings={props.onSettings} onResults={props.onAIResults} />}
  </div>;
}
