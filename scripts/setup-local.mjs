import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const file = '.dev.vars';
let contents = existsSync(file) ? readFileSync(file, 'utf8') : '';
const created = {};
for (const name of ['OWNER_ACCESS_KEY', 'SESSION_SECRET']) {
  if (!new RegExp(`^${name}=`, 'm').test(contents)) {
    created[name] = randomBytes(32).toString('base64url');
    const line = `${name}=${JSON.stringify(created[name])}\n`;
    appendFileSync(file, (contents.endsWith('\n') || !contents ? '' : '\n') + line, { mode: 0o600 });
    contents += line;
  }
}
if (created.OWNER_ACCESS_KEY) {
  mkdirSync('data', { recursive: true, mode: 0o700 });
  writeFileSync('data/access-key.txt', created.OWNER_ACCESS_KEY, { mode: 0o600, flag: 'wx' });
}
const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'DB', '--local', '--config', 'wrangler.local.json'], { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('本地环境已准备好。访问口令保存在 ignored data/access-key.txt；请勿上传口令或 .dev.vars。');
