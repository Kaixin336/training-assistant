import {z} from 'zod';
import {owner,json,failure,db} from '@/lib/server-store';
import {tokenHash} from '@/lib/health-service';
import {openSecret,readPrivate,sealSecret,writePrivate} from '@/lib/ai-config';
const input=z.object({rotate:z.boolean().default(false)}).strict();
// The token is kept encrypted so the settings page can show it again; only its hash authorises imports.
export async function POST(request:Request){try{
 const user=await owner(request);const {rotate}=input.parse(await request.json().catch(()=>({})));
 const endpoint=new URL('/api/health/import',request.url).toString();
 const stored=rotate?null:await readPrivate<{iv:string;cipher:string}>(user,'health-token');
 if(stored)return json({token:await openSecret('health',stored),endpoint});
 const token=Array.from(crypto.getRandomValues(new Uint8Array(24))).map(n=>n.toString(16).padStart(2,'0')).join('');
 await db().batch([
  db().prepare('INSERT INTO health_sync (owner,token_hash,item_count) VALUES (?,?,0) ON CONFLICT(owner) DO UPDATE SET token_hash=excluded.token_hash').bind(user,await tokenHash(token)),
  writePrivate(user,'health-token',await sealSecret('health',token)),
 ]);
 return json({token,endpoint});
}catch(e){return failure(e);}}
