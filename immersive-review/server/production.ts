import { fileURLToPath } from 'node:url';
import { createProductionServer } from './http-server';
import { readRuntimeConfig } from './runtime-config';

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const config = readRuntimeConfig(process.env, root);
  const server = await createProductionServer(config);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  console.log(`Read is listening on port ${config.port}.`);
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 10_000).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch(error => {
  const code = (error as NodeJS.ErrnoException).code;
  // Never print request data, environment values, filesystem paths or credentials.
  console.error(code === 'EADDRINUSE' ? 'Read could not start: the configured port is in use.' : 'Read could not start. Check the production build, directory permissions and runtime configuration.');
  process.exitCode = 1;
});
