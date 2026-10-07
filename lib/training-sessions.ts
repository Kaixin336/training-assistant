import { env } from './runtime-env';
import { todayNZ, type AppData, type LogItem, type TrainingSession, type Workout } from './domain';

export const SESSION_IDLE_MS = 3 * 60 * 60 * 1000;
export class TrainingSessionError extends Error { readonly status=409; }
export function activeTrainingSession(sessions:TrainingSession[],date=todayNZ(),now=new Date()):TrainingSession|null {
  return sessions.filter(session=>session.date===date&&!session.endedAt&&isRecent(session,now)).sort((a,b)=>b.lastActivityAt.localeCompare(a.lastActivityAt))[0]||null;
}
function isRecent(session:TrainingSession,now:Date){const age=now.getTime()-Date.parse(session.lastActivityAt);return Number.isFinite(age)&&age>=-1000&&age<=SESSION_IDLE_MS;}
function statement(user:string,original:TrainingSession|null,next:TrainingSession){
  // A failed optimistic check violates NOT NULL and rolls back the whole D1 batch,
  // including the operation receipt. No set or message can partially commit.
  return env.DB.prepare('INSERT INTO training_sessions (owner,id,date,payload,last_activity_at,ended_at) VALUES (?,?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET payload=CASE WHEN training_sessions.payload=? THEN excluded.payload ELSE NULL END,last_activity_at=excluded.last_activity_at,ended_at=excluded.ended_at,date=excluded.date').bind(user,next.id,next.date,JSON.stringify(next),next.lastActivityAt,next.endedAt,original?JSON.stringify(original):'');
}
function touchedAt(previous:TrainingSession,now:Date){return new Date(Math.max(now.getTime(),Date.parse(previous.lastActivityAt)+1)).toISOString();}
export function sessionDatabaseConflict(error:unknown){return error instanceof Error&&/training_sessions\.(?:payload|owner)|training_sessions_open_date/.test(error.message);}
export function prepareTrainingRecords(user:string,data:AppData,input:LogItem[],now=new Date()){
  const items=structuredClone(input),known=structuredClone(data.sessions||[]);
  const mutations=new Map<string,{original:TrainingSession|null;next:TrainingSession}>();
  const byDate=new Map<string,TrainingSession>();
  const workouts:Workout[]=data.items.filter((item):item is Workout=>item.kind==='workout');
  function mutate(next:TrainingSession,original:TrainingSession|null){const prior=mutations.get(next.id);mutations.set(next.id,{original:prior?prior.original:original,next});}
  for(const item of items){
    // Watch/activity summaries (no exercise) are not part of a live strength session.
    if(item.kind!=='workout'||!item.exerciseId)continue;
    let session=byDate.get(item.date);
    if(!session){
      const previous=known.filter(s=>s.date===item.date&&!s.endedAt).sort((a,b)=>b.lastActivityAt.localeCompare(a.lastActivityAt))[0];
      if(previous&&isRecent(previous,now))session=structuredClone(previous);
      else {
        if(previous)mutate({...previous,endedAt:previous.lastActivityAt},previous);
        session={id:crypto.randomUUID(),date:item.date,startedAt:now.toISOString(),lastActivityAt:now.toISOString(),endedAt:null,activeExerciseId:null,activeExerciseName:null,activeUnit:null,lastWeightKg:null};
      }
      byDate.set(item.date,session);
    }
    item.trainingSessionId=session.id;
    const used=new Map<string,Set<number>>();
    for(const workout of workouts){if(workout.trainingSessionId!==session.id||workout.exerciseId!==item.exerciseId)continue;for(const set of workout.sets){if(set.isWarmup||set.ordinal===undefined)continue;const ordinals=used.get(set.side)||new Set<number>();ordinals.add(set.ordinal);used.set(set.side,ordinals);}}
    for(const set of item.sets){
      if(set.isWarmup){delete set.ordinal;continue;}
      const ordinals=used.get(set.side)||new Set<number>();
      const ordinal=set.ordinal??Math.max(0,...ordinals)+1;
      if(ordinals.has(ordinal))throw new TrainingSessionError(`这次训练的${item.exerciseName||'该动作'}第 ${ordinal} 组已经记录，请编辑原记录或指定新的组数。`);
      if(ordinal>100)throw new TrainingSessionError('该动作已达到本次训练的组数上限，请结束后开启新的训练。');
      set.ordinal=ordinal;ordinals.add(ordinal);used.set(set.side,ordinals);
    }
    const previous=known.find(s=>s.id===session!.id)||null;
    session.lastActivityAt=previous?touchedAt(session,now):now.toISOString();
    if(item.exerciseId){
      const switched=session.activeExerciseId!==item.exerciseId||session.activeUnit!==item.unit;
      session.activeExerciseId=item.exerciseId;session.activeExerciseName=item.exerciseName;session.activeUnit=item.unit;
      const loaded=[...item.sets].reverse().find(set=>!set.isWarmup&&set.weightKg!==null);
      session.lastWeightKg=loaded?.weightKg??(switched?null:session.lastWeightKg);
    }
    mutate(structuredClone(session),previous);workouts.push(item);
  }
  return {items,statements:[...mutations.values()].map(({original,next})=>statement(user,original,next)),sessions:[...mutations.values()].map(value=>value.next)};
}
export function finishTrainingSession(user:string,data:AppData,now=new Date()){
  const active=activeTrainingSession(data.sessions||[],data.today,now);
  if(!active)return {statements:[] as D1PreparedStatement[],session:null,reply:'当前没有正在记录的训练。下次发送动作记录时，会自动开始新的训练。'};
  const next={...active,endedAt:now.toISOString(),lastActivityAt:touchedAt(active,now)};
  const workouts=data.items.filter((item):item is Workout=>item.kind==='workout'&&item.trainingSessionId===active.id);
  const exerciseCount=new Set(workouts.map(workout=>workout.exerciseId).filter(Boolean)).size;
  const sets=workouts.reduce((count,workout)=>count+workout.sets.filter(set=>!set.isWarmup).length,0);
  return {statements:[statement(user,active,next)],session:next,reply:`本次训练已结束（${active.date}）：已记录 ${exerciseCount} 个动作、${sets} 个工作组。下次记录会开始新的训练。`};
}
