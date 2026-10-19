import { t, dateLocale } from '../i18n';
import { useEffect, useRef, useState, type RefObject } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getAssistantConfig, streamAssistantReply, type AssistantConfig } from './assistant-client';
import { demoAiNotice, IS_DEMO_MODE } from '../demo';
import { buildAssistantContext, type AssistantContextLevel, type AssistantContextSelection } from './assistant-context';
import { assistantRequestContent, assistantRequestMessages, clampAssistantWidth, conversationTitle, loadAssistantHistory, newAssistantConversation, RESPONSE_STYLES, saveAssistantHistory,
  type AssistantAttachment as Attachment, type AssistantTurn as Turn, type AssistantConversation, type AssistantResponseStyle } from './assistant-history';
import './assistant-panel.css';

type AssistantPanelProps = {
  open: boolean; onClose: () => void; onSettings: () => void; configVersion: number;
  contextTitle: string; contextKey: string; contextText: string; contentRoot: RefObject<HTMLElement | null>;
  contextSelection?: AssistantContextSelection | null;
  onWidthChange?: (width: number) => void;
};
const MODEL_KEY = 'read-assistant-model-v1';
const WIDTH_KEY = 'read-assistant-width-v1';
const STYLE_KEY = 'read-assistant-style-v1';
const CONTEXT_LEVELS: { id: AssistantContextLevel; label: string; short: string; detail: string }[] = [
  { id: 'selection', get label() { return t("仅选中文本", "Selected text"); }, get short() { return t("选区", "Selection"); }, get detail() { return t("只附带你选中的内容", "Only the text you selected"); } },
  { id: 'section', get label() { return t("小节标题与全文", "Full section"); }, get short() { return t("完整小节", "Section"); }, get detail() { return t("包含所属小标题和完整正文", "Section heading and body"); } },
  { id: 'chapter', get label() { return t("小节全文与章节结构", "Section and outline"); }, get short() { return t("小节与结构", "Outline"); }, get detail() { return t("再附带章标题、小节目录和书籍名", "Also include the chapter outline and book title"); } },
];
const STYLE_DETAILS = { get concise() { return t("几句话，直接给结论", "A short, direct answer"); }, get essence() { return t("先说核心机制，再解释因果", "The core idea and why it works"); }, get normal() { return t("适度说明，提供必要示例", "Explanation with useful examples"); }, get detailed() { return t("展开背景、步骤和适用边界", "Background, steps and trade-offs"); } };
function Chevron() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 6 3 3 3-3" /></svg>; }
function Check() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8 3 3 6-6" /></svg>; }
function Sparkle() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z" /><path d="m20 2 .7 1.3L22 4l-1.3.7L20 6l-.7-1.3L18 4l1.3-.7L20 2Z" /></svg>;
}
export function AssistantSettingsIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m9 3-.6 2.2-2 .9-2-.7-2 3.4 1.5 1.6v2.3L2.4 14l2 3.4 2-.7 2 .9L9 20h4l.7-2.4 2-.9 2 .7 2-3.4-1.5-1.6v-2.3L19.7 8l-2-3.4-2 .7-2-.9L13 3Z" /><circle cx="11" cy="11.5" r="3" /></svg>;
}
function PageSymbol() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h7l3 3v12H5Z" /><path d="M11.5 2.5V6H15M7.5 9h5m-5 3h5" /></svg>;
}
export function AssistantPanel({ open, onClose, onSettings, configVersion, contextTitle, contextKey, contextText, contextSelection, onWidthChange }: AssistantPanelProps) {
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [reload, setReload] = useState(0);
  const [choice, setChoice] = useState(() => { try { return localStorage.getItem(MODEL_KEY) ?? ''; } catch { return ''; } });
  const [initialHistory] = useState(() => {
    try { return loadAssistantHistory(localStorage, sessionStorage); }
    catch { return loadAssistantHistory({ getItem: () => { throw new Error('Storage unavailable'); } }); }
  });
  const [history, setHistory] = useState(initialHistory.history);
  const historyRef = useRef(history); historyRef.current = history;
  const [storageError, setStorageError] = useState(initialHistory.error);
  const [historyOpen, setHistoryOpen] = useState(false);
  const conversation = history.conversations.find(item => item.id === history.activeId)!;
  const turns = conversation.turns;
  const draft = conversation.draft;
  const attachment = conversation.attachment;
  const [sending, setSending] = useState(false);
  const [includeSelection, setIncludeSelection] = useState(false);
  const [contextLevel, setContextLevel] = useState<AssistantContextLevel>('selection');
  const [style, setStyle] = useState<AssistantResponseStyle>(() => {
    try { const saved = localStorage.getItem(STYLE_KEY); return RESPONSE_STYLES.some(item => item.id === saved) ? saved as AssistantResponseStyle : 'normal'; } catch { return 'normal'; }
  });
  const [width, setWidth] = useState(() => {
    try { return clampAssistantWidth(Number(localStorage.getItem(WIDTH_KEY)) || 400, window.innerWidth); } catch { return 400; }
  });
  const [resizing, setResizing] = useState(false);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState('');
  const [composerMenu, setComposerMenu] = useState<'context' | 'style' | 'attachment' | null>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const activeRequest = useRef<AbortController | null>(null);
  const dragStart = useRef<{ x: number; width: number } | null>(null);
  const widthCallback = useRef(onWidthChange); widthCallback.current = onWidthChange;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const options = config?.providers.flatMap(provider => provider.models.map(model => ({ provider, model, value: `${provider.id}:${model}` }))) ?? [];
  const selected = options.find(option => option.value === choice);
  const activeStyle = RESPONSE_STYLES.find(item => item.id === style)!;
  const activeContextLevel = CONTEXT_LEVELS.find(item => item.id === contextLevel)!;
  const toggleMenu = (next: NonNullable<typeof composerMenu>, trigger: HTMLButtonElement) => {
    menuTriggerRef.current = trigger;
    setComposerMenu(current => current === next ? null : next);
  };
  const closeMenu = () => { setComposerMenu(null); menuTriggerRef.current?.focus({ preventScroll: true }); };
  const updateConversation = (patch: Partial<AssistantConversation> | ((current: AssistantConversation) => Partial<AssistantConversation>), id = history.activeId) => {
    setHistory(current => ({ ...current, conversations: current.conversations.map(item => item.id === id
      ? { ...item, ...(typeof patch === 'function' ? patch(item) : patch) } : item) }));
  };
  const setDraft = (text: string) => updateConversation({ draft: text, updatedAt: Date.now() });
  const setAttachment = (source: Attachment | null) => updateConversation({ attachment: source ?? undefined });
  const selectConversation = (id: string) => {
    if (sending) return;
    setHistory(current => ({ ...current, activeId: id }));
    setHistoryOpen(false); setComposerMenu(null); setNotice(''); setCopied(''); setIncludeSelection(false); stickToBottom.current = true;
    inputRef.current?.focus();
  };
  const startConversation = () => {
    if (sending) return;
    if (!turns.length && !draft.trim() && !attachment) { setHistoryOpen(false); inputRef.current?.focus(); return; }
    const fresh = newAssistantConversation();
    setHistory(current => ({ ...current, activeId: fresh.id, conversations: [fresh, ...current.conversations] }));
    setHistoryOpen(false); setComposerMenu(null); setIncludeSelection(false); setNotice(''); setCopied(''); stickToBottom.current = true;
    inputRef.current?.focus();
  };

  useEffect(() => {
    if (!open) { activeRequest.current?.abort(); dragStart.current = null; setResizing(false); setComposerMenu(null); return; }
    const controller = new AbortController();
    setConfigError('');
    void getAssistantConfig(controller.signal).then(next => {
      setConfig(next);
      setChoice(current => next.providers.some(provider => provider.configured && provider.models.some(model => `${provider.id}:${model}` === current))
        ? current : next.providers.flatMap(provider => provider.configured ? provider.models.map(model => `${provider.id}:${model}`) : [])[0] ?? '');
    }).catch(error => { if (!controller.signal.aborted) setConfigError(error instanceof Error ? error.message : t("无法读取 API 设置", "Could not load provider settings")); });
    if (!document.querySelector('dialog[open]')) inputRef.current?.focus({ preventScroll: true });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        if (document.querySelector('.na-composer-popover,.na-history')) { setComposerMenu(null); setHistoryOpen(false); return; }
        closeRef.current();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => { controller.abort(); document.removeEventListener('keydown', handleKey); };
  }, [open, configVersion, reload]);
  useEffect(() => () => { activeRequest.current?.abort(); }, []);
  useEffect(() => {
    if (!composerMenu) return;
    const outside = (event: PointerEvent) => { if (!composerRef.current?.contains(event.target as Node)) setComposerMenu(null); };
    document.addEventListener('pointerdown', outside);
    (menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menuRef.current?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
    return () => document.removeEventListener('pointerdown', outside);
  }, [composerMenu]);
  useEffect(() => {
    if (!historyOpen) return;
    const outside = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest('.na-history,[aria-controls="assistant-history"]')) setHistoryOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [historyOpen]);
  useEffect(() => { setComposerMenu(null); }, [contextKey, historyOpen]);
  useEffect(() => { if (composerMenu === 'attachment' && !attachment) setComposerMenu(null); }, [attachment, composerMenu]);
  useEffect(() => {
    const input = inputRef.current;
    if (!input || !open) return;
    input.style.height = 'auto'; input.style.height = `${Math.min(180, Math.max(76, input.scrollHeight))}px`;
  }, [draft, open, width]);
  useEffect(() => { try { localStorage.setItem(MODEL_KEY, choice); } catch { /* Keep in-memory selection. */ } }, [choice]);
  useEffect(() => {
    // Keep all local history; no API credentials are included.
    if (initialHistory.error || sending) return;
    const timer = window.setTimeout(() => setStorageError(saveAssistantHistory(localStorage, history)), 0);
    return () => window.clearTimeout(timer);
  }, [history, sending, initialHistory.error]);
  useEffect(() => {
    if (!sending || initialHistory.error) return;
    const persist = () => setStorageError(saveAssistantHistory(localStorage, historyRef.current));
    persist();
    // Throttle rather than debounce so an uninterrupted stream is still recoverable.
    const timer = window.setInterval(persist, 1000);
    return () => window.clearInterval(timer);
  }, [sending, initialHistory.error]);
  useEffect(() => {
    if (stickToBottom.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns, sending, history.activeId, historyOpen]);
  useEffect(() => { if (includeSelection) setAttachment(null); setIncludeSelection(false); }, [contextKey]);
  useEffect(() => {
    if (includeSelection) setAttachment(contextSelection ? { title: contextSelection.title, content: buildAssistantContext(contextSelection, contextLevel) } : null);
    // Snapshot changes intentionally replace only the explicitly attached selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextSelection, contextLevel, includeSelection]);
  useEffect(() => { try { localStorage.setItem(STYLE_KEY, style); } catch { /* Current choice remains usable. */ } }, [style]);
  useEffect(() => {
    widthCallback.current?.(width);
    try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* The pane still resizes in memory. */ }
  }, [width]);
  useEffect(() => {
    const fit = () => setWidth(current => clampAssistantWidth(current, window.innerWidth));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  useEffect(() => {
    if (!resizing) return;
    const previousCursor = document.body.style.cursor, previousSelection = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    return () => { document.body.style.cursor = previousCursor; document.body.style.userSelect = previousSelection; };
  }, [resizing]);

  async function send(question = draft, retry?: Turn) {
    const text = question.trim();
    if (!text || activeRequest.current) return;
    if (!selected?.provider.configured) { onSettings(); return; }
    const source = retry ? retry.attachment : attachment ?? undefined;
    if (source && source.content.length > 80_000) { setNotice(t("引用内容超过 8 万字，请选择较小的片段。", "Reference exceeds 80,000 characters. Select a smaller passage.")); return; }
    const requestContent = retry?.requestContent ?? assistantRequestContent(text, style, source);
    if (requestContent.length > 100_000) { setNotice(t("本次问题与引用过长，请缩小引用范围。", "Message is too long. Shorten the reference.")); return; }
    const previousTurns = retry ? turns.slice(0, turns.findIndex(item => item.id === retry.id)) : turns;
    const { messages, omitted } = assistantRequestMessages(previousTurns, requestContent);
    const turn: Turn = { id: retry?.id ?? crypto.randomUUID(), question: text, requestContent, answer: '',
      providerId: selected.provider.id, model: selected.model, status: 'streaming', attachment: source };
    const controller = new AbortController();
    activeRequest.current = controller;
    stickToBottom.current = true;
    const conversationId = history.activeId;
    setSending(true); setHistoryOpen(false); setComposerMenu(null);
    setNotice(omitted ? t(`本次携带最近 ${messages.length / 2 - .5} 轮对话，更早的记录仍保留在历史中。`, `Using the latest ${messages.length / 2 - .5} exchanges. Earlier messages remain in history.`) : '');
    updateConversation({ turns: [...previousTurns, turn], updatedAt: Date.now(), title: conversationTitle(previousTurns[0]?.question ?? text),
      ...(!retry ? { draft: '', attachment: undefined } : {}) }, conversationId);
    if (!retry) setIncludeSelection(false);
    const update = (patch: Partial<Turn>) => updateConversation(current => ({ turns: current.turns.map(item => item.id === turn.id ? { ...item, ...patch } : item) }), conversationId);
    try {
      await streamAssistantReply({ providerId: selected.provider.id, model: selected.model, messages }, {
        signal: controller.signal,
        onDelta: delta => updateConversation(current => ({ turns: current.turns.map(item => item.id === turn.id ? { ...item, answer: item.answer + delta } : item) }), conversationId),
      });
      update({ status: controller.signal.aborted ? 'stopped' : 'complete' });
    } catch (error) {
      update(controller.signal.aborted ? { status: 'stopped' } : { status: 'error', error: error instanceof Error ? error.message : t("请求失败，请重试。", "Request failed. Try again.") });
    } finally {
      if (activeRequest.current === controller) { activeRequest.current = null; setSending(false); }
    }
  }
  async function copyAnswer(turn: Turn) {
    try { await navigator.clipboard.writeText(turn.answer); setCopied(turn.id); }
    catch { setNotice(t("复制失败，请选中回答后复制。", "Could not copy. Select the answer to copy it.")); }
  }
  if (!open) return null;
  return <aside className={`na-panel${resizing ? ' is-resizing' : ''}`} style={{ width }} aria-label={t("智能助手", "Assistant")} id="notebook-assistant" onPointerDownCapture={event => {
    if (historyOpen && !(event.target as HTMLElement).closest('.na-history,[aria-controls="assistant-history"]')) setHistoryOpen(false);
  }} onKeyDown={event => {
    if (event.key === 'Escape' && historyOpen) { event.preventDefault(); event.stopPropagation(); setHistoryOpen(false); event.currentTarget.querySelector<HTMLButtonElement>('[aria-controls="assistant-history"]')?.focus(); }
  }}>
    <div className="na-resize-handle" role="separator" tabIndex={0} aria-label={t("智能助手宽度", "Assistant width")} aria-orientation="vertical" aria-controls="notebook-assistant"
      aria-valuemin={320} aria-valuemax={clampAssistantWidth(720, window.innerWidth)} aria-valuenow={width} aria-valuetext={t(`${width} 像素`, `${width} pixels`)}
      title={t("拖动调整宽度 · 方向键微调", "Drag to resize · Arrow keys to adjust")}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); dragStart.current = { x: event.clientX, width }; setResizing(true); }}
      onPointerMove={event => { if (dragStart.current) setWidth(clampAssistantWidth(dragStart.current.width + dragStart.current.x - event.clientX, window.innerWidth)); }}
      onPointerUp={event => { dragStart.current = null; setResizing(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { dragStart.current = null; setResizing(false); }} onLostPointerCapture={() => { dragStart.current = null; setResizing(false); }}
      onKeyDown={event => {
        const next = event.key === 'ArrowLeft' ? width + (event.shiftKey ? 48 : 16) : event.key === 'ArrowRight' ? width - (event.shiftKey ? 48 : 16) : event.key === 'Home' ? 320 : event.key === 'End' ? 720 : null;
        if (next !== null) { event.preventDefault(); setWidth(clampAssistantWidth(next, window.innerWidth)); }
        else if (event.key === 'Enter') { event.preventDefault(); onClose(); }
      }} />
    <header className="na-header">
      <div><span className="na-mark"><Sparkle /></span><strong title={turns.length ? conversation.title : contextTitle}>{turns.length ? conversation.title : t("智能助手", "Assistant")}</strong></div>
      <div className="na-header-actions">
        <button type="button" className="na-icon-button" aria-label={t("历史对话", "Chat history")} title={t("历史对话", "Chat history")} aria-expanded={historyOpen} aria-controls="assistant-history" onClick={() => setHistoryOpen(current => !current)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8a7 7 0 1 1 1.7 6.6M3 3v5h5M10 6v4l3 2" /></svg></button>
        <button type="button" className="na-icon-button" aria-label={t("新建对话", "New chat")} title={t("新建对话", "New chat")} disabled={sending} onClick={startConversation}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg></button>
        <button type="button" className="na-icon-button" aria-label={t("AI 服务设置", "Provider settings")} title={t("AI 服务设置", "Provider settings")} disabled={sending} onClick={onSettings}><AssistantSettingsIcon /></button>
        <button type="button" className="na-icon-button" aria-label={t("关闭智能助手", "Close assistant")} title={sending ? t("关闭并停止生成", "Close and stop response") : t("关闭智能助手 · Esc", "Close assistant · Esc")} onClick={onClose}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button>
      </div>
    </header>
    {historyOpen && <section className="na-history" id="assistant-history" aria-label={t("历史对话", "Chat history")}><div className="na-history-heading"><strong>{t("历史对话", "Chat history")}</strong><span>{t("保存在此浏览器", "On this browser")}</span></div>
      <div className="na-history-list">{[...history.conversations].sort((a, b) => b.updatedAt - a.updatedAt).filter(item => item.turns.length || item.draft.trim() || item.id === history.activeId).map(item => <button key={item.id} type="button" className="na-history-item" aria-current={item.id === history.activeId ? 'true' : undefined} disabled={sending} onClick={() => selectConversation(item.id)}>
        <span>{item.turns.length ? item.title : item.draft.trim() ? conversationTitle(item.draft) : t("新对话", "New chat")}</span><small>{item.turns.length ? t(`${item.turns.length} 轮`, `${item.turns.length} exchanges`) : t("草稿", "Draft")} · {new Date(item.updatedAt).toLocaleDateString(dateLocale(), { month: 'numeric', day: 'numeric' })}</small>
      </button>)}</div></section>}
    <div className="na-conversation" ref={scrollRef} onScroll={event => { const root = event.currentTarget; stickToBottom.current = root.scrollHeight - root.scrollTop - root.clientHeight < 60; }}>
      {configError && <div className="na-error" role="alert">{configError}<button type="button" onClick={() => setReload(value => value + 1)}>{t("重新连接", "Reconnect")}</button></div>}
      {!turns.length ? <div className="na-welcome">
        <div className="na-welcome-mark"><Sparkle /></div><h2>{t("一起，把想法展开。", "What are you working on?")}</h2>
        <p>{IS_DEMO_MODE ? demoAiNotice() : config ? selected?.provider.configured ? t("提一个问题，或引用内容一起聊。", "Ask a question or attach a passage.") : t("连接你常用的模型，开始对话。", "Connect a provider to start a conversation.") : configError ? t("暂时无法连接本机服务。", "Cannot connect to the local server.") : t("正在读取 API 设置…", "Loading providers…")}</p>
        {IS_DEMO_MODE ? null : config && !selected?.provider.configured ? <button className="na-connect" type="button" onClick={onSettings}>{t("配置 API Key", "Connect a provider")}<span>↗</span></button> : <div className="na-suggestions">
          <button type="button" onClick={() => { setDraft(t("请解释这段内容的核心概念，并给出一个简单例子。", "Explain the key idea in this passage, with a simple example.")); if (contextSelection) setIncludeSelection(true); inputRef.current?.focus(); }}><PageSymbol /><span>{t("解释一段内容", "Explain a passage")}</span><span className="na-suggestion-arrow">↗</span></button>
          <button type="button" onClick={() => { setDraft(t("我想和你讨论一个问题：", "I'd like to discuss:")); inputRef.current?.focus(); }}><Sparkle /><span>{t("展开一个想法", "Explore an idea")}</span><span className="na-suggestion-arrow">↗</span></button>
        </div>}
      </div> : <div className="na-messages" role="log" aria-label={t("对话记录", "Conversation")}>
        {turns.map((turn, index) => <div className="na-exchange" key={turn.id}>
          {turn.attachment && <details className="na-sent-context"><summary><PageSymbol />{turn.attachment.title}</summary><pre>{turn.attachment.content}</pre></details>}
          <p className="na-question">{turn.question}</p>
          <div className="na-response"><div className="na-response-label"><Sparkle /><span>{turn.model}</span></div>
            {turn.answer ? <div className="na-answer"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: props => <a {...props} target="_blank" rel="noopener noreferrer" />, img: ({ alt }) => <span>{t("[图片：", "[Image:")}{alt || t("未加载", "not loaded")}]</span> }}>{turn.answer}</ReactMarkdown></div>
              : turn.status === 'streaming' ? <div className="na-waiting" role="status"><span /><span /><span /><small>{t("等待回答", "Waiting for a response")}</small></div> : null}
            {turn.status === 'error' && <p className="na-error" role="alert">{turn.error}</p>}
            <div className="na-answer-actions">
              {turn.status === 'stopped' && <span>{t("已停止", "Stopped")}</span>}
              {turn.answer && <button type="button" onClick={() => void copyAnswer(turn)}>{copied === turn.id ? t("已复制", "Copied") : t("复制", "Copy")}</button>}
              {!sending && index === turns.length - 1 && (turn.status === 'error' || turn.status === 'stopped') && <button type="button" onClick={() => void send(turn.question, turn)}>{t("重新生成", "Retry")}</button>}
            </div>
          </div>
        </div>)}
      </div>}
    </div>
    <footer className="na-footer">
      {storageError && <p className="na-error" role="alert">{storageError}</p>}
      {notice && <p className="na-error" role="alert">{notice}</p>}
      <form ref={composerRef} className="na-composer" onSubmit={event => { event.preventDefault(); void send(); }} onKeyDown={event => {
        if (event.key === 'Escape' && composerMenu) { event.preventDefault(); event.stopPropagation(); closeMenu(); }
      }} onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setComposerMenu(null); }}>
        {(contextSelection || attachment || contextText) && <div className={`na-context-strip${attachment ? ' has-attachment' : ''}`}>
          {contextSelection ? <><label className="na-selection-chip" title={includeSelection ? contextSelection.title : contextSelection.selectedMarkdown}>
            <input type="checkbox" aria-label={t("附带选中文本", "Attach selected text")} checked={includeSelection} onChange={event => { setIncludeSelection(event.target.checked); if (!event.target.checked) setAttachment(null); }} />
            <span>{includeSelection ? contextSelection.title : t("附带选区", "Attach selection")}</span>
          </label><button type="button" className="na-scope-trigger" aria-label={`${t("上下文范围", "Context")}: ${activeContextLevel.label}`} aria-haspopup="menu" aria-expanded={composerMenu === 'context'} onClick={event => toggleMenu('context', event.currentTarget)}>{activeContextLevel.short}<Chevron /></button></>
            : attachment ? <span className="na-attachment-title" title={attachment.title}><PageSymbol /><span>{attachment.title}</span></span>
              : <button type="button" className="na-add-context" title={t("引用本章已保存的正文", "Attach this chapter")} onClick={() => setAttachment({ title: contextTitle, content: contextText })}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>{t("附带本章", "Attach chapter")}</button>}
          {attachment && <><button type="button" className="na-context-icon" aria-label={t("查看附带上下文", "View context")} title={t("查看实际附带内容", "View attached content")} aria-haspopup="dialog" aria-expanded={composerMenu === 'attachment'} onClick={event => toggleMenu('attachment', event.currentTarget)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z"/><circle cx="10" cy="10" r="2"/></svg></button>
            {!contextSelection && <button type="button" className="na-context-icon" aria-label={t("移除引用", "Remove reference")} title={t("移除引用", "Remove reference")} onClick={() => { setIncludeSelection(false); setAttachment(null); }}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8" /></svg></button>}</>}
        </div>}
        {composerMenu && <div className={`na-composer-popover na-popover-${composerMenu}`} ref={menuRef} role={composerMenu === 'attachment' ? 'dialog' : 'menu'} aria-label={composerMenu === 'context' ? t("上下文范围", "Context") : composerMenu === 'style' ? t("回答风格", "Response style") : t("附带上下文", "Attached context")} onKeyDown={event => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || composerMenu === 'attachment') return;
          event.preventDefault(); const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        }}>
          <div className="na-popover-heading"><strong>{composerMenu === 'context' ? t("上下文范围", "Context") : composerMenu === 'style' ? t("回答风格", "Response style") : attachment?.title}</strong><button type="button" aria-label={t("关闭选项", "Close options")} onClick={closeMenu}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8" /></svg></button></div>
          {composerMenu === 'context' ? CONTEXT_LEVELS.map((item, index) => <button type="button" role="menuitemradio" aria-checked={contextLevel === item.id} className="na-option" key={item.id} onClick={() => { setContextLevel(item.id); closeMenu(); }}><span className="na-depth-icon" aria-hidden="true">{Array.from({ length: 3 }, (_, bar) => <i key={bar} className={bar <= index ? 'is-filled' : undefined} />)}</span><span><strong>{item.label}</strong><small>{item.detail}</small></span><span className="na-option-check">{contextLevel === item.id && <Check />}</span></button>)
            : composerMenu === 'style' ? RESPONSE_STYLES.map(item => <button type="button" role="menuitemradio" aria-checked={style === item.id} className="na-option" key={item.id} onClick={() => { setStyle(item.id); closeMenu(); }}><span className={`na-style-symbol is-${item.id}`} aria-hidden="true"><svg viewBox="0 0 20 20"><path d={item.id === 'concise' ? 'M5 7h10M5 12h6' : item.id === 'essence' ? 'm10 3 6 7-6 7-6-7Z' : item.id === 'normal' ? 'M4 5h12M4 10h12M4 15h7' : 'M4 4h12M4 8h12M4 12h12M4 16h9'} /></svg></span><span><strong>{item.label}</strong><small>{STYLE_DETAILS[item.id]}</small></span><span className="na-option-check">{style === item.id && <Check />}</span></button>)
              : <><small className="na-context-size">{t(`${attachment?.content.length.toLocaleString()} 字符`, `${attachment?.content.length.toLocaleString()} characters in this request`)}</small><pre className="na-context-preview">{attachment?.content}</pre><button type="button" className="na-remove-context" onClick={() => { setIncludeSelection(false); setAttachment(null); closeMenu(); }}>{t("移除引用", "Remove reference")}</button></>}
        </div>}
        <textarea ref={inputRef} rows={3} maxLength={16000} value={draft} aria-label={t("向智能助手提问", "Message assistant")} placeholder={t("提问，或一起展开想法…", "Ask a question…")} onFocus={() => setComposerMenu(null)} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!sending) void send(); } }} />
        <div className="na-composer-bottom">
          <label className="na-model" title={t("更换模型后，后续提问会携带当前对话记录与引用内容", "New messages keep this conversation's context")}><span className={`na-model-dot ${selected?.provider.configured ? 'is-ready' : ''}`} /><select aria-label={t("选择聊天模型", "Choose model")} value={choice} disabled={sending || !config} onChange={event => { setChoice(event.target.value); if (turns.length && !event.target.value.startsWith(`${selected?.provider.id}:`)) setNotice(t("已切换服务商，下一条消息会携带当前对话。", "Provider changed. Your conversation context will be included.")); else setNotice(''); }}>
            {!selected && <option value="">{t("选择模型", "Choose model")}</option>}
            {config?.providers.map(provider => <optgroup key={provider.id} label={`${provider.id === "custom" ? t("自定义", "Custom") : provider.name}${provider.configured ? '' : t(" · 未配置", " · Not configured")}`}>{provider.models.map(model => <option key={model} value={`${provider.id}:${model}`} disabled={!provider.configured}>{model}</option>)}</optgroup>)}
          </select><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg></label>
          <button type="button" className="na-style-trigger" aria-label={`${t("回答风格", "Response style")}: ${activeStyle.label}`} aria-haspopup="menu" aria-expanded={composerMenu === 'style'} title={t("回答风格", "Response style")} onClick={event => toggleMenu('style', event.currentTarget)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h12M4 10h9M4 15h6" /></svg><span>{activeStyle.label}</span><Chevron /></button>
          {sending ? <button type="button" className="na-send na-stop" aria-label={t("停止生成", "Stop response")} title={t("停止生成", "Stop response")} onClick={() => activeRequest.current?.abort()}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6" y="6" width="8" height="8" rx="1" /></svg></button>
            : <button type="submit" className="na-send" aria-label={t("发送提问", "Send message")} title={t("发送 · Enter", "Send · Enter")} disabled={!draft.trim() || !selected?.provider.configured}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15V5m-4 4 4-4 4 4" /></svg></button>}
        </div>
      </form>
      <p className="na-footer-note">{t("Enter 发送 · Shift + Enter 换行", "Enter to send · Shift + Enter for a new line")}</p>
    </footer>
  </aside>;
}
