import { useEffect, useRef, useState } from 'react';
import {
  getAssistantConfig, saveAssistantConfig,
  type AssistantConfig, type AssistantProvider, type AssistantProviderId,
} from './assistant-client';
import './assistant-settings.css';

type ProviderDraft = { apiKey: string; baseUrl: string; models: string; clearApiKey: boolean };
type AssistantSettingsProps = { onClose: () => void; onSaved: (config: AssistantConfig) => void; embedded?: boolean };

function draftFor(provider: AssistantProvider): ProviderDraft {
  return { apiKey: '', baseUrl: provider.baseUrl, models: provider.models.join('\n'), clearApiKey: false };
}

export function assistantModelValidationError(provider: Pick<AssistantProvider, 'hasApiKey'>, draft: Pick<ProviderDraft, 'apiKey' | 'clearApiKey'>, models: readonly string[]): string {
  const willHaveApiKey = !draft.clearApiKey && (Boolean(draft.apiKey.trim()) || provider.hasApiKey);
  return willHaveApiKey && !models.length ? '请至少填写一个模型 ID。' : '';
}

function ServiceSymbol({ provider }: { provider: AssistantProviderId }) {
  return <span className={`nas-service-symbol nas-service-${provider}`} aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {provider === 'glm' ? <><path d="m5 5 14 0-14 14h14M5 12h14" /><path d="M17 3v4M7 17v4" /></>
        : provider === 'deepseek' ? <><path d="M4 10c0 6 5 9 10 8 4-1 6-5 6-10-2 2-4 2-6 0-2-3-5-3-7 0L3 6l1 4Z" /><path d="m15 17 2 3M14 10h.01" /></>
          : <><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-12-2 18" /></>}
    </svg>
  </span>;
}

export function AssistantSettings({ onClose, onSaved, embedded = false }: AssistantSettingsProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  const savedRef = useRef(onSaved);
  const saveController = useRef<AbortController | null>(null);
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<AssistantProviderId, ProviderDraft>>>({});
  const [selectedId, setSelectedId] = useState<AssistantProviderId>('glm');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [showKey, setShowKey] = useState(false);

  closeRef.current = onClose;
  savedRef.current = onSaved;

  useEffect(() => {
    if (embedded) return () => saveController.current?.abort();
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      saveController.current?.abort();
      dialog?.close();
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    getAssistantConfig(controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setConfig(value);
      setDrafts(Object.fromEntries(value.providers.map(provider => [provider.id, draftFor(provider)])));
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法读取 AI 服务设置。');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [loadAttempt]);

  const provider = config?.providers.find(item => item.id === selectedId);
  const draft = drafts[selectedId];
  const providers = [...(config?.providers ?? [])].sort((a, b) => ['glm', 'deepseek', 'custom'].indexOf(a.id) - ['glm', 'deepseek', 'custom'].indexOf(b.id));

  function updateDraft(patch: Partial<ProviderDraft>) {
    setDrafts(current => current[selectedId] ? { ...current, [selectedId]: { ...current[selectedId], ...patch } } : current);
    setSaved('');
    setError('');
  }

  async function save() {
    if (!provider || !draft || saving) return;
    const baseUrl = draft.baseUrl.trim().replace(/\/+$/, '');
    const models = [...new Set(draft.models.split(/[\n,，]/).map(item => item.trim()).filter(Boolean))];
    try {
      const url = new URL(baseUrl);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    } catch {
      setError('请输入有效的 API 地址，不要包含密钥、查询参数或片段。');
      return;
    }
    const modelError = assistantModelValidationError(provider, draft, models);
    if (modelError) { setError(modelError); return; }
    const controller = new AbortController();
    saveController.current = controller;
    setSaving(true);
    setSaved('');
    setError('');
    try {
      const nextConfig = await saveAssistantConfig({
        providerId: provider.id, baseUrl, models,
        ...(draft.clearApiKey ? { clearApiKey: true } : draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      }, controller.signal);
      if (controller.signal.aborted) return;
      setConfig(nextConfig);
      const nextProvider = nextConfig.providers.find(item => item.id === provider.id);
      if (nextProvider) setDrafts(current => ({ ...current, [provider.id]: draftFor(nextProvider) }));
      setShowKey(false);
      setSaved(`${provider.name} 设置已保存`);
      savedRef.current(nextConfig);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '保存失败，请重试。');
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  const fields = <>{loading ? <div className="nas-loading" role="status">正在读取设置…</div> : !config ? <div className="nas-loading"><p role="alert">{error || '无法读取设置'}</p><button type="button" className="nas-secondary" onClick={() => setLoadAttempt(value => value + 1)}>重新加载</button></div> : <div className="nas-layout">
      <nav className="nas-services" aria-label="AI 服务商">
        {providers.map(item => <button type="button" key={item.id} aria-current={selectedId === item.id ? 'true' : undefined} disabled={saving}
          onClick={() => { setSelectedId(item.id); setShowKey(false); setError(''); setSaved(''); }}>
          <ServiceSymbol provider={item.id} /><span>{item.name}</span>{item.configured && <span className="nas-ready-dot" aria-label="已配置" />}
        </button>)}
      </nav>
      {provider && draft && <form className="nas-form" noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="nas-provider-heading"><h3>{provider.name}</h3><span className={`nas-status${provider.configured ? ' is-ready' : ''}`}>{provider.configured ? '已配置' : '未配置'}</span></div>
        <fieldset disabled={saving}>
          <label className="nas-field" htmlFor="nas-api-key">API Key</label>
          <div className="nas-key-input">
            <input id="nas-api-key" type={showKey ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} value={draft.apiKey} disabled={draft.clearApiKey}
              placeholder={draft.clearApiKey ? '保存后移除密钥' : provider.hasApiKey ? '已保存，留空保留' : '输入 API Key'}
              onChange={event => updateDraft({ apiKey: event.target.value })} />
            <button type="button" className="nas-eye" disabled={!draft.apiKey || draft.clearApiKey} aria-label={showKey ? '隐藏输入的密钥' : '显示输入的密钥'} aria-pressed={showKey} onClick={() => setShowKey(value => !value)}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z" /><circle cx="10" cy="10" r="2" />{showKey && <path d="m3 3 14 14" />}</svg>
            </button>
          </div>
          <p className="nas-local-note">密钥保存在服务端配置文件中，不写入浏览器存储。</p>
          {provider.hasApiKey && <label className="nas-remove-key"><input type="checkbox" checked={draft.clearApiKey} onChange={event => updateDraft({ clearApiKey: event.target.checked, apiKey: '' })} />移除已保存的密钥</label>}
          <details className="nas-advanced" key={provider.id}>
            <summary><span>高级设置</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg></summary>
            <div className="nas-advanced-fields">
              <label className="nas-field" htmlFor="nas-base-url">API 地址<input id="nas-base-url" type="url" spellCheck={false} autoComplete="off" value={draft.baseUrl} required onChange={event => updateDraft({ baseUrl: event.target.value })} /></label>
              <label className="nas-field" htmlFor="nas-models">模型<textarea id="nas-models" rows={3} spellCheck={false} value={draft.models} required placeholder="每行一个模型 ID" onChange={event => updateDraft({ models: event.target.value })} /></label>
              <p className="nas-hint">每行一个模型 ID，也可用逗号分隔。模型会出现在聊天界面的选择菜单中。</p>
              {provider.id === 'custom' && <p className="nas-hint">兼容 OpenAI Chat Completions 格式。</p>}
              <p className="nas-storage-detail">密钥以明文保存在配置目录的 <code>assistant-config.json</code> 中。</p>
            </div>
          </details>
        </fieldset>
        <footer className="nas-footer"><div className={`nas-feedback${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || saved}</div><button className="nas-save" type="submit" disabled={saving}>{saving ? '保存中…' : '保存设置'}</button></footer>
      </form>}
    </div>}</>;
  if (embedded) return fields;
  return <dialog ref={dialogRef} className="nas-dialog" aria-label="AI 服务设置"
    onCancel={event => { event.preventDefault(); closeRef.current(); }}
    onKeyDown={event => event.stopPropagation()}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeRef.current();
    }}>
    <header className="nas-header"><div><h2>设置</h2><span>AI 服务</span></div>
      <button type="button" className="nas-close" aria-label="关闭 AI 服务设置" title="关闭 · Esc" onClick={onClose} autoFocus>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
      </button>
    </header>
    {fields}
  </dialog>;
}
