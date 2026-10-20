import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { assistantApiPlugin } from './server/vite-plugin';
import { vditorMathAssetsPlugin } from './server/vditor-assets';
export default defineConfig(({ mode }) => ({
  base: process.env.READ_PUBLIC_BASE || '/',
  plugins: [react(), vditorMathAssetsPlugin(), ...(mode === 'demo' ? [] : [assistantApiPlugin()])],
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
}));
