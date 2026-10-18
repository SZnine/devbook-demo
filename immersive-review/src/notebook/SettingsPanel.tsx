import { useEffect, useRef, useState } from 'react';
import { IS_DEMO_MODE, DEMO_AI_NOTICE } from '../demo';
import { AssistantSettings } from './AssistantSettings';
import type { AssistantConfig } from './assistant-client';
import { useComponentLibrary } from './ComponentLibrary';
import { loadNotebook } from './store';
import { dataCopy, exportFilename, markdownExport } from './file-exports';
import { chooseExportDirectory, downloadExport, loadExportDirectory, saveExportDirectory, supportsExportDirectory, writeExport, type ExportDirectory } from './export-directory';
import './assistant-settings.css';
import './settings-panel.css';

export type SettingsCategory = 'general' | 'files' | 'ai';
const categories: { id: SettingsCategory; label: string; icon: string }[] = [
  { id: 'general', label: '通用', icon: 'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0' },
  { id: 'files', label: '文件', icon: 'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z' },
  { id: 'ai', label: 'AI 服务', icon: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z' },
];

function FilesSettings() {
  const [directory, setDirectory] = useState<ExportDirectory | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    loadExportDirectory().then(value => { if (alive) setDirectory(value); }).catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : '无法读取保存位置。'); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  async function choose() {
    setError(''); setMessage(''); setBusy(true);
    try { setDirectory(await chooseExportDirectory()); }
    catch (reason) { if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(reason instanceof Error ? reason.message : '无法选择文件夹。'); }
    finally { setBusy(false); }
  }
  async function resetDirectory() {
    setBusy(true); setError(''); setMessage('');
    try { await saveExportDirectory(null); setDirectory(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '无法更新保存位置。'); }
    finally { setBusy(false); }
  }
  async function exportData(format: 'md' | 'json') {
    setBusy(true); setError(''); setMessage('');
    try {
      const state = await loadNotebook();
      const contents = format === 'md' ? markdownExport(state) : dataCopy(state, localStorage);
      const name = exportFilename(format);
      const data = new Blob([contents], { type: format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8' });
      if (directory) { await writeExport(directory, name, data); setMessage(`已保存到 ${directory.name} / ${name}`); }
      else { downloadExport(name, data); setMessage('已交给浏览器下载。'); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '导出失败，请重试。'); }
    finally { setBusy(false); }
  }
  return <div className="ns-section">
    <h3>文件</h3>
    <section className="ns-group" aria-label="保存位置">
      <div className="ns-row ns-file-location"><div><strong>默认导出位置</strong><p>{loading ? '正在读取…' : directory ? directory.name : '浏览器下载文件夹'}</p></div>
        <button className="nas-secondary" type="button" disabled={busy || loading || !supportsExportDirectory()} onClick={() => void choose()}>{directory ? '更改文件夹' : '选择文件夹'}</button>
      </div>
      {directory && <button className="ns-text-button" type="button" disabled={busy} onClick={() => void resetDirectory()}>改用浏览器下载</button>}
      <p className="ns-help">仅用于导出文件；编辑内容仍自动保存在当前浏览器。{supportsExportDirectory() ? '重新打开后，浏览器可能再次请求写入权限。' : '当前浏览器使用下载方式，保存位置由浏览器设置决定。'}</p>
    </section>
    <section className="ns-group" aria-label="数据导出">
      <div className="ns-row"><div><strong>Markdown</strong><p>导出随笔和书籍正文，保留 Markdown 格式。</p></div><button className="nas-secondary" type="button" disabled={busy || loading} onClick={() => void exportData('md')}>导出 Markdown</button></div>
      <div className="ns-row"><div><strong>数据副本</strong><p>内容、草稿、归档、回收站、学习记录和对话历史。</p></div><button className="nas-secondary" type="button" disabled={busy || loading} onClick={() => void exportData('json')}>导出 JSON</button></div>
      <p className="ns-help">不包含 API Key、文件夹权限和外部链接的媒体文件。数据副本供保留与迁移使用，当前版本暂不提供导入恢复。</p>
    </section>
    <p className={`ns-feedback${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || message || (busy ? '正在处理…' : '')}</p>
  </div>;
}

export function SettingsPanel({ initialCategory = 'general', appearance, onAppearanceChange, onClose, onSaved }: {
  initialCategory?: SettingsCategory;
  appearance: 'light' | 'dark';
  onAppearanceChange: (value: 'light' | 'dark') => void;
  onClose: () => void;
  onSaved: (value: AssistantConfig) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [category, setCategory] = useState(initialCategory);
  const library = useComponentLibrary();
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="nas-dialog ns-dialog" aria-label="设置" onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => event.stopPropagation()}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <header className="nas-header"><h2>设置</h2><button className="nas-close" type="button" aria-label="关闭设置" onClick={onClose}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button></header>
    <div className="ns-layout">
      <nav className="ns-navigation" aria-label="设置分类">{categories.map(item => <button type="button" key={item.id} aria-current={category === item.id ? 'page' : undefined} onClick={() => setCategory(item.id)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={item.icon} /></svg>{item.label}</button>)}</nav>
      <div className="ns-content">
        {category === 'general' && <div className="ns-section"><h3>通用</h3>
          <section className="ns-group" aria-label="外观"><div className="ns-row"><div><strong>外观</strong><p>工作台与编辑区的配色。</p></div><div className="ns-segmented" role="group" aria-label="外观"><button type="button" aria-pressed={appearance === 'light'} onClick={() => onAppearanceChange('light')}>浅色</button><button type="button" aria-pressed={appearance === 'dark'} onClick={() => onAppearanceChange('dark')}>深色</button></div></div></section>
          <section className="ns-group" aria-label="编辑器">
            <label className="ns-row"><div><strong>组件工具栏</strong><p>显示常用 Markdown 组件。</p></div><input className="ns-switch" type="checkbox" checked={library.open} onChange={event => event.target.checked ? library.show() : library.hide()} /></label>
            <label className="ns-row"><div><strong>紧凑工具栏</strong><p>减少工具栏占用的空间。</p></div><input className="ns-switch" type="checkbox" checked={library.compact} onChange={event => library.setCompact(event.target.checked)} /></label>
            <label className="ns-row"><div><strong>Markdown 语法提示</strong><p>在组件菜单中显示对应的写法。</p></div><input className="ns-switch" type="checkbox" checked={library.showSyntax} onChange={event => library.setShowSyntax(event.target.checked)} /></label>
          </section>
          <p className="ns-help">偏好自动保存在当前浏览器。</p>
        </div>}
        {category === 'files' && <FilesSettings />}
        {category === 'ai' && (IS_DEMO_MODE ? <div className="ns-section"><h3>AI 服务</h3><p className="ns-help">{DEMO_AI_NOTICE}</p></div> : <AssistantSettings embedded onClose={onClose} onSaved={onSaved} />)}
      </div>
    </div>
  </dialog>;
}
