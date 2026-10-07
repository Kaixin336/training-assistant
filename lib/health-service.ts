import {env} from './runtime-env';
import {owner,AppError} from './server-store';
export async function tokenHash(token:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(n=>n.toString(16).padStart(2,'0')).join('');}
// Shortcuts send the token as a Bearer header or, to save a setup step, as ?key= in the import address.
export function healthTokenFrom(request:Request){
 const authorization=request.headers.get('authorization');
 if(authorization)return authorization.startsWith('Bearer ')?authorization.slice(7):'';
 return new URL(request.url).searchParams.get('key');
}
export async function healthOwner(request:Request){
 const token=healthTokenFrom(request);if(token===null)return owner(request);
 if(!token||token.length>200)throw new AppError('健康同步令牌无效。',401);
 const hash=await tokenHash(token);const row=await env.DB.prepare('SELECT owner FROM health_sync WHERE token_hash=?').bind(hash).first<{owner:string}>();
 if(!row)throw new AppError('健康同步令牌无效或已撤销。',401);return row.owner;
}
