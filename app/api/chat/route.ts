import {z} from "zod";
import {owner,loadData,json,failure,commit,recordStatement,messageStatement,changeStatement,receipt,AppError} from "@/lib/server-store";
import {interpret} from "@/lib/ai";
import {db} from "@/lib/server-store";
import {dayDiff,itemSummary,settingsSchema,type ChatMessage,type PlanChange} from "@/lib/domain";
import {planMeals} from "@/lib/diet";
import {prepareTrainingRecords,finishTrainingSession} from "@/lib/training-sessions";
import {personalRecords} from "@/lib/insights";
// Photos arrive already downscaled by the phone (about 1600px JPEG); they go to the model only and are not stored.
const image=z.string().max(4_000_000).regex(/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/);
const input=z.object({id:z.string().uuid(),text:z.string().trim().max(12000),images:z.array(image).max(3).optional(),pendingMessageId:z.string().nullable().optional()}).strict().refine(v=>v.text.length>0||!!v.images?.length,{message:"消息不能为空。"});
const FINISH=/^(?:结束训练|训练结束|结束本次训练|今天练完了|练完了)[。.!！]?$/;
const CANCEL=/^(?:取消|算了|cancel)[。.!！]?$/i;
export const MAX_RECORDS=30;
// Records plus session rows; reads, receipts and messages use the other ~18 of 50 queries.
const MAX_WRITES=32;
export async function POST(request:Request){try{
 const user=await owner(request);const args=input.parse(await request.json());const cached=await receipt(user,args.id);if(cached)return json(cached);
 const data=await loadData(user);
 const pending=args.pendingMessageId?data.messages.find(m=>m.id===args.pendingMessageId&&m.clarification):null;
 if(args.pendingMessageId&&!pending)throw new AppError("待补充的记录已不可用，请重新发送完整内容。",409);
 // The model sees the original message plus the answer; the basic parser only understands complete messages.
 const combined=pending?.pendingText&&data.aiEnabled?`${pending.pendingText}\n（补充）${args.text}`:args.text;
 const now=new Date();const createdAt=now.toISOString();
 const images=args.images??[];
 const userMessage:ChatMessage={id:`${args.id}-user`,role:"user",text:[args.text,images.length?`[照片 ${images.length} 张]`:""].filter(Boolean).join(" "),createdAt};
 const assistant:ChatMessage={id:`${args.id}-assistant`,role:"assistant",text:"",createdAt:new Date(now.getTime()+1).toISOString()};
 const statements:D1PreparedStatement[]=[];
 if(!images.length&&FINISH.test(args.text)){
  const finished=finishTrainingSession(user,data,now);assistant.text=finished.reply;statements.push(...finished.statements);
 }else{
  const result=!images.length&&CANCEL.test(args.text)?{type:"question" as const,reply:"已取消，这条草稿没有保存。"}:await interpret(combined||"（只发了照片）",data,images);
  if(result.type==="records"){
   // D1 Free: 50 queries per request; loading and receipts already use about 15.
   if(result.items.length>MAX_RECORDS)throw new AppError(`一条消息里的记录太多（超过 ${MAX_RECORDS} 条），没有保存。请分成两三条发送。`,413);
   const prepared=prepareTrainingRecords(user,data,result.items,now);
   if(prepared.items.length+prepared.statements.length>MAX_WRITES)throw new AppError("这条消息涉及的日期和记录太多，没有保存。请按日期分开发送。",413);
   const lines=["已记录：",...prepared.items.map(i=>`• ${itemSummary(i)}`)];
   const lowSleep=prepared.items.find(i=>i.kind==="health"&&i.sleepH!==null&&data.settings.sleepMin!==null&&i.sleepH<data.settings.sleepMin);
   if(lowSleep)lines.push(`睡眠低于你设定的 ${data.settings.sleepMin} 小时，今天的训练表现可以放宽看待。`);
   if(prepared.items.some(i=>i.kind==="workout"&&i.pain&&((i.painScore??0)>3||(i.painWeeks??0)>2)))lines.push("这处疼痛较明显或已持续一段时间，建议请物理治疗师评估；相关动作先不加重。");
   else if(prepared.items.some(i=>i.kind==="workout"&&i.pain))lines.push("已记下疼痛。在你确认恢复之前，不会建议给这个动作加重。");
   for(const record of personalRecords(data.items,prepared.items))lines.push(`🏆 新纪录：${record.text}`);
   if(result.reply.trim())lines.push(result.reply.trim());
   assistant.text=lines.join("\n");assistant.itemIds=prepared.items.map(i=>i.id);
   statements.push(...prepared.items.map(i=>recordStatement(user,i)),...prepared.statements);
  }else if(result.type==="diet_plan"){
   // Replaces the fixed eating plan; a calorie adjustment from the old plan's review no longer applies.
   const settings=settingsSchema.parse({...data.settings,dietPlan:result.plan,dietAdjustKcal:0});
   statements.push(db().prepare("UPDATE profiles SET settings=? WHERE owner=?").bind(JSON.stringify(settings),user));
   const day=(type:"training"|"rest")=>`${type==="training"?"训练日":"休息日"} ${result.plan.targets[type].kcal} kcal / 蛋白质 ${result.plan.targets[type].protein} g：${planMeals(type,settings).map(m=>`${m.slot}${m.kcal}`).join("、")}`;
   assistant.text=["已设置饮食计划「"+result.plan.name+"」，从 "+result.plan.startDate+" 起每天默认按计划算，吃了别的再告诉我。",day("training"),day("rest"),result.reply].filter(Boolean).join("\n");
  }else if(result.type==="plan_start"&&data.settings.dietPlan){
   // Days from the new start without their own food records now count the plan's meals.
   const settings=settingsSchema.parse({...data.settings,dietPlan:{...data.settings.dietPlan,startDate:result.startDate}});
   statements.push(db().prepare("UPDATE profiles SET settings=? WHERE owner=?").bind(JSON.stringify(settings),user));
   assistant.text=[`饮食计划改成从 ${result.startDate} 开始，今天是第 ${dayDiff(data.today,result.startDate)+1} 天。这之间没单独记饮食的日子，都按计划算。`,result.reply].filter(Boolean).join("\n");
  }else if(result.type==="proposal"){
   const change:PlanChange={id:crypto.randomUUID(),createdAt,request:combined,summary:result.summary,before:data.plan,after:result.after,status:"proposed",baseVersion:data.planVersion,note:result.note};
   assistant.text=`请确认这个计划变更：${result.summary}`;assistant.proposalId=change.id;statements.push(changeStatement(user,change));
  }else{
   assistant.text=result.reply;
   // The follow-up answer is interpreted without the photo, so keep what the model said it saw.
   if(result.type==="clarification"){assistant.clarification=true;assistant.pendingText=images.length?`${combined}\n（照片识别：${result.reply}）`:combined;}
  }
 }
 statements.push(messageStatement(user,userMessage),messageStatement(user,assistant));
 return json(await commit(user,args.id,statements,{messages:[userMessage,assistant]}));
}catch(e){return failure(e);}}
