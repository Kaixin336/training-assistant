import { env as bindings } from 'cloudflare:workers';
export interface RuntimeEnv {
  DB: D1Database;
  BUCKET?: R2Bucket;
  ASSETS: Fetcher;
  /** Optional: defaults to the address the app is served from. */
  APP_ORIGIN?: string;
  OWNER_ACCESS_KEY: string;
  /** Optional: derived from OWNER_ACCESS_KEY when not set (one secret is enough for a one-click deploy). */
  SESSION_SECRET?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
}
export const env = bindings as unknown as RuntimeEnv;

const derived = new Map<string, Promise<string>>();
/** Signs sessions and derives encryption keys. Changing the passphrase without a SESSION_SECRET signs everyone out. */
export function sessionSecret(): Promise<string> {
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= 32) return Promise.resolve(env.SESSION_SECRET);
  const passphrase = env.OWNER_ACCESS_KEY ?? "";
  let secret = derived.get(passphrase);
  if (!secret) {
    secret = crypto.subtle.digest("SHA-256", new TextEncoder().encode(`kai-training-session:${passphrase}`)).then(bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join(""));
    derived.set(passphrase, secret);
  }
  return secret;
}
