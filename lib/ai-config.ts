import {env,sessionSecret} from './runtime-env';
const encoder=new TextEncoder();
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
const decode=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
async function key(purpose:string){const secret=await sessionSecret();const material=await crypto.subtle.digest('SHA-256',encoder.encode(`kai-training-${purpose}:`+secret));return crypto.subtle.importKey('raw',material,'AES-GCM',false,['encrypt','decrypt']);}
/** Private values (API key, Health token) are AES-GCM encrypted with a key derived from SESSION_SECRET. */
export async function sealSecret(purpose:string,plain:string){const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(purpose),encoder.encode(plain)));return {iv:encode(iv),cipher:encode(cipher)};}
export async function openSecret(purpose:string,stored:{iv:string;cipher:string}){return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(stored.iv)},await key(purpose),decode(stored.cipher)));}
export async function readPrivate<T>(user:string,name:string):Promise<T|null>{const row=await env.DB.prepare('SELECT payload FROM private_config WHERE owner=? AND key=?').bind(user,name).first<{payload:string}>();return row?JSON.parse(row.payload) as T:null;}
export function writePrivate(user:string,name:string,value:unknown){return env.DB.prepare('INSERT INTO private_config (owner,key,payload,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner,key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').bind(user,name,JSON.stringify(value),new Date().toISOString());}

export async function getAiConfig(user='local-owner'):Promise<{apiKey:string;model:string}|null> {
 if(env.DEEPSEEK_API_KEY)return {apiKey:env.DEEPSEEK_API_KEY,model:env.DEEPSEEK_MODEL||'deepseek-flash'};
 const stored=await readPrivate<{iv:string;cipher:string;model:string}>(user,'deepseek');if(!stored)return null;
 return {apiKey:await openSecret('ai',stored),model:stored.model};
}
export async function hasAiConfig(user='local-owner'){return !!(await getAiConfig(user));}
export async function saveAiConfig(user:string,apiKey:string,model:string){await writePrivate(user,'deepseek',{...await sealSecret('ai',apiKey),model}).run();}
export async function deleteAiConfig(user:string){await env.DB.prepare('DELETE FROM private_config WHERE owner=? AND key=?').bind(user,'deepseek').run();}
