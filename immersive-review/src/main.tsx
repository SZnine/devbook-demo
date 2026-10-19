import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NotebookApp } from './notebook/NotebookApp';
import { useLanguage } from './i18n';
function App() {
  useLanguage();
  return <NotebookApp />;
}
const root = createRoot(document.getElementById('root')!);
root.render(<StrictMode><App /></StrictMode>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
