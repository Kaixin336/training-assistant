import {z} from 'zod';
import {owner,json,failure,db,AppError} from '@/lib/server-store';
import {tokenHash} from '@/lib/health-service';
import {openSecret,readPrivate,sealSecret,writePrivate} from '@/lib/ai-config';
const input=z.object({rotate:z.boolean().default(false)}).strict();
/**
 * A read-only link for the weekly iCloud backup Shortcut. It is separate from the Health token
 * (which can only write Health data), so rotating one never breaks the other.
 */
export async function POST(request:Request){try{
 const user=await owner(request);const {rotate}=input.parse(await request.json().catch(()=>({})));
 const base=new URL('/api/export',request.url).toString();
 const stored=rotate?null:await readPrivate<{iv:string;cipher:string}>(user,'backup-token');
 if(stored)return json({url:`${base}?key=${await openSecret('backup',stored)}`});
 const token=Array.from(crypto.getRandomValues(new Uint8Array(24))).map(n=>n.toString(16).padStart(2,'0')).join('');
 await db().batch([writePrivate(user,'backup-token',await sealSecret('backup',token)),writePrivate(user,'backup-token-hash',await tokenHash(token))]);
 return json({url:`${base}?key=${token}`});
}catch(e){return failure(e);}}

/** Owner of a backup link, or a 401. */
export async function backupOwner(key:string){
 if(!/^[0-9a-f]{48}$/.test(key))throw new AppError('备份链接无效。',401);
 const row=await db().prepare("SELECT owner FROM private_config WHERE key='backup-token-hash' AND payload=?").bind(JSON.stringify(await tokenHash(key))).first<{owner:string}>();
 if(!row)throw new AppError('备份链接无效或已更换。',401);
 return row.owner;
}
