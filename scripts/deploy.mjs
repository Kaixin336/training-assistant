import { readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const config = JSON.parse(readFileSync('wrangler.json', 'utf8'));
const database = config.d1_databases?.find(item => item.binding === 'DB');
if (!database?.database_id || database.database_id.startsWith('00000000-')) throw new Error('请先在自己的 Cloudflare 账户创建 D1，并把真实 database_id 填入 wrangler.json。');
function run(args, extra = {}) { const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...extra, WRANGLER_SEND_METRICS: 'false' } }); if (result.status !== 0) process.exit(result.status ?? 1); }
// Secrets (OWNER_ACCESS_KEY, optional SESSION_SECRET and DEEPSEEK_API_KEY) live in Cloudflare, never in this repo.
run(['node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'DB', '--remote', '--config', 'wrangler.json']);
run(['node_modules/vite/bin/vite.js', 'build'], { KAI_DEPLOY: '1' });
// The Vite plugin copies local .dev.vars into the build for `vite preview`; production uses Wrangler secrets only.
rmSync(`dist/${config.name.replaceAll('-', '_')}/.dev.vars`, { force: true });
run(['node_modules/wrangler/bin/wrangler.js', 'deploy']);
