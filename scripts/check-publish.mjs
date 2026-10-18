import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const rules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['provider-token', /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b/],
  ['personal-path', /[A-Za-z]:[\\/](?:Users|Desktop)[\\/]/i],
  ['credential-url', /https?:\/\/[^\s/:]+:[^\s/@]+@/i],
  ['credential-assignment', /(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*["']?\s*[:=]\s*["']?[A-Za-z0-9_.-]{32,}/i],
];
const forbiddenPath = /^(?:research|\.archive)\/|(?:^|\/)(?:\.local|node_modules|acceptance|exports|backups)(?:\/|$)|^immersive-review\/(?:dist|build|experiments)\/|(?:^|\/)\.env(?:$|\.(?!example$))|(?:assistant-config.*\.json|\.private\.[^/]+)$|\.(?:pem|key|p12|pfx|sqlite\w*|db|zip|log)$/i;
const textExtensions = /\.(?:[cm]?[jt]sx?|json|md|html|css|yml|yaml|toml|txt|sh|ps1|example)$|(?:^|\/)(?:Dockerfile|\.gitignore|\.dockerignore|\.gitattributes)$/i;

try {
  const indexed = new Set(git('ls-files', '-z', '--cached').split('\0').filter(Boolean));
  const candidates = [...new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean))];
  const findings = [];
  for (const file of candidates) {
    const full = path.join(root, file);
    let stat;
    try { stat = statSync(full); } catch { findings.push(`${file}: missing indexed file`); continue; }
    if (!stat.isFile()) continue;
    if (forbiddenPath.test(file)) { findings.push(`${file}: private/generated path`); continue; }
    if (stat.size > 5 * 1024 * 1024) findings.push(`${file}: file exceeds 5 MiB`);
    if (!textExtensions.test(file)) continue;
    const workingText = readFileSync(full, 'utf8');
    const versions = [['worktree', workingText]];
    if (indexed.has(file)) {
      const stagedText = git('show', `:${file}`);
      if (stagedText !== workingText) versions.push(['index', stagedText]);
    }
    for (const [version, content] of versions) {
    const lines = content.split(/\r?\n/);
    for (let line = 0; line < lines.length; line++) {
      // Only the two explicit invalid-URL fixtures are exempt; no test file is skipped.
      const inspected = /^immersive-review\/tests\/(?:assistant-api|production-runtime)\.test\.ts$/.test(file)
        ? lines[line].replace(/https:\/\/user:(?:password|secret)@example\.test/g, 'https://invalid.example.test') : lines[line];
      for (const [label, pattern] of rules) if (pattern.test(inspected)) findings.push(`${file}:${line + 1} (${version}): ${label}`);
    }
    }
  }
  if (findings.length) {
    console.error('Publish check failed (values are intentionally omitted):\n' + findings.join('\n'));
    process.exitCode = 1;
  } else console.log(`Publish check passed: ${candidates.length} candidate files; no matched secret, private path or generated-file rules. This is a heuristic check, not proof that every document is public.`);
} catch {
  console.error('Cannot inspect the Git file set. Run git init -b main in the project root first.');
  process.exitCode = 1;
}
