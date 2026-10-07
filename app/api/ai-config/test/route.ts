import {owner,json,failure} from '@/lib/server-store';
import {callDeepSeek} from '@/lib/ai';
export async function POST(request:Request){try{await owner(request);const reply=await callDeepSeek([{role:'system',content:'Reply only with the word OK.'},{role:'user',content:'Connection test.'}],false,24);return json({ok:!!reply,message:'DeepSeek 连接正常。'});}catch(e){return failure(e);}}
