import { t } from '../i18n';
export interface ExportDirectory {
  readonly name: string;
  readonly kind: 'directory';
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  getFileHandle(name: string, options: { create: true }): Promise<{
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
  }>;
}
type DirectoryPickerWindow = Window & { showDirectoryPicker?: (options: { mode: 'readwrite'; id: string }) => Promise<ExportDirectory> };
const DIRECTORY_DB = 'read-export-preferences-v1';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DIRECTORY_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('preferences');
    request.onerror = () => reject(new Error(t("无法保存文件夹偏好。", "Could not save the export folder.")));
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}
export async function loadExportDirectory(): Promise<ExportDirectory | null> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('preferences', 'readonly');
    const request = tx.objectStore('preferences').get('directory');
    tx.oncomplete = () => { db.close(); resolve(request.result ?? null); };
    tx.onabort = () => { db.close(); reject(new Error(t("无法读取保存位置。", "Could not load the export folder."))); };
  });
}
export async function saveExportDirectory(directory: ExportDirectory | null): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('preferences', 'readwrite');
    if (directory) tx.objectStore('preferences').put(directory, 'directory');
    else tx.objectStore('preferences').delete('directory');
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(new Error(t("无法保存文件夹偏好。", "Could not save the export folder."))); };
  });
}
export function supportsExportDirectory() {
  return window.isSecureContext && typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function';
}
export async function chooseExportDirectory(): Promise<ExportDirectory> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!supportsExportDirectory() || !picker) throw new Error(t("当前浏览器不支持选择本机文件夹，可使用浏览器下载。", "Folder access is unavailable. Use browser downloads."));
  const directory = await picker.call(window, { mode: 'readwrite', id: 'read-exports' });
  await saveExportDirectory(directory);
  return directory;
}

export async function writeExport(directory: ExportDirectory, name: string, data: Blob): Promise<void> {
  if (!name || /[\\/]/.test(name)) throw new Error(t("导出文件名无效。", "Invalid export filename."));
  const options = { mode: 'readwrite' as const };
  const granted = await directory.queryPermission(options) === 'granted' || await directory.requestPermission(options) === 'granted';
  if (!granted) throw new Error(t("未获得文件夹写入权限，请重新选择文件夹或改用浏览器下载。", "Folder permission denied. Choose a folder or use browser downloads."));
  const file = await directory.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  try { await writable.write(data); await writable.close(); }
  catch (error) { await writable.abort().catch(() => undefined); throw error; }
}
export function downloadExport(name: string, data: Blob) {
  const url = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url; link.download = name; link.hidden = true;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
