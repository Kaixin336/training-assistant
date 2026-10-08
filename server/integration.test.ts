/**
 * End-to-end worker tests against every migration in an in-memory SQLite D1 shim.
 * Each request is also checked against the D1 free-plan limit of 50 queries.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
for (const file of readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`drizzle/${file}`, 'utf8').replaceAll('--> statement-breakpoint', ''));
let queries = 0;
class Statement {
  constructor(readonly sql: string, readonly values: unknown[] = []) {}
  bind(...values: unknown[]) { return new Statement(this.sql, values); }
  args() { return this.values.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value) as Parameters<ReturnType<DatabaseSync['prepare']>['all']>; }
  execute<T>() {
    queries++;
    if (this.values.length > 100) throw new Error(`D1 allows 100 bound values, got ${this.values.length}`);
    const statement = sqlite.prepare(this.sql);
    if (statement.columns().length) return { results: statement.all(...this.args()) as T[], meta: { changes: 0 } };
    const result = statement.run(...this.args()); return { results: [] as T[], meta: { changes: Number(result.changes) } };
  }
  async first<T>() { const rows = this.execute<T>().results; return rows[0] ?? null; }
  async all<T>() { return this.execute<T>(); }
  async run() { return this.execute(); }
}
const database = {
  prepare(sql: string) { return new Statement(sql); },
  async batch(statements: Statement[]) { sqlite.exec('BEGIN IMMEDIATE'); try { const results = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } },
};
const ORIGIN = 'https://training.example';
const password = 'integration-test-access-key-123456';
const env: Record<string, unknown> = { DB: database, APP_ORIGIN: ORIGIN, OWNER_ACCESS_KEY: password, SESSION_SECRET: 'integration-test-session-secret-0123456789', ASSETS: { fetch: async () => new Response('asset') } };
(globalThis as unknown as { __runtimeTestEnv: unknown }).__runtimeTestEnv = env;
const { default: worker } = await import('./worker');
const { todayNZ, addDays } = await import('../lib/domain');
type Data = import('../lib/domain').AppData;

let cookie = '';
const heaviest = new Map<string, number>();
async function call(path: string, init: RequestInit & { anonymous?: boolean; crossSite?: boolean } = {}) {
  const headers = new Headers(init.headers);
  if (!init.anonymous && cookie) headers.set('cookie', cookie);
  if (init.method && init.method !== 'GET') headers.set('origin', init.crossSite ? 'https://evil.example' : ORIGIN);
  headers.set('cf-connecting-ip', '192.0.2.50');
  queries = 0;
  const response = await worker.fetch(new Request(ORIGIN + path, { ...init, headers }), env as never);
  assert.ok(queries <= 50, `${init.method ?? 'GET'} ${path} used ${queries} D1 queries (free plan allows 50)`);
  const key = `${init.method ?? 'GET'} ${path.split('?')[0].replace(/[0-9a-f-]{36}/, ':id')}`;
  if (queries > (heaviest.get(key) ?? 0)) heaviest.set(key, queries);
  return response;
}
const post = (path: string, body: unknown, init: RequestInit & { anonymous?: boolean; crossSite?: boolean } = {}) => call(path, { ...init, method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...init.headers } });
async function data(): Promise<Data> { const response = await call('/api/data'); assert.equal(response.status, 200); assert.ok(queries >= 5, 'the D1 query counter is live'); return response.json() as Promise<Data>; }
async function chat(text: string, extra: Record<string, unknown> = {}) { const response = await post('/api/chat', { id: crypto.randomUUID(), text, ...extra }); return { status: response.status, body: await response.json() as { messages?: { id: string; text: string; itemIds?: string[]; clarification?: boolean }[]; error?: string } }; }
const today = todayNZ();

test('every private API rejects anonymous and cross-site requests', async () => {
  const routes: [string, string][] = [['GET', '/api/data'], ['POST', '/api/chat'], ['POST', '/api/action'], ['POST', '/api/photos'], ['GET', '/api/export'], ['GET', '/api/ai-config'], ['POST', '/api/ai-config'], ['DELETE', '/api/ai-config'], ['POST', '/api/ai-config/test'], ['GET', '/api/health/status'], ['POST', '/api/health/token'], ['POST', '/api/health/import'], ['GET', '/api/weekly'], ['POST', '/api/restore'], ['POST', '/api/restore/photo'], ['GET', `/api/photos/${crypto.randomUUID()}`]];
  for (const [method, path] of routes) assert.equal((await call(path, { method, anonymous: true, ...(method === 'GET' ? {} : { body: '{}' }) })).status, 401, `${method} ${path}`);
  assert.equal((await call('/api/data', { anonymous: true, headers: { 'oai-authenticated-user-id': 'x', 'oai-authenticated-user-email': 'x@example.com' } })).status, 401);
  const login = await post('/api/login', { password });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await post('/api/chat', { id: crypto.randomUUID(), text: '体重 70' }, { crossSite: true })).status, 403);
  assert.equal((await call('/api/nope')).status, 404);
  assert.equal((await call('/api/data', { method: 'DELETE' })).status, 405);
});

test('set-by-set logging groups into one training session until it is finished', async () => {
  const first = await chat('卧推 60kg 3x8 吃力');
  assert.equal(first.status, 200, JSON.stringify(first.body));
  let state = await data();
  assert.ok(state.activeSession, 'a session starts with the first workout');
  assert.equal(state.activeSession!.activeExerciseName, '杠铃卧推');
  const next = await chat('第4组 62.5kg 6次');
  assert.equal(next.status, 200, JSON.stringify(next.body));
  state = await data();
  const bench = state.items.filter(i => i.kind === 'workout' && i.exerciseName === '杠铃卧推');
  assert.equal(bench.length, 2);
  assert.equal(new Set(bench.map(w => w.kind === 'workout' && w.trainingSessionId)).size, 1, 'both messages share the session');
  const ordinals = bench.flatMap(w => w.kind === 'workout' ? w.sets.map(s => s.ordinal) : []);
  assert.deepEqual(ordinals, [1, 2, 3, 4]);
  const finished = await chat('结束训练');
  assert.match(finished.body.messages![1].text, /1 个动作、4 个工作组/);
  state = await data();
  assert.equal(state.activeSession, null);
  await chat('卧推 60kg 8次');
  state = await data();
  const sessions = new Set(state.items.filter(i => i.kind === 'workout').map(w => w.kind === 'workout' && w.trainingSessionId));
  assert.equal(sessions.size, 2, 'a finished session is not reused');
  const orphan = await chat('又一组 8个');
  assert.equal(orphan.status, 200);
  assert.equal(orphan.body.messages![1].itemIds?.length, 1, 'continuation uses the new open session');
});

test('a retried message is saved once and ambiguous input saves nothing', async () => {
  const before = (await data()).items.length;
  const id = crypto.randomUUID();
  const a = await post('/api/chat', { id, text: '深蹲 80kg 5/5/4' });
  const b = await post('/api/chat', { id, text: '深蹲 80kg 5/5/4' });
  assert.deepEqual(await a.json(), await b.json());
  assert.equal((await data()).items.length, before + 1);
  const unclear = await chat('哑铃卧推 20kg 3x10');
  assert.equal(unclear.body.messages![1].clarification, true);
  assert.equal((await data()).items.length, before + 1, 'clarification writes no record');
});

test('DeepSeek key is encrypted at rest and model output is validated before saving', async () => {
  const realFetch = globalThis.fetch;
  const sent: string[] = [];
  let reply: unknown = null; let status = 200;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).startsWith('https://api.deepseek.com/')) return realFetch(input, init);
    sent.push(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: 'stop' }] }), { status });
  }) as typeof fetch;
  try {
    const key = 'sk-integration-test-key-abcdefghijklmnop';
    assert.equal((await post('/api/ai-config', { apiKey: key, model: 'deepseek-flash' })).status, 200);
    const stored = sqlite.prepare("SELECT payload FROM private_config WHERE key='deepseek'").get() as { payload: string };
    assert.ok(!stored.payload.includes(key) && !stored.payload.includes(key.slice(3, 20)), 'API key is not stored in plaintext');
    assert.deepEqual(await (await call('/api/ai-config')).json(), { connected: true, model: 'deepseek-flash', environmentManaged: false });
    assert.equal((await data()).aiEnabled, true);

    const before = (await data()).items.length;
    reply = { intent: 'records', reply: '收到，腿练得不错。', records: [
      { kind: 'workout', date: today, exercise: '深蹲', unit: 'kg', sets: [{ weightKg: 80, reps: 5, feel: 'Hard' }, { weightKg: 80, reps: 5, feel: 'Hard' }] },
      { kind: 'food', date: today, description: '牛肉面一碗', calories: null, protein: null, isEstimate: false },
    ] };
    const saved = await chat('今天练腿，深蹲 80 做了两组 5 个都很吃力，晚饭牛肉面');
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.messages![1].itemIds?.length, 2);
    assert.match(saved.body.messages![1].text, /收到，腿练得不错。/);
    assert.equal((await data()).items.length, before + 2);
    assert.ok(!sent.at(-1)!.includes(key), 'the key is only a header, never in the prompt');
    assert.ok(sent.at(-1)!.includes('"thinking":{"type":"disabled"}') && sent.at(-1)!.includes('json_object'));

    reply = { intent: 'records', reply: '', records: [{ kind: 'metric', date: today, metric: 'weight', value: 72, unit: 'cm' }] };
    const invalid = await chat('体重 72');
    assert.equal(invalid.status, 422, 'a wrong unit from the model is rejected');
    reply = { intent: 'records', reply: '', records: Array.from({ length: 31 }, () => ({ kind: 'note', date: today, category: 'general', text: 'x' })) };
    assert.equal((await chat('很多备注')).status, 413);
    // Answers without "records", with null, or with extra fields are still answers.
    reply = { intent: 'question', reply: '休息日照计划吃就行。' };
    const asked = await chat('休息日要不要少吃？');
    assert.equal(asked.status, 200, JSON.stringify(asked.body)); assert.match(asked.body.messages![1].text, /照计划吃/);
    reply = { intent: 'advice', reply: '可以少吃一点土豆。', records: null, tips: ['多喝水'] };
    assert.equal((await chat('备考日怎么吃？')).status, 200);
    reply = { intent: 'records', reply: '', records: [] };
    assert.equal((await chat('随便说说')).status, 422, 'no answer and nothing to save');
    reply = { intent: 'clarification', reply: '哑铃是单手 20 还是两只合计？', records: [] };
    const question = await chat('哑铃卧推 20 3x10');
    assert.equal(question.body.messages![1].clarification, true);
    reply = { intent: 'records', reply: '', records: [{ kind: 'workout', date: today, exercise: '哑铃卧推', unit: 'kg/hand', sets: [{ weightKg: 20, reps: 10 }] }] };
    const answered = await chat('单手', { pendingMessageId: question.body.messages![1].id });
    assert.equal(answered.status, 200);
    assert.match(sent.at(-1)!, /哑铃卧推 20 3x10.*（补充）单手/s, 'the answer is combined with the original message');
    status = 401;
    const failed = await chat('卧推 60kg 3x8');
    assert.equal(failed.status, 503);
    assert.match(failed.body.error!, /API key 无效/);
    assert.equal((await data()).items.length, before + 3, 'only the two valid AI batches were saved');
  } finally {
    globalThis.fetch = realFetch;
    assert.equal((await call('/api/ai-config', { method: 'DELETE' })).status, 200);
  }
  assert.equal((await data()).aiEnabled, false);
});

test('Health token imports idempotently and cannot read private data', async () => {
  const issued = await post('/api/health/token', { rotate: true });
  const { token, endpoint } = await issued.json() as { token: string; endpoint: string };
  assert.equal(endpoint, `${ORIGIN}/api/health/import`);
  const yesterday = addDays(today, -1);
  const send = (steps: number, auth = `Bearer ${token}`) => call('/api/health/import', { method: 'POST', anonymous: true, headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify({ source: 'apple-shortcuts', days: [{ date: yesterday, steps, sleepH: 7.2 }] }) });
  assert.equal((await send(8000)).status, 200);
  assert.equal((await send(9100)).status, 200);
  const steps = (await data()).items.filter(i => i.kind === 'health' && i.date === yesterday && i.steps !== null);
  assert.equal(steps.length, 1, 're-import updates instead of adding');
  assert.equal(steps[0].kind === 'health' && steps[0].steps, 9100);
  assert.equal((await send(1, 'Bearer wrong-token')).status, 401);
  assert.equal((await call('/api/data', { anonymous: true, headers: { authorization: `Bearer ${token}` } })).status, 401);
  const statusBody = await (await call('/api/health/status')).json() as { tokenConfigured: boolean; lastSyncAt: string };
  assert.ok(statusBody.tokenConfigured && statusBody.lastSyncAt);
});

test('the minimal iOS Shortcut body syncs today with a plain-text reply', async () => {
  const first = await (await post('/api/health/token', { rotate: false })).json() as { token: string };
  const again = await (await post('/api/health/token', { rotate: false })).json() as { token: string };
  assert.equal(again.token, first.token, 'the token stays retrievable until rotated');
  const shortcut = (body: unknown, token = first.token) => call('/api/health/import', { method: 'POST', anonymous: true, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const ok = await shortcut({ steps: ['8,234 步'], weight: '72.4 kg' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type')!, /text\/plain/);
  assert.match(await ok.text(), /已同步.*步数 8,234.*体重：72\.4 kg/);
  const day = (await data()).items.filter(i => i.date === today && i.id.startsWith('health-'));
  assert.ok(day.some(i => i.kind === 'health' && i.steps === 8234) && day.some(i => i.kind === 'metric' && i.value === 72.4));
  const waist = await shortcut({ waist: '82.5 厘米' });
  assert.match(await waist.text(), /腰围：82\.5 cm/);
  assert.ok((await data()).items.some(i => i.kind === 'metric' && i.metric === 'waist' && i.id.startsWith('health-') && i.value === 82.5));
  await shortcut({ waist: '32.5 in' });
  assert.ok((await data()).items.some(i => i.kind === 'metric' && i.metric === 'waist' && i.id.startsWith('health-') && i.value === 82.6), 'inches become cm and overwrite the same day');
  const pounds = await shortcut({ weight: '160 lb' });
  assert.equal(pounds.status, 200);
  assert.ok((await data()).items.some(i => i.kind === 'metric' && i.id.startsWith('health-') && i.date === today && Math.abs(i.value - 72.57) < .01), 'pounds are converted, and re-sync overwrites');
  const ungrouped = await shortcut({ steps: ['4000', '4234'] });
  assert.equal(ungrouped.status, 400);
  assert.match(await ungrouped.text(), /分组方式/);
  assert.match(await (await shortcut({ steps: null })).text(), /今天还没有可同步的数据/);
  assert.match(await (await shortcut({ steps: '', weight: [] })).text(), /收到：steps=""，weight=\[\]/, 'an empty sync shows what arrived');
  assert.match(await (await shortcut({ steps: { Value: 9001, Unit: 'count' } })).text(), /步数 9,001/, 'sample dictionaries are read whatever the key case');
  const zeroWaist = await shortcut({ steps: '19398 count', weight: 0, waist: '' });
  assert.equal(zeroWaist.status, 200, 'an empty metric sent as 0 or blank is skipped');
  const zeroText = await zeroWaist.text();
  assert.doesNotMatch(zeroText, /体重：|腰围：/);
  assert.match(zeroText, /已连上、今天还没有数据：体重、腰围/, 'wired-up fields without data are named, so a new field can be checked');
  assert.match(await (await shortcut({ steps: '5000', basalEnergy: '', sleepStage: '' })).text(), /今天还没有数据：静息能量、睡眠/);
  const sent = (await (await call('/api/health/status')).json() as { fields: { filled: string[]; empty: string[] } }).fields;
  assert.deepEqual(sent, { ...sent, filled: ['步数'], empty: ['静息能量', '睡眠'] }, 'the last sync\'s fields are kept for the Apple 健康 page');
  assert.match(await (await shortcut({ basalEnergy: '7,000 kJ' })).text(), /静息消耗 1673 kcal/, 'a card left on 千焦 is converted');
  assert.match(await (await shortcut({ wristTemp: '96.1 °F' })).text(), /手腕温度 35\.6°C/, 'a card left on 华氏度 is converted');
  const odd = await shortcut({ steps: '6000', wristTemp: '0.4' });
  assert.equal(odd.status, 200, 'an implausible wrist temperature is skipped instead of failing the sync');
  const rotated = await (await post('/api/health/token', { rotate: true })).json() as { token: string };
  assert.notEqual(rotated.token, first.token);
  assert.equal((await shortcut({ steps: 1 })).status, 401, 'the old token stops working');
  assert.equal((await shortcut({ steps: 100 }, rotated.token)).status, 200);
  const viaAddress = (key: string, body: unknown = { steps: '9,876 count' }) => call(`/api/health/import?key=${key}`, { method: 'POST', anonymous: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const keyed = await viaAddress(rotated.token);
  assert.equal(keyed.status, 200, 'the token can ride in the address instead of a header');
  assert.match(await keyed.text(), /已同步.*步数 9,876/);
  assert.equal((await viaAddress(first.token)).status, 401);
  assert.equal((await viaAddress('')).status, 401);
  const wrongMethod = await call(`/api/health/import?key=${rotated.token}`, { anonymous: true });
  assert.equal(wrongMethod.status, 405);
  assert.match(await wrongMethod.text(), /方法选 POST/);
});

test('history import: 60-day batches and Watch workouts with heart rate and effort fit the free database', async () => {
  const back = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
  const days = Array.from({ length: 60 }, (_, i) => ({ date: back(i + 1), weightKg: 74 - i / 100, waistCm: 82 }));
  assert.equal((await post('/api/health/import', { source: 'apple-shortcuts', days })).status, 200);
  const workouts = Array.from({ length: 100 }, (_, i) => ({ id: `TraditionalStrengthTraining|${back(i + 1)} 18:00:00 +1300`, date: back(i + 1), name: '传统力量训练', durationMin: 52.5, avgHr: 128, maxHr: 165, effort: 7, energyKcal: 310 }));
  assert.equal((await post('/api/health/import', { source: 'apple-shortcuts', workouts })).status, 200);
  const watch = (await data()).items.find(i => i.kind === 'workout' && i.date === back(1) && i.id.startsWith('health-'));
  assert.ok(watch && watch.kind === 'workout' && watch.avgHr === 128 && watch.maxHr === 165 && watch.effort === 7 && watch.exerciseId === null);
});

test('the nightly shortcut rebuilds workouts from heart-rate samples and re-syncs without duplicates', async () => {
  const { token } = await (await post('/api/health/token', { rotate: false })).json() as { token: string };
  const sync = (body: unknown) => call(`/api/health/import?key=${token}`, { method: 'POST', anonymous: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const zoneOffset = (iso: string) => { const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Pacific/Auckland', timeZoneName: 'longOffset' }).formatToParts(new Date(iso)); return (parts.find(p => p.type === 'timeZoneName')!.value.replace('GMT', '') || '+00:00'); };
  const local = (hhmm: string) => Date.parse(`${today}T${hhmm}:00${zoneOffset(`${today}T12:00:00Z`)}`);
  const text = (ms: number) => { const d = new Date(ms); const p = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Pacific/Auckland', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d); const g = (t: string) => p.find(x => x.type === t)!.value; return `${g('year')}年${g('month')}月${g('day')}日 ${g('hour')}:${g('minute')}:${g('second')}`; };
  const samples = (until: string) => { const values: number[] = [], times: string[] = [];
    for (let t = local('06:00'); t < local('09:00'); t += 6 * 60000) { values.push(66); times.push(text(t)); }
    for (let t = local('07:00'); t <= local(until); t += 5000) { values.push(120 + (t / 5000) % 20); times.push(text(t)); }
    return { hr: values.join('\n'), hrTime: times.join('\n') }; };
  const first = await sync({ steps: '9000', ...samples('07:30') });
  assert.equal(first.status, 200);
  assert.match(await first.text(), /体能训练：.*30 分钟 · 平均心率 1\d\d · 最高 139/);
  let watch = (await data()).items.filter(i => i.kind === 'workout' && i.id.startsWith('health-detected-'));
  assert.equal(watch.length, 1);
  const id = watch[0].id;
  // The user renames it; a later sync with the full workout keeps the name and the id.
  assert.equal((await post('/api/action', { operationId: crypto.randomUUID(), type: 'edit', id, item: { ...watch[0], exerciseName: '室内步行' } })).status, 200, 'a Watch workout can be renamed');
  assert.equal((await sync(samples('07:45'))).status, 200);
  watch = (await data()).items.filter(i => i.kind === 'workout' && i.id.startsWith('health-detected-'));
  assert.equal(watch.length, 1, 're-sync updates instead of adding');
  assert.ok(watch[0].kind === 'workout' && watch[0].id === id && watch[0].exerciseName === '室内步行' && watch[0].durationMin === 45);
  // The full Health export later brings the real workout: it replaces the guess and later syncs don't guess again.
  const real = { id: `Walking|${today} 07:00`, date: today, name: '室内步行', durationMin: 45, startedAt: new Date(local('07:00')).toISOString(), endedAt: new Date(local('07:45')).toISOString() };
  assert.equal((await post('/api/health/import', { source: 'apple-shortcuts', workouts: [real] })).status, 200);
  assert.equal((await data()).items.filter(i => i.id.startsWith('health-detected-')).length, 0, 'the guess gives way to the real workout');
  assert.equal((await sync(samples('07:45'))).status, 200);
  assert.equal((await data()).items.filter(i => i.id.startsWith('health-detected-')).length, 0);
  // No dense stretch any more (e.g. the earlier guess was wrong): the stale guess is removed.
  const quiet = await sync({ hr: '66\n67', hrTime: `${text(local('06:00'))}\n${text(local('06:06'))}` });
  assert.match(await quiet.text(), /心率 2 条，没认出运动/);
  assert.equal((await data()).items.filter(i => i.id.startsWith('health-detected-')).length, 0);
  assert.match(await (await sync({ hr: '66\n67', hrTime: text(local('06:00')) })).text(), /没有同步：心率收到 2 个数值、1 个时间/);
});

test('a one-click deploy needs only the passphrase: the origin and session secret are derived', async () => {
  const saved = { origin: env.APP_ORIGIN, secret: env.SESSION_SECRET };
  delete env.APP_ORIGIN; delete env.SESSION_SECRET;
  try {
    assert.equal((await call('/api/data')).status, 401, 'a cookie signed with another secret is not accepted');
    const login = await worker.fetch(new Request(ORIGIN + '/api/login', { method: 'POST', body: JSON.stringify({ password }), headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': '192.0.2.77' } }), env as never);
    assert.equal(login.status, 200);
    const fresh = login.headers.get('set-cookie')!.split(';')[0];
    assert.match(login.headers.get('set-cookie')!, /^__Host-kai_session=.*; Secure$/, 'https origin from the request itself');
    const read = await worker.fetch(new Request(ORIGIN + '/api/data', { headers: { cookie: fresh } }), env as never);
    assert.equal(read.status, 200);
    const forged = await worker.fetch(new Request(ORIGIN + '/api/action', { method: 'POST', body: '{}', headers: { cookie: fresh, origin: 'https://evil.example', 'content-type': 'application/json' } }), env as never);
    assert.equal(forged.status, 403, 'cross-site writes are still refused');
    const ai = await worker.fetch(new Request(ORIGIN + '/api/ai-config', { method: 'POST', body: JSON.stringify({ apiKey: 'sk-friend-test-key-0000000000000000', model: 'deepseek-flash' }), headers: { cookie: fresh, origin: ORIGIN, 'content-type': 'application/json' } }), env as never);
    assert.equal(ai.status, 200, 'a key pasted in the app is encrypted with the derived secret');
    await worker.fetch(new Request(ORIGIN + '/api/ai-config', { method: 'DELETE', headers: { cookie: fresh, origin: ORIGIN } }), env as never);
  } finally { env.APP_ORIGIN = saved.origin; env.SESSION_SECRET = saved.secret; }
});

test('a diet plan sent to the AI becomes the plan, calibrated to its daily targets', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).startsWith('https://api.deepseek.com/')) return realFetch(input, init);
    const dietPlan = { name: '她的减脂计划', targets: { training: { kcal: 1700, protein: 110 }, rest: { kcal: 1500, protein: 105 } }, rules: ['少油少盐'],
      meals: [{ slot: '早餐', day: 'both', text: '燕麦 50g、鸡蛋 2 个', kcal: 400, protein: 25 }, { slot: '午餐', day: 'training', text: '米饭 150g、鸡胸 150g', kcal: 700, protein: 50 }, { slot: '晚餐', day: 'training', text: '红薯 200g、虾仁 150g', kcal: 500, protein: 40 }, { slot: '午餐', day: 'both', text: '米饭 100g、鸡胸 150g', kcal: 600, protein: 45 }, { slot: '晚餐', day: 'rest', text: '蔬菜沙拉、豆腐', kcal: 450, protein: 30 }] };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(nextReply ?? { intent: 'diet_plan', reply: '整理好了。', dietPlan }) }, finish_reason: 'stop' }] }));
  }) as typeof fetch;
  let nextReply: object | null = null;
  const before = (await data()).settings;
  try {
    env.DEEPSEEK_API_KEY = 'sk-environment-test-key-0000000000';
    const result = await chat('这是我的饮食计划：（图片）');
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.match(result.body.messages![1].text, /已设置饮食计划「她的减脂计划」.*训练日 1700 kcal.*休息日 1500 kcal/s);
    const after = await data();
    assert.equal(after.settings.dietPlan?.name, '她的减脂计划');
    assert.equal(after.settings.dietPlan?.startDate, today);
    const todayMeals = after.items.filter(i => i.kind === 'food' && i.id.startsWith(`plan-${today}-`));
    assert.equal(todayMeals.length, 3);
    const total = todayMeals.reduce((n, f) => n + (f.kind === 'food' ? f.calories ?? 0 : 0), 0);
    assert.ok(total === 1700 || total === 1500, `today's implied meals add up to a target (${total})`);
    // "I've been on it six days": the AI moves the start back and the days since count the plan's meals.
    const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 5); const sixDays = d.toISOString().slice(0, 10);
    nextReply = { intent: 'plan_start', startDate: sixDays, reply: '好的。' };
    const moved = await chat('这个饮食计划我已经执行六天了');
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.match(moved.body.messages![1].text, /今天是第 6 天/);
    const later = await data();
    assert.equal(later.settings.dietPlan?.startDate, sixDays);
    assert.equal(later.items.filter(i => i.kind === 'food' && i.id.startsWith(`plan-${sixDays}-`)).length, 3, 'the first day now has the plan meals');
  } finally {
    globalThis.fetch = realFetch; delete env.DEEPSEEK_API_KEY;
    // Put the previous settings back for the tests that follow.
    sqlite.prepare("UPDATE profiles SET settings=? WHERE owner='local-owner'").run(JSON.stringify(before));
  }
});

test('unchanged reloads cost one row, day types switch the plan meals, and records are celebrated', async () => {
  const plan = { name: '测试计划', startDate: today, rules: [], targets: { training: { kcal: 2100, protein: 148 }, rest: { kcal: 1900, protein: 143 } },
    meals: [{ slot: '早餐', day: 'both', text: '鸡蛋', kcal: 615, protein: 39 }, { slot: '午餐', day: 'training', text: '牛肉、土豆 350g', kcal: 850, protein: 65 }, { slot: '晚餐', day: 'training', text: '鸡胸', kcal: 635, protein: 44 }, { slot: '午餐', day: 'rest', text: '牛肉、土豆 230g', kcal: 740, protein: 62 }, { slot: '晚餐', day: 'rest', text: '鸡胸', kcal: 545, protein: 42 }] };
  const stored = JSON.parse((sqlite.prepare("SELECT settings FROM profiles WHERE owner='local-owner'").get() as { settings: string }).settings);
  sqlite.prepare("UPDATE profiles SET settings=? WHERE owner='local-owner'").run(JSON.stringify({ ...stored, dietPlan: plan }));
  const first = await data() as Data & { version: string };
  assert.ok(first.version);
  const quiet = await call(`/api/data?v=${encodeURIComponent(first.version)}&today=${today}`);
  assert.deepEqual(await quiet.json(), { unchanged: true });
  assert.ok(!('unchanged' in (await (await call(`/api/data?v=${encodeURIComponent(first.version)}&today=2000-01-01`)).json() as object)), 'a new day always reloads');
  // Training day vs rest day decides today's implied lunch.
  const lunch = async () => (await data()).items.find(i => i.id === `plan-${today}-午餐`);
  assert.equal((await post('/api/action', { operationId: crypto.randomUUID(), type: 'day_type', item: { date: today, dayType: 'rest' } })).status, 200);
  const rest = await lunch();
  assert.ok(rest && rest.kind === 'food' && rest.description.includes('土豆 230g'));
  assert.ok(!('unchanged' in (await (await call(`/api/data?v=${encodeURIComponent(first.version)}&today=${today}`)).json() as object)), 'a write changes the version');
  await post('/api/action', { operationId: crypto.randomUUID(), type: 'day_type', item: { date: today, dayType: 'training' } });
  const training = await lunch();
  assert.ok(training && training.kind === 'food' && training.description.includes('土豆 350g'));
  assert.equal((await data() as Data & { dayTypes: Record<string, string> }).dayTypes[today], 'training');
  // A reported lunch replaces the plan's.
  await chat('午餐：火锅 1200kcal 50g蛋白质');
  const foods = (await data()).items.filter(i => i.kind === 'food' && i.date === today);
  assert.ok(!foods.some(f => f.id === `plan-${today}-午餐`) || !foods.some(f => !f.id.startsWith('plan-') && f.kind === 'food' && f.time === '午餐') , 'never two lunches');
  // Personal records in the chat reply.
  await chat('划船机下拉 50kg 3x10');
  const reply = await post('/api/chat', { id: crypto.randomUUID(), text: '划船机下拉 55kg 3x10' });
  const messages = (await reply.json() as { messages: { text: string }[] }).messages;
  assert.match(messages[1].text, /🏆 新纪录：划船机下拉 估算 1RM/);
});

test('the weekly iCloud backup link reads an export without plan meals; morning metrics arrive from the shortcut', async () => {
  const { url } = await (await post('/api/backup/token', { rotate: false })).json() as { url: string };
  const key = new URL(url).searchParams.get('key')!;
  const exported = await call(`/api/export?key=${key}`, { anonymous: true });
  assert.equal(exported.status, 200);
  const body = await exported.json() as { format: string; items: { id: string }[] };
  assert.equal(body.format, 'kai-training-v1');
  assert.ok(body.items.length > 0 && !body.items.some(i => i.id.startsWith('plan-')));
  assert.equal((await call(`/api/export?key=${'0'.repeat(48)}`, { anonymous: true })).status, 401);
  const rotated = await (await post('/api/backup/token', { rotate: true })).json() as { url: string };
  assert.equal((await call(`/api/export?key=${key}`, { anonymous: true })).status, 401, 'the old link stops working');
  assert.equal((await call(`/api/export?key=${new URL(rotated.url).searchParams.get('key')}`, { anonymous: true })).status, 200);

  const { token } = await (await post('/api/health/token', { rotate: false })).json() as { token: string };
  const sync = (b: unknown) => call(`/api/health/import?key=${token}`, { method: 'POST', anonymous: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const d = today.split('-').map(Number), y = d[0], m = d[1], day = d[2];
  const prev = new Date(Date.UTC(y, m - 1, day - 1)), py = prev.getUTCFullYear(), pm = prev.getUTCMonth() + 1, pd = prev.getUTCDate();
  const res = await sync({
    hrv: '48\n52\n56', restingHeartRate: '54\n58', wristTemp: '35.62 °C',
    sleepStage: '在床上\n核心睡眠\n深度睡眠\n清醒\n快速动眼睡眠',
    sleepStart: `${py}/${pm}/${pd} 下午10:30\n${py}/${pm}/${pd} 下午11:00\n${y}/${m}/${day} 上午1:00\n${y}/${m}/${day} 上午3:00\n${y}/${m}/${day} 上午3:30`,
    sleepEnd: `${y}/${m}/${day} 上午6:30\n${y}/${m}/${day} 上午1:00\n${y}/${m}/${day} 上午3:00\n${y}/${m}/${day} 上午3:30\n${y}/${m}/${day} 上午6:00`,
  });
  assert.equal(res.status, 200, await res.clone().text());
  const text = await res.text();
  for (const part of [/睡眠 6\.5 小时/, /静息心率 54 bpm/, /HRV 52 ms/, /手腕温度 35\.6/]) assert.match(text, part);
  // A card set to "开始日期 是最近 2 天" also sends the night before: only the night that ended today counts,
  // including its stages that ended before midnight.
  const early = new Date(Date.UTC(y, m - 1, day - 2)), ey = early.getUTCFullYear(), em = early.getUTCMonth() + 1, ed = early.getUTCDate();
  const twoNights = await (await sync({
    sleepStage: '核心睡眠\n核心睡眠\n深度睡眠\n核心睡眠',
    sleepStart: `${ey}/${em}/${ed} 下午11:00\n${py}/${pm}/${pd} 下午11:00\n${py}/${pm}/${pd} 下午11:50\n${y}/${m}/${day} 上午3:00`,
    sleepEnd: `${py}/${pm}/${pd} 上午7:00\n${py}/${pm}/${pd} 下午11:50\n${y}/${m}/${day} 上午3:00\n${y}/${m}/${day} 上午6:00`,
  })).text();
  assert.match(twoNights, /睡眠 7 小时/);
  const energy = await (await sync({ basalEnergy: '1712.4 kcal', kcal: ['120', '85.5', '310'].join('\n') })).text();
  assert.match(energy, /静息消耗 1712 kcal/); assert.match(energy, /活动消耗 516 kcal/, 'daily active energy adds up the workout-detection samples');
});

test('a photo goes to the model and a Watch workout screenshot becomes one activity record', async () => {
  const realFetch = globalThis.fetch; const bodies: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).startsWith('https://api.deepseek.com/')) return realFetch(input, init);
    bodies.push(String(init?.body));
    // First attempt refused (as if JSON mode were not allowed with images); the retry answers inside a code fence.
    if (bodies.length === 1) return new Response('{"error":{"message":"unsupported"}}', { status: 400 });
    const content = '```json\n' + JSON.stringify({ intent: 'records', reply: '看到一次力量训练。', records: [{ kind: 'activity', date: today, name: '传统力量训练', durationMin: 52, avgHr: 128, maxHr: 165, effort: 7, energyKcal: 310 }] }) + '\n```';
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
  }) as typeof fetch;
  try {
    env.DEEPSEEK_API_KEY = 'sk-environment-test-key-0000000000';
    const photo = 'data:image/jpeg;base64,' + Buffer.from('not-really-a-jpeg').toString('base64');
    const response = await post('/api/chat', { id: crypto.randomUUID(), text: '', images: [photo] });
    assert.equal(response.status, 200);
    assert.equal(bodies.length, 2, 'retried once without JSON mode');
    const retry = JSON.parse(bodies[1]) as { response_format?: unknown; messages: { content: unknown }[] };
    assert.equal(retry.response_format, undefined);
    assert.ok(Array.isArray(retry.messages[1].content) && (retry.messages[1].content as { type: string; image_url?: { url: string } }[]).some(part => part.type === 'image_url' && part.image_url?.url === photo));
    const body = await data();
    const watch = body.items.find(i => i.kind === 'workout' && i.session === 'Apple Watch' && i.date === today && !i.id.startsWith('health-'));
    assert.ok(watch && watch.kind === 'workout' && watch.avgHr === 128 && watch.effort === 7 && watch.exerciseId === null && !watch.trainingSessionId, 'no live session is started for a watch summary');
    assert.ok(body.messages.some(m => m.role === 'user' && m.text === '[照片 1 张]'), 'the photo itself is not stored');
    assert.equal((await post('/api/chat', { id: crypto.randomUUID(), text: '', images: ['data:text/html;base64,PHA+'] })).status, 400);
    delete env.DEEPSEEK_API_KEY;
    assert.equal((await post('/api/chat', { id: crypto.randomUUID(), text: '', images: [photo] })).status, 409, 'photos need the AI');
  } finally { globalThis.fetch = realFetch; delete env.DEEPSEEK_API_KEY; }
});

test('renaming keeps history and merging redirects future logs', async () => {
  await chat('坐姿划船 40kg 3x10');
  await chat('划船 45kg 3x8');
  let items = (await data()).items;
  const seated = items.find(i => i.kind === 'workout' && i.exerciseName === '坐姿划船')!;
  const row = items.find(i => i.kind === 'workout' && i.exerciseName === '划船')!;
  assert.ok(seated.kind === 'workout' && row.kind === 'workout' && seated.exerciseId !== row.exerciseId);
  const rename = await post('/api/action', { operationId: crypto.randomUUID(), type: 'rename_exercise', item: { exerciseId: row.exerciseId, unit: 'kg', name: '杠铃划船' } });
  assert.equal(rename.status, 200);
  items = (await data()).items;
  assert.equal(items.find(i => i.id === row.id)!.kind === 'workout' && (items.find(i => i.id === row.id) as typeof row).exerciseName, '杠铃划船');
  await chat('划船 45kg 8次');
  items = (await data()).items;
  assert.ok(items.filter(i => i.kind === 'workout' && i.exerciseId === row.exerciseId).every(i => i.kind === 'workout' && i.exerciseName === '杠铃划船'), 'the old name still lands in the renamed exercise');
  const merge = await post('/api/action', { operationId: crypto.randomUUID(), type: 'rename_exercise', item: { exerciseId: row.exerciseId, unit: 'kg', name: '坐姿划船' } });
  assert.match((await merge.json() as { message: string }).message, /合并/);
  items = (await data()).items;
  assert.equal(items.filter(i => i.kind === 'workout' && i.exerciseId === row.exerciseId).length, 0);
  await chat('划船 45kg 8次');
  items = (await data()).items;
  assert.equal(items.filter(i => i.kind === 'workout' && i.exerciseId === row.exerciseId).length, 0, 'logs under the merged name follow the alias');
  assert.ok(items.filter(i => i.kind === 'workout' && i.exerciseId === seated.exerciseId).length >= 4);
});

test('the weekly AI review is generated once per set of statistics', async () => {
  const realFetch = globalThis.fetch; let calls = 0; let prompt = '';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).startsWith('https://api.deepseek.com/')) return realFetch(input, init);
    calls++; prompt = String(init?.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: '**本周**卧推保持住了。' }, finish_reason: 'stop' }] }));
  }) as typeof fetch;
  try {
    env.DEEPSEEK_API_KEY = 'sk-environment-test-key-0000000000';
    assert.equal((await data()).aiEnabled, true, 'an environment key needs no setup');
    assert.deepEqual(await (await call(`/api/weekly/ai?weekEnd=${today}`)).json(), { text: null, stale: false });
    const first = await (await post('/api/weekly/ai', { weekEnd: today })).json() as { text: string };
    assert.equal(first.text, '本周卧推保持住了。');
    assert.ok(!prompt.includes('sk-environment') && prompt.includes('thisWeek'));
    const second = await (await post('/api/weekly/ai', { weekEnd: today })).json() as { cached?: boolean };
    assert.equal(second.cached, true); assert.equal(calls, 1, 'no second paid call for the same statistics');
    delete env.DEEPSEEK_API_KEY;
    await chat('深蹲 90kg 3次');
    assert.equal((await (await call(`/api/weekly/ai?weekEnd=${today}`)).json() as { stale: boolean }).stale, true);
  } finally { globalThis.fetch = realFetch; delete env.DEEPSEEK_API_KEY; }
});

test('phase changes keep history, weekly reports persist, and the cron handler runs', async () => {
  const start = addDays(today, -30);
  const current = (await data()).settings;
  assert.equal((await post('/api/action', { operationId: crypto.randomUUID(), type: 'settings', settings: { ...current, phase: 'fat_loss', phaseStart: start } })).status, 200);
  const after = (await data()).settings;
  assert.equal((await post('/api/action', { operationId: crypto.randomUUID(), type: 'settings', settings: { ...after, phase: 'lean_gain' } })).status, 200);
  const settings = (await data()).settings;
  assert.equal(settings.phase, 'lean_gain');
  assert.equal(settings.phaseStart, today, 'a new phase without a new date starts today');
  assert.deepEqual(settings.phaseHistory!.filter(p => p.startDate >= start).map(p => p.phase), ['fat_loss', 'lean_gain']);
  const corrected = await post('/api/action', { operationId: crypto.randomUUID(), type: 'settings', settings: { ...settings, phaseStart: addDays(today, -2) } });
  assert.equal(corrected.status, 200, await corrected.clone().text());
  const fixedHistory = (await data()).settings.phaseHistory!.filter(p => p.startDate >= start);
  assert.deepEqual(fixedHistory.map(p => [p.phase, p.startDate]), [['fat_loss', start], ['lean_gain', addDays(today, -2)]], 'correcting the start date moves the entry instead of adding one');
  const future = await post('/api/action', { operationId: crypto.randomUUID(), type: 'settings', settings: { ...(await data()).settings, phaseStart: addDays(today, 3) } });
  assert.equal(future.status, 400);
  const weekly = await (await call('/api/weekly')).json() as { report: { period: { end: string } } };
  assert.ok(weekly.report.period.end);
  sqlite.exec('DELETE FROM weekly_reports');
  const waits: Promise<unknown>[] = [];
  await worker.scheduled({} as ScheduledController, env as never, { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} } as unknown as ExecutionContext);
  await Promise.all(waits);
  assert.ok((sqlite.prepare('SELECT COUNT(*) AS n FROM weekly_reports').get() as { n: number }).n >= 1);
});

test('edit, undo and restore a record', async () => {
  const workout = (await data()).items.find(i => i.kind === 'workout' && i.exerciseName === '深蹲')!;
  assert.ok(workout && workout.kind === 'workout');
  const edited = { ...workout, sets: workout.sets.map((s, i) => i === 0 ? { ...s, reps: 6 } : s) };
  assert.equal((await post('/api/action', { operationId: crypto.randomUUID(), type: 'edit', id: workout.id, item: edited })).status, 200);
  const renamed = { ...workout, exerciseName: '前蹲' };
  assert.equal((await post('/api/action', { operationId: crypto.randomUUID(), type: 'edit', id: workout.id, item: renamed })).status, 400, 'exercise identity is fixed');
  assert.equal((await post('/api/action', { operationId: crypto.randomUUID(), type: 'undo', id: workout.id })).status, 200);
  assert.ok(!(await data()).items.some(i => i.id === workout.id));
  assert.equal((await post('/api/action', { operationId: crypto.randomUUID(), type: 'restore', id: workout.id })).status, 200);
  const restored = (await data()).items.find(i => i.id === workout.id)!;
  assert.equal(restored.kind === 'workout' && restored.sets[0].reps, 6);
});

function png(extra = 0) {
  const bytes = new Uint8Array(8 + 25 + 12 + 4 + extra + 12); const view = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); view.setUint32(8, 13); bytes.set(new TextEncoder().encode('IHDR'), 12); view.setUint32(16, 1); view.setUint32(20, 1);
  view.setUint32(33, 4 + extra); bytes.set(new TextEncoder().encode('IDAT'), 37); bytes.set(new TextEncoder().encode('IEND'), bytes.length - 8);
  return bytes;
}

test('photos upload privately and a full backup restores records and originals', async () => {
  const form = new FormData(); const operationId = crypto.randomUUID();
  form.set('operationId', operationId); form.set('date', today); form.set('kind', 'body_front'); form.set('file', new File([png(300_000)], 'front.png', { type: 'image/png' }));
  assert.equal((await call('/api/photos', { method: 'POST', body: form })).status, 200);
  const photo = await call(`/api/photos/${operationId}`);
  assert.equal(photo.status, 200);
  const original = new Uint8Array(await photo.arrayBuffer());
  assert.equal(original.byteLength, png(300_000).byteLength);

  const exported = await (await call('/api/export?format=json')).json() as { format: string; items: { id: string; kind: string }[]; messages: unknown[]; sessions: unknown[]; settings: unknown };
  assert.equal(exported.format, 'kai-training-v1');
  assert.ok(!exported.items.some(i => i.id.startsWith('plan-')), 'implied plan meals are never exported');
  const records = exported.items.filter(i => i.kind !== 'photo');
  const photoRecord = exported.items.find(i => i.kind === 'photo')!;
  sqlite.exec('DELETE FROM records; DELETE FROM messages; DELETE FROM training_sessions; DELETE FROM photo_chunks; DELETE FROM photo_objects; DELETE FROM operations;');
  assert.equal((await data()).items.filter(i => !i.id.startsWith('plan-')).length, 0, 'only the implied plan meals remain');
  for (let i = 0; i < Math.max(records.length, exported.messages.length); i += 100) {
    const response = await post('/api/restore', { operationId: crypto.randomUUID(), items: records.slice(i, i + 100), messages: exported.messages.slice(i, i + 100), sessions: i ? [] : exported.sessions, ...(i ? {} : { settings: exported.settings }) });
    assert.equal(response.status, 200, await response.clone().text());
  }
  const restoreForm = new FormData();
  restoreForm.set('operationId', crypto.randomUUID()); restoreForm.set('record', JSON.stringify(photoRecord)); restoreForm.set('file', new File([original], 'x.png', { type: 'image/png' }));
  assert.equal((await call('/api/restore/photo', { method: 'POST', body: restoreForm })).status, 200);
  const tampered = new FormData();
  tampered.set('operationId', crypto.randomUUID()); tampered.set('record', JSON.stringify({ ...photoRecord, fileRef: 'photos/someone-else/abc' })); tampered.set('file', new File([original], 'x.png', { type: 'image/png' }));
  assert.equal((await call('/api/restore/photo', { method: 'POST', body: tampered })).status, 400);
  const after = await data();
  assert.equal(after.items.filter(i => !i.id.startsWith('plan-')).length, records.length + 1);
  assert.equal(after.messages.length, Math.min(150, exported.messages.length));
  assert.deepEqual(new Uint8Array(await (await call(`/api/photos/${operationId}`)).arrayBuffer()), original);
  const repeat = await post('/api/restore', { operationId: crypto.randomUUID(), items: records.slice(0, 100) });
  assert.equal(repeat.status, 200);
  assert.equal((await data()).items.filter(i => !i.id.startsWith('plan-')).length, records.length + 1, 'restoring twice does not duplicate');
});

test('logout revokes the session', async () => {
  assert.equal((await post('/api/logout', {})).status, 200);
  assert.equal((await call('/api/data')).status, 401);
});

test('report the heaviest D1 query count per endpoint', () => {
  const rows = [...heaviest].sort((a, b) => b[1] - a[1]);
  console.log('D1 queries (max per request):', rows.map(([k, n]) => `${k}=${n}`).join(', '));
  assert.ok(rows[0][1] <= 50);
});
