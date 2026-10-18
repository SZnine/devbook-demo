import { loadEnv, type Plugin } from 'vite';
import { createAssistantApiMiddleware, type MiddlewareOptions } from './assistant-api';

export function assistantApiPlugin(): Plugin {
  let options: MiddlewareOptions;
  return {
    name: 'local-assistant-api',
    config() { return { server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**'] } } }; },
    configResolved(config) { options = { root: config.root, env: loadEnv(config.mode, config.root, '') }; },
    configureServer(server) { server.middlewares.use(createAssistantApiMiddleware(options)); },
    configurePreviewServer(server) { server.middlewares.use(createAssistantApiMiddleware(options)); },
  };
}
