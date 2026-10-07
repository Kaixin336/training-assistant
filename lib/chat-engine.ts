import {z} from 'zod';
import {addDays,baseSet,dateSchema,logItemSchema,metricLabels,type AppData,type DietPlan,type LogItem,type Workout,type WorkingSet} from './domain';
import type {Session} from './plan';

export type ChatResult={type:'records';items:LogItem[];reply:string}|{type:'question'|'clarification';reply:string}|{type:'proposal';after:Session[];summary:string;note:string}|{type:'diet_plan';plan:DietPlan;reply:string};
const n=z.number().finite().min(0).nullable().optional();
const common={date:dateSchema,notes:z.string().max(4000).optional()};
const set=z.object({weightKg:n,reps:n,durationSec:n,distanceM:n,notch:n,isWarmup:z.boolean().optional(),feel:z.enum(['Easy','OK','Hard']).nullable().optional(),side:z.enum(['left','right','both']).optional()}).strict();
const drafts=z.array(z.discriminatedUnion('kind',[
 z.object({...common,kind:z.literal('workout'),exercise:z.string().min(1).max(160),unit:z.enum(['kg','kg/side','kg/hand','added kg','assisted kg','bodyweight','seconds','metres','bar height notch']),sets:z.array(set).max(80),durationMin:n,pain:z.boolean().optional(),painScore:n,painWeeks:n,painResolved:z.boolean().optional(),repMin:n,repMax:n,increment:z.string().max(180).optional()}).strict(),
 z.object({...common,kind:z.literal('metric'),metric:z.enum(['weight','waist','hips','thigh','arm']),value:z.number(),unit:z.enum(['kg','cm'])}).strict(),
 z.object({...common,kind:z.literal('food'),description:z.string().min(1).max(1000),calories:n,protein:n,isEstimate:z.boolean(),time:z.string().max(40).optional()}).strict(),
 z.object({...common,kind:z.literal('health'),sleepH:n,steps:n,creatineTaken:z.boolean().nullable().optional(),creatineG:n,activeEnergyKcal:n,restingHeartRate:n,hrvMs:n,exerciseMin:n}).strict(),
 z.object({...common,kind:z.literal('note'),category:z.enum(['training','pain','skill','general']),text:z.string().min(1).max(4000)}).strict(),
 z.object({...common,kind:z.literal('activity'),name:z.string().min(1).max(80),durationMin:n,distanceM:n,energyKcal:n,avgHr:n,maxHr:n,effort:n}).strict()
])).max(80);
const aliases:Record<string,string>={'卧推':'杠铃卧推','杠铃卧推':'杠铃卧推','benchpress':'杠铃卧推','barbellbenchpress':'杠铃卧推','深蹲':'深蹲','squat':'深蹲','squats':'深蹲','硬拉':'硬拉','deadlift':'硬拉','rdl':'罗马尼亚硬拉','romaniandeadlift':'罗马尼亚硬拉','罗马尼亚硬拉':'罗马尼亚硬拉','引体':'引体向上','引体向上':'引体向上','pullup':'引体向上','pullups':'引体向上','俯卧撑':'俯卧撑','pushup':'俯卧撑','pushups':'俯卧撑','哑铃卧推':'哑铃卧推','dumbbellbenchpress':'哑铃卧推','肩推':'肩推','overheadpress':'肩推','推肩':'肩推','腿举':'腿举','legpress':'腿举','高位下拉':'高位下拉','latpulldown':'高位下拉','坐姿划船':'坐姿划船','seatedrow':'坐姿划船','跑步':'跑步','running':'跑步','run':'跑步','游泳':'游泳','swimming':'游泳'};
const normalize=(s:string)=>s.toLowerCase().replace(/[\s_\-()（）]/g,'').trim();
export function canonicalExercise(name:string,unit:string,items:LogItem[]=[],merged:Record<string,string>={}){
 const known=aliases[normalize(name)]??name.trim();
 const prior=items.find((i):i is Workout=>i.kind==='workout'&&!!i.exerciseId&&i.unit===unit&&(normalize(i.exerciseName??'')===normalize(known)||(aliases[normalize(i.exerciseName??'')]??i.exerciseName)===known));
 if(prior)return {id:prior.exerciseId!,name:prior.exerciseName!};
 let hash=2166136261;for(const char of normalize(known)+'|'+unit){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}
 // A renamed exercise keeps its ID, and a merged one points to its target, so old names still land in the same history.
 const id=merged['exercise-'+(hash>>>0).toString(16)]??'exercise-'+(hash>>>0).toString(16);
 const existing=items.find((i):i is Workout=>i.kind==='workout'&&i.exerciseId===id&&i.unit===unit);
 return {id,name:existing?.exerciseName??known};
}
export function validateAiRecords(input:unknown,data:AppData,source:string):LogItem[]{
 const rows=drafts.parse(input);if(!rows.length)throw new Error('没有可保存的记录。');
 return rows.map(raw=>{
  const base={id:crypto.randomUUID(),date:raw.date,createdAt:new Date().toISOString(),source,notes:raw.notes??''};
  if(raw.date>data.today)throw new Error('训练记录日期晚于今天，请确认日期。');
  if(raw.kind==='workout'){
   const exercise=canonicalExercise(raw.exercise,raw.unit,data.items,data.exerciseAliases),sets=raw.sets.map(s=>({...baseSet,...Object.fromEntries(Object.entries(s).filter(([,v])=>v!==undefined))})) as WorkingSet[];
   if(!sets.length&&raw.durationMin==null&&!raw.pain&&!raw.painResolved)throw new Error('请补充组数、次数或运动时长。');
   if(sets.some(s=>s.reps===null&&s.durationSec===null&&s.distanceM===null))throw new Error('请补充每组的次数、时长或距离。');
   if(raw.pain&&raw.painResolved)throw new Error('疼痛和已恢复不能同时记录，请确认。');
   if(raw.unit==='bodyweight'&&sets.some(s=>s.weightKg!==null))throw new Error('自重动作不能同时记成负重；请确认是否额外加重。');
   const previous=data.items.find((i):i is Workout=>i.kind==='workout'&&i.exerciseId===exercise.id);
   return logItemSchema.parse({...base,kind:'workout',session:'自由训练',exerciseId:exercise.id,exerciseName:exercise.name,unit:raw.unit,sets,completed:true,durationMin:raw.durationMin??null,pain:raw.pain??false,painScore:raw.painScore??null,painWeeks:raw.painWeeks??null,painResolved:raw.painResolved??false,isKeyLift:true,repMin:raw.repMin??previous?.repMin??null,repMax:raw.repMax??previous?.repMax??null,expectedSets:sets.filter(s=>!s.isWarmup&&s.side!=='right').length||null,increment:raw.increment??previous?.increment??''});
  }
  if(raw.kind==='metric')return logItemSchema.parse({...base,kind:'metric',metric:raw.metric,value:raw.value,unit:raw.unit});
  if(raw.kind==='food')return logItemSchema.parse({...base,kind:'food',description:raw.description,calories:raw.calories??null,protein:raw.protein??null,isEstimate:raw.isEstimate,time:raw.time??''});
  if(raw.kind==='health'){
   const {date:_,notes:__,...rest}=raw;
   if(!Object.entries(raw).some(([k,v])=>!['date','notes','kind'].includes(k)&&v!=null))throw new Error('这条健康记录没有数值。');
   return logItemSchema.parse({...base,sleepH:null,steps:null,creatineTaken:null,creatineG:null,...rest});
  }
  if(raw.kind==='activity'){
   // A whole Watch workout (type, time, heart rate, effort), e.g. read from a Fitness screenshot.
   if(raw.durationMin==null)throw new Error('请补充这次运动的时长。');
   const extra=Object.fromEntries((['distanceM','energyKcal','avgHr','maxHr','effort'] as const).filter(k=>raw[k]!=null).map(k=>[k,raw[k]]));
   return logItemSchema.parse({...base,kind:'workout',session:'Apple Watch',exerciseId:null,exerciseName:raw.name,unit:'',sets:[],completed:true,durationMin:raw.durationMin,pain:false,painScore:null,painWeeks:null,painResolved:false,isKeyLift:false,repMin:null,repMax:null,expectedSets:null,increment:'',...extra});
  }
  return logItemSchema.parse({...base,kind:'note',category:raw.category,text:raw.text});
 });
}
export function resolveDate(text:string,today:string):{date:string;text:string;error?:string}{
 const iso=text.match(/\b\d{4}-\d{2}-\d{2}\b/);if(iso){const r=dateSchema.safeParse(iso[0]);return r.success?{date:r.data,text:text.replace(iso[0],'').trim()}:{date:today,text,error:'日期无效，请用 YYYY-MM-DD。'};}
 if(/前天/.test(text))return {date:addDays(today,-2),text:text.replace('前天','').trim()};
 if(/昨天|yesterday/i.test(text))return {date:addDays(today,-1),text:text.replace(/昨天|yesterday/i,'').trim()};
 return {date:today,text:text.replace(/^(今天|今日|today)\s*/i,'').trim()};
}
const FEELS:Record<string,'Easy'|'OK'|'Hard'>={'轻松':'Easy','适中':'OK','吃力':'Hard',easy:'Easy',ok:'OK',hard:'Hard'};
const FEEL='(轻松|适中|吃力|easy|ok|hard)';
const UNIT='(kg\\/hand|kg\\/side|added kg|assisted kg|kg|公斤|千克)';
const NUM='(\\d+(?:\\.\\d+)?)';
const SET_PREFIX='(?:第\\s*[\\d一二三四五六七八九十]+\\s*组|又(?:做了)?一组|再(?:来)?一组|下一组)?\\s*[:：，,]?\\s*';
const SET_START=/^(?:第\s*[\d一二三四五六七八九十]+\s*组|又(?:做了)?一组|再(?:来)?一组|下一组)/;
const BODYWEIGHT=/俯卧撑|引体|自重|双杠|臂屈伸|卷腹|仰卧起坐/;
const feelOf=(value?:string)=>value?FEELS[value.toLowerCase()]??null:null;
const unitOf=(value:string)=>/公斤|千克/.test(value)?'kg':value.toLowerCase();
type WorkoutRow={kind:'workout';date:string;exercise:string;unit:string;sets:Record<string,unknown>[]};
/** Load conventions written in Chinese become explicit units so they are never mixed. */
function normalizeLoad(value:string){
 return value
  .replace(/(?:加重|负重)\s*(\d+(?:\.\d+)?)\s*(?:kg|公斤|千克)/gi,'$1added kg').replace(/辅助\s*(\d+(?:\.\d+)?)\s*(?:kg|公斤|千克)/gi,'$1assisted kg')
  .replace(/(?:单手|每只手?|每手)\s*(\d+(?:\.\d+)?)\s*(?:kg|公斤|千克)/gi,'$1kg/hand').replace(/(\d+(?:\.\d+)?)\s*(?:kg|公斤|千克)\s*(?:单手|每只手?|每手)/gi,'$1kg/hand')
  .replace(/(?:每边|单边|每侧)\s*(\d+(?:\.\d+)?)\s*(?:kg|公斤|千克)/gi,'$1kg/side').replace(/(\d+(?:\.\d+)?)\s*(?:kg|公斤|千克)\s*(?:每边|单边|每侧)/gi,'$1kg/side');
}
function parseWorkout(text:string,date:string,data:AppData):WorkoutRow|string|null{
 const warmup=/^热身[:：\s]*/.test(text);let value=normalizeLoad(text.replace(/^热身[:：\s]*/,'').trim());
 // "两只合计40kg" is a combined dumbbell load; keep it as a separately named exercise.
 const combined=/(?:两只)?合计\s*\d/.test(value);value=value.replace(/(?:两只)?合计\s*(\d+(?:\.\d+)?)\s*(?:kg|公斤|千克)/i,'$1kg');
 const tag=(sets:Record<string,unknown>[])=>sets.map(set=>({...set,isWarmup:warmup}));
 const row=(name:string,unit:string,sets:Record<string,unknown>[]):WorkoutRow|string=>{
  if(!sets.length||sets.length>40)return '组数需要在 1–40 之间。';
  if(unit==='kg'&&/哑铃|dumbbell/i.test(name)&&!combined&&!/合计/.test(name))return '哑铃重量是单手还是两只合计？请写成“哑铃卧推 单手20kg 3x10”或“哑铃卧推 两只合计40kg 3x10”。';
  const exercise=combined&&!/合计/.test(name)?`${name.trim()}（两只合计）`:name.trim();
  return {kind:'workout',date,exercise,unit,sets:tag(sets)};
 };
 // "第三组 …" always continues the open session instead of naming an exercise.
 const continuing=SET_START.test(value);
 let m:RegExpMatchArray|null=null;
 if(!continuing){
 // 卧推 60kg 3x8 吃力 · 卧推 60公斤 3组8次
 m=value.match(new RegExp(`^(.+?)\\s+${NUM}\\s*${UNIT}\\s*(\\d+)\\s*(?:[x×*]|组\\s*(?:每组)?)\\s*(\\d+)\\s*(?:次|个)?\\s*${FEEL}?$`,'i'));
 if(m)return row(m[1],unitOf(m[3]),Array.from({length:Number(m[4])},()=>({weightKg:Number(m![2]),reps:Number(m![5]),feel:feelOf(m![6])})));
 // 卧推 60kg 8次
 m=value.match(new RegExp(`^(.+?)\\s+${NUM}\\s*${UNIT}\\s*(\\d+)\\s*(?:次|个)\\s*${FEEL}?$`,'i'));
 if(m)return row(m[1],unitOf(m[3]),[{weightKg:Number(m[2]),reps:Number(m[4]),feel:feelOf(m[5])}]);
 // 卧推 60kg 8/8/7 吃力 (effort applies to the last set only)
 m=value.match(new RegExp(`^(.+?)\\s+${NUM}\\s*${UNIT}\\s+((?:\\d+\\s*[/,，、\\s]\\s*)+\\d+)\\s*(?:次|个)?\\s*${FEEL}?$`,'i'));
 if(m){const reps=m[4].split(/[/,，、\s]+/).filter(Boolean).map(Number);return row(m[1],unitOf(m[3]),reps.map((r,i)=>({weightKg:Number(m![2]),reps:r,feel:i===reps.length-1?feelOf(m![5]):null})));}
 // 引体向上 3组8次 · 俯卧撑 3x15 · 引体 8 7 6
 m=value.match(new RegExp(`^(.+?)\\s+(\\d+)\\s*(?:组\\s*(?:每组)?|[x×*])\\s*(\\d+)\\s*(?:次|个)?\\s*${FEEL}?$`,'i'));
 if(m&&BODYWEIGHT.test(m[1]))return row(m[1],'bodyweight',Array.from({length:Number(m[2])},()=>({reps:Number(m![3]),feel:feelOf(m![4])})));
 m=value.match(new RegExp(`^(.+?)\\s+((?:\\d+\\s*[/,，、\\s]\\s*)*\\d+)\\s*(?:次|个)?\\s*${FEEL}?$`,'i'));
 if(m&&BODYWEIGHT.test(m[1])){const reps=m[2].split(/[/,，、\s]+/).filter(Boolean).map(Number);return row(m[1],'bodyweight',reps.map((r,i)=>({reps:r,feel:i===reps.length-1?feelOf(m![3]):null})));}
 // 卧推 60x8 65x6 65kg×5 吃力 (each set keeps its own load)
 m=value.match(/^(.+?)\s+(\d.*)$/);
 if(m&&/[x×*]/.test(m[2])){
  const pair=new RegExp(`${NUM}\\s*${UNIT}?\\s*[x×*]\\s*(\\d+)\\s*(?:次|个)?\\s*${FEEL}?`,'gi');
  const pairs=[...m[2].matchAll(pair)];const leftover=m[2].replace(pair,'').replace(/[\s,，、;；/]+/g,'');
  if(pairs.length&&!leftover){
   const units=[...new Set(pairs.map(p=>p[2]).filter(Boolean).map(unit=>unitOf(unit!)))];
   if(units.length>1)return '同一个动作里出现了不同的重量口径，请分开记录。';
   if(!units.length&&pairs.length===1&&Number(pairs[0][1])<=10)return `“${pairs[0][0].trim()}”是组数×次数还是重量×次数？请带上重量，例如“${m[1].trim()} 60kg 3x8”；自重动作写“${m[1].trim()} 自重 3组8次”。`;
   return row(m[1],units[0]??'kg',pairs.map(p=>({weightKg:Number(p[1]),reps:Number(p[3]),feel:feelOf(p[4])})));
  }
 }
 }
 // Inside an open session: 第三组 62.5kg 8次 · 又一组 8个 吃力
 const loaded=value.match(new RegExp(`^${SET_PREFIX}${NUM}\\s*${UNIT}?\\s*(?:[x×*]\\s*)?(\\d+)\\s*(次|个)?\\s*${FEEL}?$`,'i'));
 const repsOnly=value.match(new RegExp(`^${SET_PREFIX}(\\d+)\\s*(?:次|个)\\s*${FEEL}?$`,'i'));
 const looksLikeSet=(loaded&&(loaded[2]||loaded[4]||/[x×*]/.test(value)))||repsOnly;
 if(!looksLikeSet)return null;
 const active=data.activeSession;
 if(!active?.activeExerciseName||active.date!==date)return '没有找到正在进行的动作。请带上动作名，例如“卧推 60kg 8次”。';
 const activeUnit=active.activeUnit??'kg';
 if(repsOnly){
  const weightKg=activeUnit==='bodyweight'?null:active.lastWeightKg;
  if(activeUnit!=='bodyweight'&&weightKg===null)return `这一组${active.activeExerciseName}用了多少重量？`;
  return row(active.activeExerciseName,activeUnit,[{weightKg,reps:Number(repsOnly[1]),feel:feelOf(repsOnly[2])}]);
 }
 const unit=loaded![2]?unitOf(loaded![2]):activeUnit;
 if(unit!==activeUnit)return `当前动作${active.activeExerciseName}按“${activeUnit}”记录。换了动作请带上动作名。`;
 if(unit==='bodyweight')return '自重动作不用写重量；直接写“又一组 8次”。';
 return row(active.activeExerciseName,unit,[{weightKg:Number(loaded![1]),reps:Number(loaded![3]),feel:feelOf(loaded![5])}]);
}
export function parseBasicChat(text:string,data:AppData):ChatResult{
 if(/^(你好|hi|hello)[!！。]?$/i.test(text.trim()))return {type:'question',reply:'练完直接告诉我动作、重量和次数。DeepSeek 连接前支持明确格式，例如：卧推 60kg 3x8；体重 72kg；睡眠 7小时。'};
 if(/改成|改为|更正|写错|不是|撤销|删除|换成/.test(text))return {type:'clarification',reply:'请点击那条记录的“编辑”或“撤销”，避免把更正内容重复记成新训练。'};
 const resolved=resolveDate(text,data.today);if(resolved.error)return {type:'clarification',reply:resolved.error};
 // Split before a new record type, or before "<exercise> <load/sets>", but never inside "60x8, 65x6".
 const chunks=resolved.text.split(/[;；\n]+|[，,。](?=\s*(?:体重|腰围|臀围|臂围|大腿围|睡眠|睡了|步数|走了|午餐|早餐|晚餐|加餐|热身|跑步|游泳|骑车|备注))|[，,。](?=\s*[^\d\s,，。;；]{1,20}\s+(?:单手|每只手?|每手|每边|单边|每侧|加重|负重|辅助|自重|两只合计)?\s*\d+(?:\.\d+)?\s*(?:kg|公斤|千克|[x×*]|组))/i).map(s=>s.trim().replace(/[。!！]$/,'')).filter(Boolean);
 const rows:unknown[]=[];let error='';
 for(const chunk of chunks){
  const dated=resolveDate(chunk,resolved.date),value=dated.text,date=dated.date;
  const metric=(Object.keys(metricLabels) as (keyof typeof metricLabels)[]).find(k=>value.startsWith(metricLabels[k])||(k==='weight'&&/^weight/i.test(value)));
  if(metric){const m=value.match(/^(?:体重|腰围|臀围|臂围|大腿围|weight)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(kg|公斤|千克|cm|厘米)?$/i);if(!m){error='请把测量写清楚，例如“体重 72kg”或“腰围 82cm”。';break;}const unit=m[2]??(metric==='weight'?'kg':'cm');rows.push({kind:'metric',date,metric,value:Number(m[1]),unit:/kg|公斤|千克/i.test(unit)?'kg':'cm'});continue;}
  let m=value.match(/^(?:睡眠|睡了|sleep|slept)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:小时|h|hours?)$/i);
  if(m){rows.push({kind:'health',date,sleepH:Number(m[1])});continue;}
  m=value.match(/^(?:步数|走了|steps)\s*[:：]?\s*([\d,]+)\s*(?:步|steps)?$/i);
  if(m){rows.push({kind:'health',date,steps:Number(m[1].replaceAll(',',''))});continue;}
  m=value.match(/^(早餐|午餐|晚餐|加餐|breakfast|lunch|dinner|snack)\s*[:：]?\s*(.*?)\s*(\d+(?:\.\d+)?)\s*(?:kcal|卡|千卡)\s*[,，、 ]*\s*(?:蛋白质\s*)?(\d+(?:\.\d+)?)\s*(?:g|克)(?:\s*蛋白质)?$/i);
  if(m){rows.push({kind:'food',date,description:[m[1],m[2].replace(/[，,、;；\s]+$/,'')].filter(Boolean).join(' '),calories:Number(m[3]),protein:Number(m[4]),isEstimate:false});continue;}
  const workout=parseWorkout(value,date,data);
  if(typeof workout==='string'){error=workout;break;}
  if(workout){rows.push(workout);continue;}
  m=value.match(/^(跑步|游泳|骑车|步行|散步|椭圆机)\s*(\d+(?:\.\d+)?)\s*(?:分钟|min)$/i);
  if(m){rows.push({kind:'workout',date,exercise:m[1],unit:'seconds',sets:[],durationMin:Number(m[2])});continue;}
  if(/^备注[:：]/.test(value)){rows.push({kind:'note',date,category:'general',text:value.replace(/^备注[:：]/,'').trim()});continue;}
  error='这句话需要 DeepSeek 来理解。请先在“设置”连接 API，或写成明确格式：卧推 60kg 3x8；体重 72kg；睡眠 7小时。';break;
 }
 if(error||!rows.length)return {type:'clarification',reply:error||'请告诉我今天练了什么。'};
 try{return {type:'records',items:validateAiRecords(rows,data,text),reply:''};}catch(e){return {type:'clarification',reply:e instanceof Error?e.message:'记录还缺少信息，请补充。'};}
}

