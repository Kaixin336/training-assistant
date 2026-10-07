import { env, sessionSecret } from './runtime-env';
const encoder = new TextEncoder();
const lifetime = 30 * 86400;
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
function decode(text: string) { const value = atob(text.replaceAll('-', '+').replaceAll('_', '/')); return Uint8Array.from(value, c => c.charCodeAt(0)); }
async function hmac(value: string) { const key = await crypto.subtle.importKey('raw', encoder.encode(await sessionSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))); }
async function hash(value: string) { return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))); }
async function sameSecret(left: string, right: string) { const [a, b] = await Promise.all([hmac(left), hmac(right)]); let difference = 0; for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i]; return difference === 0; }
export class AuthError extends Error { constructor(message: string, readonly status: number) { super(message); } }
/** The app's own origin: APP_ORIGIN when configured, otherwise the address this request was served from. */
const appOrigin = (request: Request) => new URL(env.APP_ORIGIN || request.url).origin;
function configured(request: Request) {
  if (!env.OWNER_ACCESS_KEY || env.OWNER_ACCESS_KEY.length < 20 || (env.SESSION_SECRET && env.SESSION_SECRET.length < 32)) throw new AuthError('服务尚未完成私人访问配置：访问口令至少 20 个字符。', 503);
  const origin = new URL(appOrigin(request));
  if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new AuthError('私人训练记录需要 HTTPS。', 503);
}
export function sameOrigin(request: Request) { try { return new URL(request.headers.get('origin') || '').origin === appOrigin(request); } catch { return false; } }
const cookieName = (request: Request) => appOrigin(request).startsWith('https:') ? '__Host-kai_session' : 'kai_session';
async function signedSession(request: Request): Promise<{ sid: string; expires: number } | null> {
  configured(request);
  const name = cookieName(request);
  const token = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!token || token.length > 1024) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !await sameSecret(parts[1], encode(await hmac(parts[0])))) return null;
  let value: {sid:string;expires:number};
  try {
    value = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    if (typeof value.sid !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.sid) || !Number.isSafeInteger(value.expires) || value.expires <= Date.now()) return null;
  } catch { return null; }
  const session = await env.DB.prepare('SELECT expires_at FROM auth_sessions WHERE id_hash=?').bind(await hash(value.sid)).first<{ expires_at: number }>();
  return session && session.expires_at === value.expires ? value : null;
}
export async function isAuthenticated(request: Request) { return !!await signedSession(request); }
export async function requireOwner(request: Request) {
  if (!await isAuthenticated(request)) throw new AuthError('请先输入访问口令，打开你的私人训练记录。', 401);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !sameOrigin(request)) throw new AuthError('请从训练记录页面提交此操作。', 403);
  return 'local-owner';
}
function cookie(request: Request, value: string, maxAge: number) { return `${cookieName(request)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${appOrigin(request).startsWith('https:') ? '; Secure' : ''}`; }
function json(value: unknown, status = 200, headers: Record<string, string> = {}) { return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ...headers } }); }
export async function session(request: Request) { return json({ authenticated: await isAuthenticated(request) }); }
export async function login(request: Request) {
  configured(request);
  if (!sameOrigin(request)) return json({ error: '请从训练记录页面登录。' }, 403);
  const now = Date.now();
  // CF-Connecting-IP is overwritten at Cloudflare's trusted edge. Local dev shares one bucket.
  const ip = await hash(`${await sessionSecret()}:${request.headers.get('cf-connecting-ip') || 'local'}`);
  const row = await env.DB.prepare('INSERT INTO auth_attempts (ip_hash,attempts,window_end) VALUES (?,1,?) ON CONFLICT(ip_hash) DO UPDATE SET attempts=CASE WHEN window_end<=? THEN 1 ELSE attempts+1 END, window_end=CASE WHEN window_end<=? THEN excluded.window_end ELSE window_end END RETURNING attempts,window_end').bind(ip, now + 15 * 60000, now, now).first<{ attempts: number; window_end: number }>();
  if (!row || row.attempts > 10) return json({ error: '尝试次数过多，请 15 分钟后重试。' }, 429, { 'Retry-After': '900' });
  let password: unknown;
  try { const input = await request.json() as { password?: unknown }; password = input.password; } catch { return json({ error: '请填写访问口令。' }, 400); }
  if (typeof password !== 'string' || password.length > 1024 || !await sameSecret(password, env.OWNER_ACCESS_KEY)) return json({ error: '访问口令不正确。' }, 401);
  const value = { sid: encode(crypto.getRandomValues(new Uint8Array(32))), expires: now + lifetime * 1000 };
  await env.DB.batch([env.DB.prepare('DELETE FROM auth_attempts WHERE ip_hash=? OR window_end<=?').bind(ip, now), env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').bind(now), env.DB.prepare('INSERT INTO auth_sessions VALUES (?,?)').bind(await hash(value.sid), value.expires)]);
  const payload = encode(encoder.encode(JSON.stringify(value)));
  return json({ authenticated: true }, 200, { 'Set-Cookie': cookie(request, `${payload}.${encode(await hmac(payload))}`, lifetime) });
}
export async function logout(request: Request) {
  configured(request);
  if (!sameOrigin(request)) return json({ error: '请从训练记录页面退出。' }, 403);
  const value = await signedSession(request);
  if (value) await env.DB.prepare('DELETE FROM auth_sessions WHERE id_hash=?').bind(await hash(value.sid)).run();
  return json({ authenticated: false }, 200, { 'Set-Cookie': cookie(request, '', 0) });
}
