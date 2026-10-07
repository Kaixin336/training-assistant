import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
sqlite.exec(readFileSync('drizzle/0002_independent_runtime.sql', 'utf8'));
class Statement {
  constructor(readonly sql: string, readonly values: unknown[] = []) {}
  bind(...values: unknown[]) { return new Statement(this.sql, values); }
  args() { return this.values.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value) as Parameters<ReturnType<DatabaseSync['prepare']>['all']>; }
  async first<T>() { return sqlite.prepare(this.sql).get(...this.args()) as T ?? null; }
  execute<T>() { const statement = sqlite.prepare(this.sql); if (statement.columns().length) return { results: statement.all(...this.args()) as T[], meta: { changes: 0 } }; const result = statement.run(...this.args()); return { results: [] as T[], meta: { changes: Number(result.changes) } }; }
  async all<T>() { return this.execute<T>(); }
  async run() { return this.execute(); }
}
const database = {
  prepare(sql: string) { return new Statement(sql); },
  async batch(statements: Statement[]) { sqlite.exec('BEGIN IMMEDIATE'); try { const results = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } },
};
const password = 'test-only-access-key-1234567890';
(globalThis as unknown as { __runtimeTestEnv: unknown }).__runtimeTestEnv = { DB: database, APP_ORIGIN: 'https://training.example', OWNER_ACCESS_KEY: password, SESSION_SECRET: 'test-only-session-secret-at-least-32-characters' };
const { login, logout, session, requireOwner } = await import('../lib/auth');
const { D1PhotoStore, PHOTO_STORAGE_LIMIT } = await import('../lib/photo-store');
function request(path: string, options: RequestInit = {}, ip = '192.0.2.10') { return new Request(`https://training.example${path}`, { ...options, headers: { 'cf-connecting-ip': ip, ...options.headers } }); }
async function signIn(ip = '192.0.2.10') { return login(request('/api/login', { method: 'POST', headers: { origin: 'https://training.example' }, body: JSON.stringify({ password }) }, ip)); }

test('private APIs reject missing and forged Sites identity', async () => {
  await assert.rejects(requireOwner(request('/api/data')), { status: 401 });
  await assert.rejects(requireOwner(request('/api/data', { headers: { 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@example.com' } })), { status: 401 });
});
test('login requires exact configured origin and limits failed attempts', async () => {
  assert.equal((await login(request('/api/login', { method: 'POST', headers: { origin: 'https://training.example.evil' }, body: JSON.stringify({ password }) }))).status, 403);
  for (let index = 0; index < 10; index++) assert.equal((await login(request('/api/login', { method: 'POST', headers: { origin: 'https://training.example' }, body: JSON.stringify({ password: 'wrong' }) }, '192.0.2.11'))).status, 401);
  assert.equal((await signIn('192.0.2.11')).status, 429);
});
test('signed session is HttpOnly, strict, secure, CSRF checked and revoked on logout', async () => {
  const result = await signIn(); assert.equal(result.status, 200);
  const setCookie = result.headers.get('set-cookie')!;
  for (const flag of ['__Host-kai_session=', 'HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/']) assert.ok(setCookie.includes(flag));
  const cookie = setCookie.split(';')[0];
  assert.equal(await requireOwner(request('/api/data', { headers: { cookie } })), 'local-owner');
  assert.equal((await (await session(request('/api/session', { headers: { cookie } }))).json() as { authenticated: boolean }).authenticated, true);
  await assert.rejects(requireOwner(request('/api/action', { method: 'POST', headers: { cookie } })), { status: 403 });
  assert.equal(await requireOwner(request('/api/action', { method: 'POST', headers: { cookie, origin: 'https://training.example' } })), 'local-owner');
  await assert.rejects(requireOwner(request('/api/data', { headers: { cookie: `${cookie}tampered` } })), { status: 401 });
  assert.equal((await logout(request('/api/logout', { method: 'POST', headers: { cookie, origin: 'https://training.example' } }))).status, 200);
  await assert.rejects(requireOwner(request('/api/data', { headers: { cookie } })), { status: 401 });
});
test('D1 photo chunks round trip, duplicate safely, and reject conflicting bytes', async () => {
  const store = new D1PhotoStore(); const key = `photos/local-owner/${crypto.randomUUID()}`;
  const bytes = new Uint8Array(600000); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  await store.put(key, bytes); await store.put(key, bytes);
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM photo_chunks WHERE key=?').get(key)!).n, 3);
  assert.deepEqual(new Uint8Array(await (await store.get(key))!.arrayBuffer()), bytes);
  const changed = bytes.slice(); changed[0] = 255;
  await assert.rejects(store.put(key, changed), { status: 409 });
  assert.deepEqual(new Uint8Array(await (await store.get(key))!.arrayBuffer()), bytes);
  await store.delete(key); assert.equal(await store.get(key), null);
});
test('maximum size photo uses 48 chunks and rejects oversize/path escapes', async () => {
  const store = new D1PhotoStore(); const key = `photos/local-owner/${crypto.randomUUID()}`;
  const bytes = new Uint8Array(12 * 1024 * 1024); bytes[bytes.length - 1] = 197;
  await store.put(key, bytes);
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM photo_chunks WHERE key=?').get(key)!).n, 48);
  assert.deepEqual(new Uint8Array(await (await store.get(key))!.arrayBuffer()), bytes);
  await store.delete(key);
  await assert.rejects(store.put(key, new Uint8Array(bytes.length + 1)), { status: 413 });
  await assert.rejects(store.get('photos/local-owner/../../secret'), { status: 400 });
});
test('quota refusal leaves no chunks or object for the rejected upload', async () => {
  const store = new D1PhotoStore(); const key = `photos/local-owner/${crypto.randomUUID()}`;
  sqlite.prepare('INSERT INTO photo_objects VALUES (?,?,?,?,?)').run('quota-test', PHOTO_STORAGE_LIMIT, 'test', 'image/png', 'test');
  await assert.rejects(store.put(key, new Uint8Array([1, 2, 3])), { status: 507 });
  assert.equal(sqlite.prepare('SELECT key FROM photo_objects WHERE key=?').get(key), undefined);
  assert.equal(sqlite.prepare('SELECT key FROM photo_chunks WHERE key=?').get(key), undefined);
  sqlite.prepare('DELETE FROM photo_objects WHERE key=?').run('quota-test');
});
