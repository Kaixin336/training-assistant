/** Fired when the server no longer accepts the session cookie. */
export const AUTH_LOST = "kai-auth-lost";
export class AuthRequired extends Error {}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const json = typeof init.body === "string";
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init, headers: { ...(json ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  if (response.status === 401) {
    window.dispatchEvent(new Event(AUTH_LOST));
    throw new AuthRequired("登录已过期，请重新输入访问口令。");
  }
  let body: T & { error?: string };
  try { body = await response.json() as T & { error?: string }; }
  catch { throw new Error(response.ok ? "服务器返回的内容无法识别，请刷新。" : `请求失败（${response.status}），请检查网络后重试。`); }
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `请求失败（${response.status}），请稍后重试。`);
  return body;
}

export const postJson = <T>(path: string, value: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(value) });

export function storageGet(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
export function storageSet(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* Private mode: preference is not remembered. */ } }
