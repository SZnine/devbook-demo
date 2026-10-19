import { t, useLanguage, type Language } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { IS_DEMO_MODE, demoAiNotice } from '../demo';
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
  { id: 'general', get label() { return t("通用", "General"); }, icon: 'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0' },
  { id: 'files', get label() { return t("文件", "Files"); }, icon: 'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z' },
  { id: 'ai', get label() { return t("AI 服务", "AI providers"); }, icon: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z' },
];

function FilesSettings() {
  const [directory, setDirectory] = useState<ExportDirectory | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    loadExportDirectory().then(value => { if (alive) setDirectory(value); }).catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : t("无法读取保存位置。", "Could not load the export folder.")); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  async function choose() {
    setError(''); setMessage(''); setBusy(true);
    try { setDirectory(await chooseExportDirectory()); }
    catch (reason) { if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(reason instanceof Error ? reason.message : t("无法选择文件夹。", "Could not select the folder.")); }
    finally { setBusy(false); }
  }
  async function resetDirectory() {
    setBusy(true); setError(''); setMessage('');
    try { await saveExportDirectory(null); setDirectory(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t("无法更新保存位置。", "Could not update the export folder.")); }
    finally { setBusy(false); }
  }
  async function exportData(format: 'md' | 'json') {
    setBusy(true); setError(''); setMessage('');
    try {
      const state = await loadNotebook();
      const contents = format === 'md' ? markdownExport(state) : dataCopy(state, localStorage);
      const name = exportFilename(format);
      const data = new Blob([contents], { type: format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8' });
      if (directory) { await writeExport(directory, name, data); setMessage(t(`已保存到 ${directory.name} / ${name}`, `Saved to ${directory.name} / ${name}`)); }
      else { downloadExport(name, data); setMessage(t("已交给浏览器下载。", "Download started.")); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("导出失败，请重试。", "Export failed. Try again.")); }
    finally { setBusy(false); }
  }
  return <div className="ns-section">
    <h3>{t("文件", "Files")}</h3>
    <section className="ns-group" aria-label={t("保存位置", "Export location")}>
      <div className="ns-row ns-file-location"><div><strong>{t("默认导出位置", "Export folder")}</strong><p>{loading ? t("正在读取…", "Loading…") : directory ? directory.name : t("浏览器下载文件夹", "Browser downloads")}</p></div>
        <button className="nas-secondary" type="button" disabled={busy || loading || !supportsExportDirectory()} onClick={() => void choose()}>{directory ? t("更改文件夹", "Change folder") : t("选择文件夹", "Choose folder")}</button>
      </div>
      {directory && <button className="ns-text-button" type="button" disabled={busy} onClick={() => void resetDirectory()}>{t("改用浏览器下载", "Use browser downloads")}</button>}
      <p className="ns-help">{t("仅用于导出；编辑内容自动保存在此浏览器。", "Exports only. Notes are saved in this browser.")}</p>
    </section>
    <section className="ns-group" aria-label={t("数据导出", "Export")}>
      <div className="ns-row"><div><strong>Markdown</strong><p>{t("导出随笔和书籍正文，保留 Markdown 格式。", "Notes and books as Markdown.")}</p></div><button className="nas-secondary" type="button" disabled={busy || loading} onClick={() => void exportData('md')}>{t("导出 Markdown", "Export Markdown")}</button></div>
      <div className="ns-row"><div><strong>{t("数据副本", "Data copy")}</strong><p>{t("内容、草稿、归档、回收站、学习记录和对话历史。", "Content, drafts, reading records and chat history.")}</p></div><button className="nas-secondary" type="button" disabled={busy || loading} onClick={() => void exportData('json')}>{t("导出 JSON", "Export JSON")}</button></div>
      <details className="ns-export-details"><summary>{t('导出范围', 'What’s included')}</summary><p className="ns-help">{t("不包含密钥与外链媒体。暂不支持导入恢复。", "Excludes API keys and linked media. Import is not yet available.")}</p></details>
    </section>
    <p className={`ns-feedback${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || message || (busy ? t("正在处理…", "Working…") : '')}</p>
  </div>;
}

export function SettingsPanel({ initialCategory = 'general', appearance, onAppearanceChange, onClose, onSaved }: {
  initialCategory?: SettingsCategory;
  appearance: 'light' | 'dark';
  onAppearanceChange: (value: 'light' | 'dark') => void;
  onClose: () => void;
  onSaved: (value: AssistantConfig) => void;
}) {
  const { language, setLanguage } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const [category, setCategory] = useState(initialCategory);
  const library = useComponentLibrary();
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="nas-dialog ns-dialog" aria-label={t("设置", "Settings")} onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => event.stopPropagation()}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <header className="nas-header"><h2>{t("设置", "Settings")}</h2><button className="nas-close" type="button" aria-label={t("关闭设置", "Close settings")} onClick={onClose}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button></header>
    <div className="ns-layout">
      <nav className="ns-navigation" aria-label={t("设置分类", "Settings categories")}>{categories.map(item => <button type="button" key={item.id} aria-current={category === item.id ? 'page' : undefined} onClick={() => setCategory(item.id)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={item.icon} /></svg>{item.label}</button>)}</nav>
      <div className="ns-content">
        {category === 'general' && <div className="ns-section"><h3>{t("通用", "General")}</h3>
          <section className="ns-group" aria-label={t('语言与外观', 'Language and appearance')}>
            <label className="ns-row"><strong>{t('语言', 'Language')}</strong><select className="ns-language" value={language} onChange={event => setLanguage(event.target.value as Language)}><option value="en">English</option><option value="zh-CN">简体中文</option></select></label>
            <div className="ns-row"><strong>{t("外观", "Appearance")}</strong><div className="ns-segmented" role="group" aria-label={t("外观", "Appearance")}><button type="button" aria-pressed={appearance === 'light'} onClick={() => onAppearanceChange('light')}>{t("浅色", "Light")}</button><button type="button" aria-pressed={appearance === 'dark'} onClick={() => onAppearanceChange('dark')}>{t("深色", "Dark")}</button></div></div>
          </section>
          <section className="ns-group" aria-label={t("编辑器", "Editor")}>
            <label className="ns-row"><div><strong>{t("组件工具栏", "Block toolbar")}</strong><p>{t("显示常用 Markdown 组件。", "Keep common blocks within reach.")}</p></div><input className="ns-switch" type="checkbox" checked={library.open} onChange={event => event.target.checked ? library.show() : library.hide()} /></label>
            <label className="ns-row"><div><strong>{t("紧凑工具栏", "Compact toolbar")}</strong><p>{t("减少工具栏占用的空间。", "Use smaller controls.")}</p></div><input className="ns-switch" type="checkbox" checked={library.compact} onChange={event => library.setCompact(event.target.checked)} /></label>
            <label className="ns-row"><div><strong>{t("Markdown 语法提示", "Markdown hints")}</strong><p>{t("在组件菜单中显示对应的写法。", "Show syntax in block menus.")}</p></div><input className="ns-switch" type="checkbox" checked={library.showSyntax} onChange={event => library.setShowSyntax(event.target.checked)} /></label>
          </section>
        </div>}
        {category === 'files' && <FilesSettings />}
        {category === 'ai' && (IS_DEMO_MODE ? <div className="ns-section"><h3>{t("AI 服务", "AI providers")}</h3><p className="ns-help">{demoAiNotice()}</p></div> : <AssistantSettings embedded onClose={onClose} onSaved={onSaved} />)}
      </div>
    </div>
  </dialog>;
}
