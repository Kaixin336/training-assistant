import { z } from "zod";
import { SEED_PLAN, SWIM_STAGES, SWIM_MOBILITY, type Exercise, type Session } from "./plan";
export const TIMEZONE = "Pacific/Auckland";
export const DAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !Number.isNaN(Date.parse(s)) && new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s, "Use a valid YYYY-MM-DD date");
export function todayNZ(now = new Date()) { const p = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now); return `${p.find(x => x.type === "year")!.value}-${p.find(x => x.type === "month")!.value}-${p.find(x => x.type === "day")!.value}`; }
export function addDays(date: string, n: number) { const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function dayOf(date: string) { return new Date(date + "T12:00:00Z").getUTCDay(); }
export function dayDiff(a: string, b: string) { return Math.round((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 86400000); }
export function weekStart(date: string) { return addDays(date, -((dayOf(date) + 6) % 7)); }
export function displayDate(date: string, long = false) { return new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", day: "numeric", month: "long", ...(long ? { weekday: "long" as const } : {}) }).format(new Date(date + "T12:00:00Z")); }
export function blockWeek(date: string, start = "2026-10-05") { return Math.max(0, Math.floor(dayDiff(date, start) / 7) + 1); }
const macroSchema = z.object({ kcal: z.number().min(500).max(8000), protein: z.number().min(0).max(500), fat: z.number().min(0).max(500).nullable().optional(), carbs: z.number().min(0).max(1500).nullable().optional() });
/** A fixed eating plan: meals implied every day unless the user reports otherwise (lib/diet.ts). */
export const dietPlanSchema = z.object({
  name: z.string().trim().min(1).max(60),
  startDate: dateSchema,
  targets: z.object({ training: macroSchema, rest: macroSchema }),
  meals: z.array(z.object({ slot: z.enum(["早餐", "午餐", "晚餐"]), day: z.enum(["both", "training", "rest"]), text: z.string().trim().min(1).max(300), kcal: z.number().min(0).max(4000), protein: z.number().min(0).max(300), fat: z.number().min(0).max(300).nullable().optional(), carbs: z.number().min(0).max(800).nullable().optional() })).min(1).max(9),
  rules: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
  weeklyLossKg: z.tuple([z.number().min(0).max(2), z.number().min(0).max(2)]).optional(),
});
export type DietPlan = z.infer<typeof dietPlanSchema>;
export const settingsSchema = z.object({
    phase: z.enum(["unspecified", "fat_loss", "maintenance", "lean_gain"]), phaseStart: dateSchema.nullable(),
    calorieTarget: z.number().min(800).max(6000).nullable(), proteinMin: z.number().min(20).max(250).nullable(), proteinMax: z.number().min(20).max(300).nullable(),
    stepTarget: z.number().int().min(1000).max(50000).nullable(), sleepMin: z.number().min(1).max(12).nullable(),
    weightGoal: z.number().min(35).max(200).nullable(), hipsGoal: z.number().min(50).max(180).nullable(), waistGoal: z.number().min(40).max(150).nullable(),
    phaseHistory: z.array(z.object({phase:z.enum(['fat_loss','maintenance','lean_gain','unspecified']),startDate:dateSchema})).max(100).optional(),
    blockStart: dateSchema, swimMonth: z.union([z.literal(0), z.literal(10), z.literal(11), z.literal(12)]),
    // Fixed diet plan (lib/diet.ts), calorie adjustment from the review, training rhythm, strength standard.
    dietPlan: dietPlanSchema.nullable().optional(), dietAdjustKcal: z.number().int().min(-600).max(600).optional(),
    trainingPattern: z.enum(["alternate", "free"]).optional(), strengthSex: z.enum(["male", "female"]).nullable().optional(),
}).refine(s => s.proteinMax === null || s.proteinMin === null || s.proteinMax >= s.proteinMin, { message: "蛋白质上限不能低于下限", path: ["proteinMax"] });
export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = { phase: "unspecified", phaseStart: null, phaseHistory: [], calorieTarget: null, proteinMin: null, proteinMax: null, stepTarget: null, sleepMin: null, weightGoal: null, hipsGoal: null, waistGoal: null, blockStart: "2026-10-05", swimMonth: 0 };
const nullableNumber = (max: number) => z.number().finite().min(0).max(max).nullable();
export const setSchema = z.object({ weightKg: nullableNumber(1500), reps: nullableNumber(1000), durationSec: nullableNumber(86400), distanceM: nullableNumber(100000), notch: nullableNumber(100), isWarmup: z.boolean(), feel: z.enum(["Easy", "OK", "Hard"]).nullable(), side: z.enum(["left", "right", "both"]), ordinal:z.number().int().min(1).max(100).optional() }).strict();
export type WorkingSet = z.infer<typeof setSchema>;
export const baseSet: WorkingSet = { weightKg: null, reps: null, durationSec: null, distanceM: null, notch: null, isWarmup: false, feel: null, side: "both" };
const common = { id: z.string().min(1).max(160), date: dateSchema, createdAt: z.string(), source: z.string().max(12000), notes: z.string().max(4000) };
export const workoutSchema = z.object({ ...common, kind: z.literal("workout"), session: z.string().min(1).max(80), exerciseId: z.string().max(100).nullable(), exerciseName: z.string().max(160).nullable(), unit: z.string().max(60), sets: z.array(setSchema).max(80), completed: z.boolean(), durationMin: nullableNumber(1440), pain: z.boolean(), painScore: nullableNumber(10), painWeeks: nullableNumber(520), painResolved: z.boolean(), isKeyLift: z.boolean(), repMin: nullableNumber(1000), repMax: nullableNumber(1000), expectedSets: nullableNumber(80), increment: z.string().max(180), distanceM: nullableNumber(1000000).optional(), energyKcal: nullableNumber(20000).optional(), avgHr: nullableNumber(250).optional(), maxHr: nullableNumber(250).optional(), effort: nullableNumber(10).optional(), startedAt: z.string().max(40).optional(), endedAt: z.string().max(40).optional(), trainingSessionId: z.string().max(160).optional() }).strict();
export const metricSchema = z.object({ ...common, kind: z.literal("metric"), metric: z.enum(["weight", "waist", "hips", "thigh", "arm"]), value: z.number().finite().positive().max(600), unit: z.enum(["kg", "cm"]) }).strict();
export const foodSchema = z.object({ ...common, kind: z.literal("food"), description: z.string().min(1).max(1000), calories: nullableNumber(15000), protein: nullableNumber(1000), fat: nullableNumber(1000).optional(), carbs: nullableNumber(2000).optional(), isEstimate: z.boolean(), time: z.string().max(40), replaces: z.union([z.literal("all"), z.array(z.string().trim().min(1).max(80)).max(12)]).optional() }).strict();
export const healthSchema = z.object({ ...common, kind: z.literal("health"), sleepH: nullableNumber(24), steps: nullableNumber(200000), creatineTaken: z.boolean().nullable(), creatineG: nullableNumber(30), activeEnergyKcal: nullableNumber(20000).optional(), restingHeartRate: z.number().positive().max(300).nullable().optional(), hrvMs: nullableNumber(1000).optional(), exerciseMin: nullableNumber(1440).optional(), basalEnergyKcal: nullableNumber(10000).optional(), wristTempC: z.number().min(25).max(45).nullable().optional() }).strict();
export const skinSchema = z.object({ ...common, kind: z.literal("skin"), weekStart: dateSchema, breakout: z.number().int().min(0).max(4), locations: z.array(z.enum(["forehead", "cheeks", "chin", "jaw", "back"])), stress: z.enum(["Low", "Medium", "High"]).nullable(), periodWeek: z.boolean().nullable(), changes: z.string().max(2000), averageSleepH: nullableNumber(24) }).strict();
export const noteSchema = z.object({ ...common, kind: z.literal("note"), category: z.enum(["training", "pain", "skill", "general"]), text: z.string().min(1).max(4000) }).strict();
export const photoKinds = ["body_front", "body_side", "body_back", "body_glute45", "face_front", "face_left", "face_right"] as const;
export const photoSchema = z.object({ ...common, kind: z.literal("photo"), photoKind: z.enum(photoKinds), fileRef: z.string().max(220), contentType: z.enum(["image/jpeg", "image/png", "image/webp"]), size: z.number().int().positive().max(12 * 1024 * 1024) }).strict();
export const logItemSchema = z.discriminatedUnion("kind", [workoutSchema, metricSchema, foodSchema, healthSchema, skinSchema, noteSchema, photoSchema]).superRefine((item,ctx)=>{
 if(item.kind==="metric" && item.unit!==(item.metric==="weight"?"kg":"cm"))ctx.addIssue({code:z.ZodIssueCode.custom,path:["unit"],message:"Bodyweight uses kg; body measurements use cm."});
});
export type LogItem = z.infer<typeof logItemSchema>;
export type Workout = z.infer<typeof workoutSchema>;
export type Photo = z.infer<typeof photoSchema>;
export type Metric = z.infer<typeof metricSchema>;
export type Skin = z.infer<typeof skinSchema>;
export type Food = z.infer<typeof foodSchema>;
export type Health = z.infer<typeof healthSchema>;
export const exerciseSchema: z.ZodType<Exercise> = z.object({ id: z.string().min(1).max(100), name: z.string().min(1).max(160), aliases: z.array(z.string().max(100)).max(20), day: z.number().int().min(0).max(6), block: z.enum(["warm-up", "main", "core", "finisher"]), sets: nullableNumber(80), repsMin: nullableNumber(1000), repsMax: nullableNumber(1000), prescription: z.string().max(1000), rest: z.string().max(160), tip: z.string().max(800), howTo: z.array(z.string().max(1000)).max(20), isKeyLift: z.boolean(), unit: z.string().max(60), increment: z.string().max(180), startingWeight: z.union([z.number(), z.string()]).optional(), ramp: z.array(z.string()).optional(), underReview: z.boolean().optional() });
export const sessionSchema: z.ZodType<Session> = z.object({ day: z.number().int().min(0).max(6), name: z.string().max(80), focus: z.string().max(300), warmup: z.array(z.string().max(1000)).max(30), exercises: z.array(exerciseSchema).max(40), notes: z.array(z.string().max(1000)).max(20), customSwim: z.boolean().optional() });
export const planSchema = z.array(sessionSchema).length(7).refine(p => new Set(p.map(s => s.day)).size === 7, "Each weekday must appear once").refine(p => { const ids = p.flatMap(s => s.exercises.map(e => e.id)); return new Set(ids).size === ids.length; }, "Exercise IDs must be unique");
export type PlanChange = {
    id: string;
    createdAt: string;
    request: string;
    summary: string;
    before: Session[];
    after: Session[];
    status: "proposed" | "applied" | "cancelled" | "undone";
    baseVersion: number;
    appliedAt?: string;
    undoneAt?: string;
    note?: string;
};
export type ChatMessage = {
    id: string;
    role: "user" | "assistant";
    text: string;
    createdAt: string;
    itemIds?: string[];
    proposalId?: string;
    clarification?: boolean;
    pendingText?: string;
};
export type TrainingSession = {id:string;date:string;startedAt:string;lastActivityAt:string;endedAt:string|null;activeExerciseId:string|null;activeExerciseName:string|null;activeUnit:string|null;lastWeightKg:number|null};
export type AppData = {
    activeSession?: TrainingSession | null;
    sessions?: TrainingSession[];
    /** Merged exercise IDs → the exercise they were merged into. */
    exerciseAliases?: Record<string, string>;
    /** Days the user marked as 训练日/休息日 by hand. */
    dayTypes?: Record<string, "training" | "rest">;
    /** Last time the Health shortcut synced, for the "sync stopped" reminder. */
    healthLastSync?: string | null;
    /** Opaque data version; the client sends it back to skip unchanged reloads. */
    version?: string;
    settings: Settings;
    plan: Session[];
    planVersion: number;
    items: LogItem[];
    changes: PlanChange[];
    messages: ChatMessage[];
    aiEnabled: boolean;
    today: string;
};
export function seedItems(): LogItem[] { return []; }
export function activePlan(plan: Session[], date: string, settings: Settings = DEFAULT_SETTINGS): Session[] {
 return plan.map(original => {
    const session = structuredClone(original);
    if (!session.customSwim && session.exercises.some(e => /^wed-(oct|nov|dec)-/.test(e.id))) {
        const month = settings.swimMonth || (date > "2026-12-31" ? 12 : Math.min(12, Math.max(10, Number(date.slice(5, 7)))));
        const stage = SWIM_STAGES.find(s => s.month === month)!;
        const extra = session.exercises.filter(e => !/^wed-(oct|nov|dec)-/.test(e.id));
        session.exercises = [...structuredClone(stage.exercises).map(e => ({ ...e, day: session.day })), ...extra];
        session.focus = stage.focus;
        if (date > "2026-12-31" && settings.swimMonth === 0) {
            session.notes.unshift("No new swim stage was supplied after December 2026. Select a stage in Settings or update your plan.");
            session.focus = "December stage · awaiting your next plan";
        }
    }
    return session;
 });
}
export function sessionForDate(plan: Session[], date: string, settings: Settings): Session {
    const session = activePlan(plan, date, settings).find(s => s.day === dayOf(date))!;
    const week = blockWeek(date, settings.blockStart);
    session.exercises = session.exercises.map(e => {
      let sets = e.sets;
      if (week >= 5 && ["tue-hipthrust", "thu-squat"].includes(e.id) && e.prescription.includes("4th set")) sets = 4;
      const deload = week > 0 && week % 9 === 0;
      if (deload && sets !== null) sets = Math.max(1, Math.ceil(sets / 2));
      let prescription = e.prescription;
      if (sets !== e.sets && sets !== null) prescription = prescription.replace(/^\d+(?:[–-]\d+)?(?=\s*(?:×|x|round|set))/, String(sets));
      if (deload) prescription = `${prescription.replace(/hard/gi, "easy")} · Easy effort; half volume (deload)`;
      return { ...e, sets, prescription, howTo: deload ? [`Today's prescription: ${prescription}.`, ...e.howTo.map(t => t.replace(/\b\d+\s*[×x]\s*/g, sets === null ? "$&" : `${sets} × `).replace(/hard/gi, "easy"))] : e.howTo };
    });
    return session;
}
export function allExercises(plan: Session[]) { return plan.flatMap(s => s.exercises); }
export function workoutSessions(items: LogItem[], id: string): Workout[] {
 const groups = new Map<string, Workout>();
 const rows = items.filter((i): i is Workout => i.kind === "workout" && i.exerciseId === id && i.sets.some(s => !s.isWarmup)).sort((a,b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
 for (const w of rows) { const key = `${w.trainingSessionId??w.date}|${w.exerciseName}|${w.unit}`; const prev = groups.get(key); groups.set(key, prev ? {...w, sets:[...prev.sets,...w.sets], pain:prev.pain || w.pain} : structuredClone(w)); }
 return [...groups.values()].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
}
export function latestWorkout(items: LogItem[], id: string, before?: string) { return workoutSessions(items,id).filter(w=>!before || w.date < before)[0]; }
export const metricLabels = {weight:'体重',waist:'腰围',hips:'臀围',thigh:'大腿围',arm:'臂围'};
export const feelLabels = {Easy:'轻松',OK:'适中',Hard:'吃力'};
/** Human-readable load that keeps per-side, per-hand, added and assisted loads distinct. */
export function loadText(weightKg:number|null,unit:string){
 if(weightKg===null)return unit==='bodyweight'?'自重':'';
 switch(unit){case 'kg/side':return `每侧 ${weightKg} kg`;case 'kg/hand':return `单手 ${weightKg} kg`;case 'added kg':return `加重 ${weightKg} kg`;case 'assisted kg':return `辅助 ${weightKg} kg`;case 'kg':return `${weightKg} kg`;default:return `${weightKg} ${unit}`;}
}
export function setSummary(w: Workout) {
 const working=w.sets.filter(s=>!s.isWarmup);
 // Watch workouts carry no sets: show time, distance, heart rate, effort and energy instead.
 if(!w.sets.length){const clock=(iso:string)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Pacific/Auckland',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso));const parts=[w.startedAt&&w.endedAt?clock(w.startedAt)+'–'+clock(w.endedAt):'',w.durationMin!=null?Math.round(w.durationMin)+' 分钟':'',w.distanceM?(w.distanceM>=1000?(w.distanceM/1000).toFixed(2)+' km':Math.round(w.distanceM)+' 米'):'',w.avgHr?'平均心率 '+Math.round(w.avgHr):'',w.maxHr?'最高 '+Math.round(w.maxHr):'',w.effort?'强度 '+Math.round(w.effort)+'/10':'',w.energyKcal?Math.round(w.energyKcal)+' kcal':''].filter(Boolean);return parts.length?parts.join(' · '):w.notes||'已记录';}
 // Warm-up-only entries still show their sets, clearly labelled.
 const sets=working.length?working:w.sets;
 return (working.length?'':'热身 ')+sets.map(s=>[loadText(s.weightKg,w.unit),s.reps!==null?s.reps+' 次':s.durationSec!==null?s.durationSec+' 秒':s.distanceM!==null?s.distanceM+' 米':'次数未记',s.side==='left'?'左侧':s.side==='right'?'右侧':'',s.feel?feelLabels[s.feel]:''].filter(Boolean).join(' × ')).join('；');
}
export function itemSummary(item: LogItem):string {
 switch(item.kind){
 case 'workout':return (item.exerciseName||item.session)+'：'+setSummary(item)+(item.pain?' · 有疼痛':'');
 case 'metric':return metricLabels[item.metric]+'：'+item.value+' '+item.unit;
 case 'food':return item.description+' · '+(item.calories===null?'热量未记':Math.round(item.calories)+' kcal')+' · '+(item.protein===null?'蛋白质未记':item.protein+' g 蛋白质')+(item.isEstimate?'（估算）':'');
 case 'health':return [item.sleepH!==null?'睡眠 '+item.sleepH+' 小时':'',item.steps!==null?'步数 '+item.steps.toLocaleString('zh-CN'):'',item.activeEnergyKcal!=null?'活动消耗 '+Math.round(item.activeEnergyKcal)+' kcal':'',item.basalEnergyKcal!=null?'静息消耗 '+Math.round(item.basalEnergyKcal)+' kcal':'',item.restingHeartRate!=null?'静息心率 '+item.restingHeartRate+' bpm':'',item.hrvMs!=null?'HRV '+item.hrvMs+' ms':'',item.exerciseMin!=null?'运动 '+item.exerciseMin+' 分钟':'',item.wristTempC!=null?'手腕温度 '+item.wristTempC.toFixed(1)+'°C':'',item.creatineTaken!==null?'肌酸 '+(item.creatineTaken?item.creatineG!==null?item.creatineG+' g':'已服用':'未服用'):''].filter(Boolean).join(' · ');
 case 'photo':return '身体照片';case 'skin':return '皮肤记录 '+item.breakout+'/4';case 'note':return item.text;
 }
}
export function isHealthImport(item:Pick<LogItem,'id'>){return item.id.startsWith('health-');}
export function dailyHealthValue(items:LogItem[],date:string,key:'sleepH'|'steps'|'creatineG'|'activeEnergyKcal'|'basalEnergyKcal'|'restingHeartRate'|'hrvMs'|'exerciseMin'){
 const candidates=items.filter((i):i is Health=>i.kind==='health'&&i.date===date&&i[key]!=null).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
 const manual=candidates.filter(i=>!isHealthImport(i));return (manual.length?manual:candidates).at(-1)?.[key]??null;
}
export function dailyWeight(items:LogItem[],date:string,metric:Metric['metric']='weight'){
 const rows=items.filter((i):i is Metric=>i.kind==='metric'&&i.date===date&&i.metric===metric).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
 const manual=rows.filter(i=>!isHealthImport(i));if(manual.length)return manual.reduce((n,i)=>n+i.value,0)/manual.length;return rows.at(-1)?.value??null;
}
export function dailyTotals(items:LogItem[],date:string){
 const day=items.filter(i=>i.date===date),meals=day.filter((i):i is Food=>i.kind==='food');
 return {protein:meals.reduce((n,m)=>n+(m.protein??0),0),calories:meals.reduce((n,m)=>n+(m.calories??0),0),fat:meals.reduce((n,m)=>n+(m.fat??0),0),carbs:meals.reduce((n,m)=>n+(m.carbs??0),0),hasFood:meals.length>0,hasProtein:meals.some(m=>m.protein!==null),hasCalories:meals.some(m=>m.calories!==null),partialProtein:meals.some(m=>m.protein===null),partialCalories:meals.some(m=>m.calories===null),steps:dailyHealthValue(items,date,'steps'),sleep:dailyHealthValue(items,date,'sleepH'),creatine:dailyHealthValue(items,date,'creatineG'),activeEnergyKcal:dailyHealthValue(items,date,'activeEnergyKcal'),restingHeartRate:dailyHealthValue(items,date,'restingHeartRate'),hrvMs:dailyHealthValue(items,date,'hrvMs'),exerciseMin:dailyHealthValue(items,date,'exerciseMin'),training:day.filter((i):i is Workout=>i.kind==='workout'),weight:dailyWeight(items,date)};
}
export function metricSeries(items:LogItem[],metric:Metric['metric']){
 const dates=[...new Set(items.filter(i=>i.kind==='metric'&&i.metric===metric).map(i=>i.date))].sort();
 const rows=dates.map(date=>({date,value:dailyWeight(items,date,metric)!}));
 return rows.map(r=>{const range=rows.filter(x=>x.date>=addDays(r.date,-6)&&x.date<=r.date);return {...r,average:range.reduce((n,x)=>n+x.value,0)/range.length,days:range.length};});
}
export function weeklyAverages(items: LogItem[], anchor: string) { const start = weekStart(anchor); const dates = Array.from({ length: 7 }, (_, n) => addDays(start, n)).filter(d => d <= anchor); const totals = dates.map(d => dailyTotals(items, d)); const avg = (vals: number[]) => ({ value: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, days: vals.length }); return { protein: avg(totals.filter(d => d.hasProtein && !d.partialProtein).map(d => d.protein)), calories: avg(totals.filter(d => d.hasCalories && !d.partialCalories).map(d => d.calories)), sleep: avg(totals.flatMap(d => d.sleep === null ? [] : [d.sleep])), steps: avg(totals.flatMap(d => d.steps === null ? [] : [d.steps])) }; }
export type Suggestion = {
    id: string;
    title: string;
    text: string;
    type: "progress" | "hold" | "care" | "info";
};
export function liftSuggestion(ex: Exercise, items: LogItem[], date: string, settings: Settings): Suggestion {
    const generalPain = items.filter(i=>i.kind === "note" && i.category === "pain" && i.date <= date).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt))[0];
    if (generalPain?.kind === "note" && !/resolved|pain.free|no (?:more )?pain/i.test(generalPain.text)) return {id:ex.id,title:ex.name,type:"care",text:"A pain note is unresolved. Hold progression and log which exercise it affects, or confirm that the pain has resolved."};
    const logs = items.filter((i): i is Workout => i.kind === "workout" && i.exerciseId === ex.id && i.date <= date).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const painIndex = logs.findIndex(l => l.pain);
    const resolutionIndex = logs.findIndex(l => l.painResolved);
    if (painIndex >= 0 && (resolutionIndex < 0 || resolutionIndex > painIndex)) {
        const w = logs[painIndex];
        return { id: ex.id, title: ex.name, type: "care", text: `Pain was reported. Hold progression until you confirm it has resolved.${(w.painScore ?? 0) > 3 || (w.painWeeks ?? 0) > 2 ? " Consider seeing a physio." : ""}` };
    }
    const eligible = resolutionIndex >= 0 && painIndex >= 0 ? logs.slice(0,resolutionIndex + (logs[resolutionIndex].sets.length ? 1 : 0)) : logs;
    const working = workoutSessions(eligible, ex.id).filter(w=>!w.pain);
    const last = working[0];
    if (!last)
        return { id: ex.id, title: ex.name, type: "info", text: "Log a working session and its effort to get a progression suggestion." };
    if (blockWeek(date, settings.blockStart) % 9 === 0 && blockWeek(date, settings.blockStart) > 0)
        return { id: ex.id, title: ex.name, type: "hold", text: "Deload week: keep effort Easy and do half the usual sets (round up)." };
    const sets = last.sets.filter(s => !s.isWarmup);
    const required = last.expectedSets ?? ex.sets ?? sets.length;
    const top = last.repMax ?? ex.repsMax;
    const enough = sets.filter(s => s.side !== "right").length >= required && (!sets.some(s => s.side !== "both") || sets.filter(s => s.side === "right").length >= required);
    const unknownEffort = sets.some(s => s.feel === null);
    const hard = sets.some(s => s.feel === "Hard");
    if (unknownEffort)
        return { id: ex.id, title: ex.name, type: "hold", text: "Keep the load for now. Add Easy, OK or Hard to your last log before progressing." };
    const recent = [...new Set(working.map(w => w.date))].slice(0, 3).map(d => working.find(w => w.date === d)!);
    const topWeight = (w: Workout) => Math.max(...w.sets.filter(s => !s.isWarmup).map(s => s.weightKg ?? 0));
    const performance = (w: Workout) => JSON.stringify(w.sets.filter(s=>!s.isWarmup).map(s=>[s.weightKg,s.notch,s.reps,s.durationSec,s.distanceM,s.side]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
    const stuck = recent.length === 3 && recent.every(w => w.sets.filter(s => !s.isWarmup).length >= (w.expectedSets ?? ex.sets ?? 1)) && recent.every(w => performance(w) === performance(recent[0])) && topWeight(last) > 0 && (!top || sets.some(s=>(s.reps??0)<top) || hard);
    if (stuck)
        return { id: ex.id, title: ex.name, type: "hold", text: `Three sessions at the same load and reps. Consider reducing about 10% (from ${topWeight(last)} to ${(topWeight(last) * .9).toFixed(1)} ${ex.unit}) and building back; use an available load.` };
    if (!enough || !top || hard || sets.some(s => (s.reps ?? 0) < top))
        return { id: ex.id, title: ex.name, type: "hold", text: "Keep the same load and build toward the top of the rep range on every working set, with 1–2 reps left." };
    if (ex.unit === "bar height notch" && sets.some(s => s.feel !== "Easy"))
        return { id: ex.id, title: ex.name, type: "hold", text: "Keep this height until 5 clean reps per arm feel Easy on every set." };
    if (recent.length > 1 && dayDiff(recent[0].date, recent[1].date) < 7 && topWeight(recent[0]) > topWeight(recent[1]))
        return { id: ex.id, title: ex.name, type: "hold", text: "You increased the load less than a week ago. Slow down and consolidate this weight; small increases every 1–3 weeks are normal." };
    return { id: ex.id, title: ex.name, type: "progress", text: `Top reps reached on all ${required} working sets without Hard effort. Next session: ${ex.increment.replace(/^\+/, "add ")}.` };
}
export function suggestions(data: Pick<AppData, "items" | "settings" | "plan">, date: string): Suggestion[] { const { items, settings, plan } = data; const out: Suggestion[] = []; const avg = weeklyAverages(items, date); if (avg.protein.value !== null && avg.protein.days >= 2 && settings.proteinMin !== null && avg.protein.value < settings.proteinMin)
    out.push({ id: "protein", title: "Make protein a priority", type: "info", text: `${Math.round(avg.protein.value)} g/day across ${avg.protein.days} logged days this week; your target is ${settings.proteinMin}–${settings.proteinMax} g.` }); const weights = metricSeries(items, "weight"); const current = weights.filter(w => w.date >= addDays(date, -6) && w.date <= date); const previous = weights.filter(w => w.date >= addDays(date, -13) && w.date <= addDays(date, -7)); if (current.length >= 3 && previous.length >= 3 && settings.phase === "fat_loss") {
    const change = current.reduce((s, x) => s + x.value, 0) / current.length - previous.reduce((s, x) => s + x.value, 0) / previous.length;
    out.push({ id: "weight", title: "Your weight trend", type: "info", text: `Average ${change < 0 ? "down" : "up"} ${Math.abs(change).toFixed(2)} kg versus the previous 7 days. ${change <= -.25 && change >= -.5 ? "Within your 0.25–0.5 kg/week target." : "Your target is a gradual 0.25–0.5 kg loss per week."}` });
} const waists = metricSeries(items, "waist").filter(w => w.date <= date); const last = waists.at(-1); const earlier = last ? waists.filter(w => dayDiff(last.date, w.date) >= 25 && dayDiff(last.date, w.date) <= 35).at(-1) : null; if (last && earlier && last.value - earlier.value > 1 && settings.phase === "fat_loss")
    out.push({ id: "waist", title: "Check your calorie intake", type: "info", text: `Waist is up ${(last.value - earlier.value).toFixed(1)} cm over about 4 weeks. Check consistency and calories; one measurement can vary.` }); const lifts = plan.flatMap(s => s.exercises).filter(e => e.isKeyLift && latestWorkout(items, e.id)); const advice = lifts.map(e => liftSuggestion(e, items, date, settings)); return [...advice.filter(a => a.type === "care"), ...out, ...advice.filter(a => a.type !== "care")].slice(0, 3); }
export function dueChecks(items: LogItem[], today: string) {
 const latest = (filter:(i:LogItem)=>boolean)=>items.filter(i=>i.date<=today&&filter(i)).map(i=>i.date).sort().at(-1);
 const sunday=addDays(weekStart(today),6),dueSunday=dayOf(today)===0?sunday:addDays(sunday,-7);
 const measurementMissing=["waist"].filter(m=>{const d=latest(i=>i.kind==="metric"&&i.metric===m);return !d||dayDiff(today,d)>=14;});
 const bodyMissing=photoKinds.filter(p=>p.startsWith("body_")).filter(p=>{const d=latest(i=>i.kind==="photo"&&i.photoKind===p);return !d||dayDiff(today,d)>=14;});
 const faceMissing=photoKinds.filter(p=>p.startsWith("face_")).filter(p=>{const d=latest(i=>i.kind==="photo"&&i.photoKind===p);return !d||d<dueSunday;});
 const skin=latest(i=>i.kind==="skin");
 return {measurements:measurementMissing.length>0,bodyPhotos:bodyMissing.length>0,facePhotos:faceMissing.length>0,skin:!skin||skin<dueSunday,measurementMissing,bodyMissing,faceMissing,measurementDue:today,bodyDue:today,faceDue:dueSunday};
}
