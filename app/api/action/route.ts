import {z} from "zod";
import {settingsSchema,logItemSchema,type Workout} from "@/lib/domain";
import {writePrivate} from "@/lib/ai-config";
import {owner,loadData,json,failure,commit,db,getRecord,getChange,changePlan,cancelPlan,recordStatement,receipt,AppError} from "@/lib/server-store";
const actionSchema=z.object({operationId:z.string().uuid(),type:z.enum(["edit","undo","restore","confirm","cancel","undo_plan","settings","rename_exercise","day_type"]),id:z.string().max(160).optional(),item:z.unknown().optional(),settings:z.unknown().optional()}).strict();
export async function POST(request:Request){try{const user=await owner(request);const args=actionSchema.parse(await request.json());const cached=await receipt(user,args.operationId);if(cached)return json(cached);const database=db();
 if(args.type==="settings"){
  const settings=settingsSchema.parse(args.settings);const data=await loadData(user);const previous=data.settings;
  const phaseHistory=(previous.phaseHistory||[]).map(entry=>({...entry}));
  if(!phaseHistory.length&&previous.phaseStart)phaseHistory.push({phase:previous.phase,startDate:previous.phaseStart});
  // A new phase keeping the old start date would overwrite that phase's history; it starts today instead.
  if(settings.phase!==previous.phase&&settings.phaseStart===previous.phaseStart)settings.phaseStart=data.today;
  if(settings.phaseStart&&settings.phaseStart>data.today)throw new AppError("阶段开始日期不能晚于今天。");
  const latest=[...phaseHistory].sort((a,b)=>a.startDate.localeCompare(b.startDate)).at(-1);
  if(settings.phase===previous.phase&&settings.phaseStart!==previous.phaseStart&&latest&&latest.phase===settings.phase){
   const startDate=settings.phaseStart||data.today;settings.phaseStart=startDate;latest.startDate=startDate;
  }else if(settings.phase!==previous.phase||settings.phaseStart!==previous.phaseStart){
   const startDate=settings.phaseStart||data.today;settings.phaseStart=startDate;
   const index=phaseHistory.findIndex(entry=>entry.startDate===startDate);
   if(index<0)phaseHistory.push({phase:settings.phase,startDate});else phaseHistory[index]={phase:settings.phase,startDate};
  }
  settings.phaseHistory=phaseHistory.sort((a,b)=>a.startDate.localeCompare(b.startDate));
  settingsSchema.parse(settings);
  const response={message:"目标已保存。"};let results;
  try{results=await database.batch([
   database.prepare("UPDATE profiles SET settings=? WHERE owner=? AND settings=?").bind(JSON.stringify(settings),user,JSON.stringify(previous)),
   database.prepare("INSERT INTO operations (owner,id,payload,created_at) SELECT ?,?,?,? WHERE changes()=1").bind(user,args.operationId,JSON.stringify(response),new Date().toISOString())
  ]);}catch(error){const saved=await receipt(user,args.operationId);if(saved)return json(saved);throw error;}
  if(!results[0].meta.changes){const saved=await receipt(user,args.operationId);if(saved)return json(saved);throw new AppError("设置已在其他页面更新，请刷新后重试。",409);}
  return json(response);
 }
 if(args.type==="day_type"){
  // Tapping 训练日/休息日 on the Today page: decides that day's plan meals and nutrition targets.
  const input=z.object({date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),dayType:z.enum(["training","rest"]).nullable()}).strict().parse(args.item);
  const row=await database.prepare("SELECT payload FROM private_config WHERE owner=? AND key='day-types'").bind(user).first<{payload:string}>();
  const chosen:Record<string,string>=row?JSON.parse(row.payload):{};
  if(input.dayType)chosen[input.date]=input.dayType;else delete chosen[input.date];
  // Keep about a year of choices.
  const kept=Object.fromEntries(Object.entries(chosen).sort(([a],[b])=>b.localeCompare(a)).slice(0,400));
  return json(await commit(user,args.operationId,[writePrivate(user,"day-types",kept)],{message:"已更新。"}));
 }
 if(args.type==="rename_exercise"){
  const input=z.object({exerciseId:z.string().min(1).max(100),unit:z.string().min(1).max(60),name:z.string().trim().min(1).max(160)}).strict().parse(args.item);
  const data=await loadData(user);
  if(!data.items.some(i=>i.kind==="workout"&&i.exerciseId===input.exerciseId&&i.unit===input.unit))throw new AppError("没有找到这个动作的记录。",404);
  const norm=(s:string)=>s.toLowerCase().replace(/[\s_\-()（）]/g,"");
  // Same name and same load convention as another exercise means the two are one exercise.
  const target=data.items.find((i):i is Workout=>i.kind==="workout"&&i.unit===input.unit&&!!i.exerciseId&&i.exerciseId!==input.exerciseId&&norm(i.exerciseName??"")===norm(input.name));
  const id=target?target.exerciseId!:input.exerciseId,name=target?target.exerciseName!:input.name,now=new Date().toISOString();
  const statements=[
   database.prepare("UPDATE records SET payload=json_set(payload,'$.exerciseId',?,'$.exerciseName',?),updated_at=? WHERE owner=? AND kind='workout' AND json_extract(payload,'$.exerciseId')=? AND json_extract(payload,'$.unit')=?").bind(id,name,now,user,input.exerciseId,input.unit),
   database.prepare("UPDATE training_sessions SET payload=json_set(payload,'$.activeExerciseId',?,'$.activeExerciseName',?) WHERE owner=? AND json_extract(payload,'$.activeExerciseId')=?").bind(id,name,user,input.exerciseId),
  ];
  if(target){const aliases={...(data.exerciseAliases??{})};for(const [from,to] of Object.entries(aliases))if(to===input.exerciseId)aliases[from]=id;aliases[input.exerciseId]=id;statements.push(writePrivate(user,"exercise-aliases",aliases));}
  return json(await commit(user,args.operationId,statements,{message:target?`已合并到“${name}”。`:"已重命名。",exerciseId:id}));
 }
 if(!args.id)throw new AppError("请选择一条记录。");
 if(args.type==="confirm"||args.type==="undo_plan")return json(await changePlan(user,args.operationId,await getChange(user,args.id),args.type));
 if(args.type==="cancel")return json(await cancelPlan(user,args.operationId,await getChange(user,args.id)));
 if(args.type==="edit"){const previous=await getRecord(user,args.id);const next=logItemSchema.parse(args.item);if(next.id!==previous.id||next.kind!==previous.kind||next.createdAt!==previous.createdAt)throw new AppError("不能更改记录标识。");if(next.kind==="workout"&&previous.kind==="workout"&&previous.exerciseId!==null){for(const key of ["exerciseId","exerciseName","unit","isKeyLift","repMin","repMax","expectedSets","increment"] as const)if(next[key]!==previous[key])throw new AppError("修改数值时不能更改动作和重量计算方式。");}if(next.kind==="photo"&&previous.kind==="photo"&&next.fileRef!==previous.fileRef)throw new AppError("请通过照片上传功能替换照片。");return json(await commit(user,args.operationId,[recordStatement(user,next)],{message:"记录已更新。"}));}
 await getRecord(user,args.id,true);const deleting=args.type==="undo";return json(await commit(user,args.operationId,[database.prepare("UPDATE records SET deleted=?,updated_at=? WHERE owner=? AND id=?").bind(deleting?1:0,new Date().toISOString(),user,args.id)],{message:deleting?"记录已撤销。":"记录已恢复。",id:args.id}));
 }catch(e){return failure(e);}}
