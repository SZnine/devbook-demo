import path from 'node:path';

export type RuntimeConfig = {
  root: string;
  host: string;
  port: number;
  distDir: string;
  dataDir: string;
  allowedOrigins: string[];
  timeoutMs: number;
  maxBodyBytes: number;
  env: Record<string, string | undefined>;
};

function integer(env: Record<string, string | undefined>, name: string, fallback: number, min: number, max: number) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}

export function readRuntimeConfig(env: Record<string, string | undefined>, root: string): RuntimeConfig {
  const port = integer(env, 'READ_PORT', 5174, 1, 65535);
  const host = env.READ_HOST?.trim() || '127.0.0.1';
  if (/[/\\\s]/.test(host)) throw new Error('READ_HOST must be a hostname or IP address.');
  const distDir = path.resolve(root, 'dist');
  const dataDir = path.resolve(root, env.READ_DATA_DIR?.trim() || '.local');
  const relativeData = path.relative(distDir, dataDir);
  if (!relativeData || (!relativeData.startsWith(`..${path.sep}`) && relativeData !== '..' && !path.isAbsolute(relativeData))) {
    throw new Error('READ_DATA_DIR must be outside the public build directory.');
  }
  const allowedOrigins = (env.READ_ALLOWED_ORIGINS?.trim() || `http://localhost:${port},http://127.0.0.1:${port},http://[::1]:${port}`).split(',').map(value => {
    let url: URL;
    try { url = new URL(value.trim()); } catch { throw new Error('READ_ALLOWED_ORIGINS must contain comma-separated HTTP(S) origins.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('READ_ALLOWED_ORIGINS must contain origins only, without paths, credentials, query strings or wildcards.');
    }
    return url.origin;
  });
  return {
    root: path.resolve(root), host, port,
    distDir, dataDir,
    allowedOrigins: [...new Set(allowedOrigins)],
    timeoutMs: integer(env, 'READ_AI_TIMEOUT_MS', 180_000, 1_000, 600_000),
    maxBodyBytes: integer(env, 'READ_MAX_BODY_BYTES', 1_048_576, 1024, 16_777_216),
    env,
  };
}
