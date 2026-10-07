import {healthOwner,healthTokenFrom} from '@/lib/health-service';
import {parseHealthImport} from '@/lib/health-import';
import {describeSimpleBody,isSimpleHealthBody,simpleHealthPayload} from '@/lib/health-simple';
import {detectedWorkoutPlan} from '@/lib/detected-workouts';
import {todayNZ,logItemSchema,itemSummary,type LogItem,type Workout} from '@/lib/domain';
import {db,json,failure,AppError,ensureProfile} from '@/lib/server-store';
// Shortcuts show the response as a notification, so token (non-browser) callers get plain text.
const text=(body:string,status=200)=>new Response(body,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
// "获取 URL 内容" defaults to GET; say what to change instead of a bare 405.
export async function GET(){return text('地址是对的，还差一步：在“获取 URL 内容”里展开，方法选 POST，请求体选 JSON。',405);}
export async function POST(request:Request){const fromShortcut=healthTokenFrom(request)!==null;try{
 const user=await healthOwner(request);const today=todayNZ();
 let body:unknown;try{body=await request.json();}catch{throw new AppError('请求体不是 JSON。在“获取 URL 内容”里把请求体设为 JSON。');}
 const simple=isSimpleHealthBody(body)?body:null;
 const parsed=parseHealthImport(simple?simpleHealthPayload(simple,today):body,today);
 // Workouts rebuilt from the day's heart-rate samples (Shortcuts cannot read workouts directly).
 const detected=simple?await detectedWorkoutPlan(user,simple,today):null;
 if(parsed.items.length>400)throw new AppError('一次最多导入 400 条，请缩小导出日期范围，建议最近 7 天。',413);
 const items=[...parsed.items,...(detected?.items??[])].map(i=>logItemSchema.parse(i)) as LogItem[];if(items.some(i=>!i.id.startsWith('health-')))throw new AppError('健康记录标识无效。');
 await ensureProfile(user);const now=new Date().toISOString(),statements=[];
 const remove=[...(detected?.remove??[])];
 // Real workouts from the Health export replace heart-rate guesses covering the same time.
 const real=simple?[]:items.filter((i):i is Workout=>i.kind==='workout'&&!!i.startedAt&&!!i.endedAt);
 if(real.length){
  // Range on the primary key (owner,id) instead of LIKE, so D1 reads only the guesses.
  const guesses=await db().prepare("SELECT payload FROM records WHERE owner=? AND id>='health-detected-' AND id<'health-detected.' AND deleted=0").bind(user).all<{payload:string}>();
  for(const guess of guesses.results.map(r=>JSON.parse(r.payload) as Workout))if(guess.startedAt&&guess.endedAt&&real.some(w=>Date.parse(w.startedAt!)<Date.parse(guess.endedAt!)&&Date.parse(guess.startedAt!)<Date.parse(w.endedAt!)))remove.push(guess.id);
 }
 for(let index=0;index<remove.length;index+=90){const part=remove.slice(index,index+90);statements.push(db().prepare(`DELETE FROM records WHERE owner=? AND id IN (${part.map(()=>'?').join(',')})`).bind(user,...part));}
 for(let index=0;index<items.length;index+=10){const part=items.slice(index,index+10);statements.push(db().prepare('INSERT INTO records (owner,id,kind,date,payload,deleted,updated_at) VALUES '+part.map(()=>'(?,?,?,?,?,0,?)').join(',')+' ON CONFLICT(owner,id) DO UPDATE SET kind=excluded.kind,date=excluded.date,payload=excluded.payload,updated_at=excluded.updated_at WHERE records.deleted=0').bind(...part.flatMap(item=>[user,item.id,item.kind,item.date,JSON.stringify(item),now])));}
 statements.push(db().prepare('INSERT INTO health_sync (owner,last_sync_at,item_count) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET last_sync_at=excluded.last_sync_at,item_count=excluded.item_count').bind(user,now,items.length));
 await db().batch(statements);
 // TEMP (2026-10-08): show the first heart-rate line while the real-device format is confirmed.
 const firstHr=simple?String(simple.hrTime??simple.hrAt??'').split('\n')[0].slice(0,40):'';
 const hrLine=detected?`\n心率 ${detected.heartRates} 条${detected.items.length?'':'，没认出运动'}${firstHr?`（时间格式：${firstHr}）`:''}`:'';
 if(fromShortcut)return text((items.length?`已同步 ${today.slice(5).replace('-','/')}：${items.map(itemSummary).join('，')}`:`已连接，但今天还没有可同步的数据。${simple?`\n收到：${describeSimpleBody(simple)}\n全是空的可能是：今天（从零点算起）还没有数据、字段连错了卡片，或快捷指令没有健康读取权限。`:''}`)+hrLine);
 return json({imported:items.length,warnings:parsed.warnings,source:parsed.source,lastSyncAt:now});
}catch(e){
 // Data problems are the shortcut's to fix (400); everything else keeps its own status.
 if(e instanceof Error&&e.name==='HealthImportError')return fromShortcut?text(`没有同步：${e.message}`,400):json({error:e.message},400);
 const failed=failure(e);
 return fromShortcut?text(`没有同步：${(await failed.json() as {error?:string}).error??'未知错误'}`,failed.status):failed;
}}
