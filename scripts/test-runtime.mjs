import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
mkdirSync('.runtime', { recursive: true });
const files = ['runtime', 'integration'];
// node --test runs each file in its own process, so each gets a fresh in-memory D1.
for (const name of files) await build({
  entryPoints: [`server/${name}.test.ts`], bundle: true, platform: 'node', format: 'esm', outfile: `.runtime/${name}.test.mjs`,
  plugins: [{ name: 'test-cloudflare-bindings', setup(build) {
    build.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'bindings', namespace: 'runtime-test' }));
    build.onLoad({ filter: /.*/, namespace: 'runtime-test' }, () => ({ contents: 'export const env = globalThis.__runtimeTestEnv;', loader: 'js' }));
  } }],
});
const result = spawnSync(process.execPath, ['--test', ...files.map(name => `.runtime/${name}.test.mjs`)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
