import {healthOwner,healthTokenFrom} from '@/lib/health-service';
import {parseHealthImport} from '@/lib/health-import';
import {describeSimpleBody,fieldReport,isSimpleHealthBody,simpleHealthPayload} from '@/lib/health-simple';
import {todayNZ,logItemSchema,itemSummary,type LogItem} from '@/lib/domain';
import {db,json,failure,AppError,ensureProfile} from '@/lib/server-store';
// Shortcuts show the response as a notification, so token (non-browser) callers get plain text.
const text=(body:string,status=200)=>new Response(body,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
// "获取 URL 内容" defaults to GET; say what to change instead of a bare 405.
export async function GET(){return text('地址是对的，还差一步：在“获取 URL 内容”里展开，方法选 POST，请求体选 JSON。',405);}
export async function POST(request:Request){const fromShortcut=healthTokenFrom(request)!==null;let owner:string|null=null,sent:Record<string,unknown>|null=null;try{
 const user=await healthOwner(request);owner=user;const today=todayNZ();
 let body:unknown;try{body=await request.json();}catch{throw new AppError('请求体不是 JSON。在“获取 URL 内容”里把请求体设为 JSON。');}
 const simple=isSimpleHealthBody(body)?body:null;sent=simple;
 // Problems with one optional field (a miswired card) are collected here instead of failing the sync.
 const warnings:string[]=[];
 const parsed=parseHealthImport(simple?simpleHealthPayload(simple,today,warnings):body,today);
 if(parsed.items.length>400)throw new AppError('一次最多导入 400 条，请缩小导出日期范围，建议最近 7 天。',413);
 const items=parsed.items.map(i=>logItemSchema.parse(i)) as LogItem[];if(items.some(i=>!i.id.startsWith('health-')))throw new AppError('健康记录标识无效。');
 await ensureProfile(user);const now=new Date().toISOString(),statements=[];
 for(let index=0;index<items.length;index+=10){const part=items.slice(index,index+10);statements.push(db().prepare('INSERT INTO records (owner,id,kind,date,payload,deleted,updated_at) VALUES '+part.map(()=>'(?,?,?,?,?,0,?)').join(',')+' ON CONFLICT(owner,id) DO UPDATE SET kind=excluded.kind,date=excluded.date,payload=excluded.payload,updated_at=excluded.updated_at WHERE records.deleted=0').bind(...part.flatMap(item=>[user,item.id,item.kind,item.date,JSON.stringify(item),now])));}
 statements.push(db().prepare('INSERT INTO health_sync (owner,last_sync_at,item_count) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET last_sync_at=excluded.last_sync_at,item_count=excluded.item_count').bind(user,now,items.length));
 // Which fields the Shortcut sent (with or without data), shown on the Apple 健康 page to check the setup.
 const report=simple?fieldReport(simple):null;
 if(report)statements.push(db().prepare("INSERT INTO private_config (owner,key,payload,updated_at) VALUES (?,'health-fields',?,?) ON CONFLICT(owner,key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(user,JSON.stringify({at:now,...report,...(warnings.length?{warnings}:{})}),now));
 await db().batch(statements);
 // Wired-up fields with nothing today (no Watch worn yet): proves a new field is connected.
 const empty=report&&items.length?report.empty:[];const emptyLine=empty.length?`\n已连上、今天还没有数据：${empty.join('、')}`:'';
 if(fromShortcut)return text((items.length?`已同步 ${today.slice(5).replace('-','/')}：${items.map(itemSummary).join('，')}`:`已连接，但今天还没有可同步的数据。${simple?`\n收到：${describeSimpleBody(simple)}\n全是空的可能是：今天（从零点算起）还没有数据、字段连错了卡片，或快捷指令没有健康读取权限。`:''}`)+emptyLine+(warnings.length?`\n⚠️ 这几项没收到，其余已同步：\n${warnings.join('\n')}`:''));
 return json({imported:items.length,warnings:parsed.warnings,source:parsed.source,lastSyncAt:now});
}catch(e){
 // Keep why the last sync failed and what it carried, for the Apple 健康 page and for fixing the Shortcut.
 if(owner){
  const message=e instanceof Error?e.message:String(e);console.log('health sync failed:',message,sent?describeSimpleBody(sent):'');
  const at=new Date().toISOString(),report=sent?{...fieldReport(sent),sent:describeSimpleBody(sent)}:{};
  await db().prepare("INSERT INTO private_config (owner,key,payload,updated_at) VALUES (?,'health-fields',?,?) ON CONFLICT(owner,key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(owner,JSON.stringify({at,error:message.slice(0,300),...report}),at).run().catch(()=>{});
 }
 // Data problems are the shortcut's to fix (400); everything else keeps its own status.
 if(e instanceof Error&&e.name==='HealthImportError')return fromShortcut?text(`没有同步：${e.message}`,400):json({error:e.message},400);
 const failed=failure(e);
 return fromShortcut?text(`没有同步：${(await failed.json() as {error?:string}).error??'未知错误'}`,failed.status):failed;
}}
