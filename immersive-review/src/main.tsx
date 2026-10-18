import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NotebookApp } from './notebook/NotebookApp';
document.title = 'Read · 随笔、阅读与记忆';
const root = createRoot(document.getElementById('root')!);
root.render(<StrictMode><NotebookApp /></StrictMode>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
