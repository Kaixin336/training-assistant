/**
 * Training and body insights computed from the log. Pure functions so the Today, Strength, Weekly and
 * Body screens (and the chat reply) agree, and so each rule can be tested. Every message is advice
 * from observable data; nothing here claims to measure muscle or fat directly.
 */
import { addDays, dailyHealthValue, dayDiff, metricSeries, weekStart, workoutSessions, type Health, type LogItem, type Settings, type Workout } from "./domain";
import { DEFAULT_WEEKLY_LOSS, planOf, planTargets, dayType, planStart, REVIEW_DAYS, type DayType } from "./diet";

const working = (w: Workout) => w.sets.filter(s => !s.isWarmup);
const LOADED = new Set(["kg", "kg/side", "kg/hand", "added kg"]);
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const median = (values: number[]) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sd = (values: number[]) => { const m = mean(values); return m === null || values.length < 2 ? null : Math.sqrt(values.reduce((n, v) => n + (v - m) ** 2, 0) / (values.length - 1)); };

/** Epley, sets of 1–12 reps only (higher reps make the estimate unreliable). */
export function e1rm(w: Pick<Workout, "sets" | "unit">): number | null {
  if (!LOADED.has(w.unit)) return null;
  const usable = working(w as Workout).filter(s => s.weightKg !== null && s.reps !== null && s.reps >= 1 && s.reps <= 12);
  return usable.length ? Math.max(...usable.map(s => s.weightKg! * (1 + s.reps! / 30))) : null;
}

/* ── Muscle groups ─────────────────────────────────────────────────────── */
export const MUSCLES = ["胸", "背", "肩", "二头", "三头", "股四头", "腘绳", "臀", "小腿", "核心"] as const;
export type Muscle = (typeof MUSCLES)[number];
// First match wins, so specific names come before general ones.
const MUSCLE_RULES: [RegExp, Muscle[], Muscle[]][] = [
  [/腿弯举|leg ?curl/i, ["腘绳"], []],
  [/腿屈伸|leg ?extension/i, ["股四头"], []],
  [/臀推|臀桥|hip ?thrust|glute|外展|abduct|驴踢/i, ["臀"], ["腘绳"]],
  [/罗马尼亚|直腿硬拉|rdl|早安/i, ["腘绳", "臀"], ["背"]],
  [/硬拉|deadlift/i, ["腘绳", "臀", "背"], ["股四头"]],
  [/深蹲|squat|腿举|leg ?press|哈克|箭步|弓步|保加利亚|lunge|登阶|step.?up/i, ["股四头", "臀"], ["腘绳"]],
  [/提踵|calf/i, ["小腿"], []],
  [/反向飞鸟|后束|面拉|face ?pull|reverse ?fly/i, ["肩"], ["背"]],
  [/侧平举|前平举|lateral|推举|肩推|过头推|overhead|arnold|military/i, ["肩"], ["三头"]],
  [/窄距卧推|close.?grip/i, ["三头", "胸"], ["肩"]],
  [/卧推|推胸|bench|夹胸|飞鸟|俯卧撑|push.?up|双杠|dip|chest|蝴蝶机/i, ["胸"], ["三头", "肩"]],
  [/引体|下拉|划船|row|pull|背|耸肩|shrug/i, ["背"], ["二头"]],
  [/弯举|curl/i, ["二头"], []],
  [/臂屈伸|下压|pushdown|法式|skull|triceps|三头/i, ["三头"], []],
  [/卷腹|平板|核心|crunch|plank|举腿|健腹轮|ab|转体|死虫/i, ["核心"], []],
];
export function musclesOf(name: string): { primary: Muscle[]; secondary: Muscle[] } {
  const rule = MUSCLE_RULES.find(([pattern]) => pattern.test(name));
  return rule ? { primary: rule[1], secondary: rule[2] } : { primary: [], secondary: [] };
}
/** Hard sets per muscle in [from, to]: a primary muscle counts the full set, a secondary one half. */
export function muscleSets(items: LogItem[], from: string, to: string) {
  const sets = Object.fromEntries(MUSCLES.map(m => [m, 0])) as Record<Muscle, number>;
  const unknown = new Set<string>();
  for (const w of items) {
    if (w.kind !== "workout" || w.date < from || w.date > to || !w.exerciseId) continue;
    const count = working(w).length; if (!count) continue;
    const { primary, secondary } = musclesOf(w.exerciseName ?? "");
    if (!primary.length) unknown.add(w.exerciseName ?? "");
    for (const m of primary) sets[m] += count;
    for (const m of secondary) sets[m] += count / 2;
  }
  return { sets, unknown: [...unknown] };
}
export const SETS_RANGE: [number, number] = [10, 20];

/* ── Personal records ──────────────────────────────────────────────────── */
export type Record_ = { exercise: string; text: string };
/** New bests in `added` compared with everything logged before them. */
export function personalRecords(items: LogItem[], added: LogItem[]): Record_[] {
  const addedIds = new Set(added.map(i => i.id));
  const out: Record_[] = [];
  const seen = new Set<string>();
  for (const w of added) {
    if (w.kind !== "workout" || !w.exerciseId || seen.has(w.exerciseId)) continue;
    seen.add(w.exerciseId);
    const now = added.filter((i): i is Workout => i.kind === "workout" && i.exerciseId === w.exerciseId);
    const before = items.filter((i): i is Workout => i.kind === "workout" && i.exerciseId === w.exerciseId && !addedIds.has(i.id));
    if (!before.some(b => working(b).length)) continue;
    const name = w.exerciseName ?? "这个动作";
    const best = (list: Workout[]) => Math.max(0, ...list.map(x => e1rm(x) ?? 0));
    const nowBest = best(now), oldBest = best(before);
    if (nowBest > 0 && oldBest > 0 && nowBest > oldBest + 0.05) { out.push({ exercise: name, text: `${name} 估算 1RM ${nowBest.toFixed(1)} kg（之前最好 ${oldBest.toFixed(1)}）` }); continue; }
    // Same or heavier load for more reps than ever.
    for (const set of now.flatMap(working)) {
      if (set.reps === null) continue;
      const load = set.weightKg ?? 0;
      const prior = before.flatMap(working).filter(s => (s.weightKg ?? 0) >= load && s.reps !== null);
      if (prior.length && set.reps > Math.max(...prior.map(s => s.reps!))) { out.push({ exercise: name, text: `${name} ${load ? `${load} kg ` : ""}做到 ${set.reps} 次，这个重量的最多次数` }); break; }
    }
  }
  return out;
}

/* ── Plateaus ──────────────────────────────────────────────────────────── */
export type Plateau = { id: string; name: string; text: string; tone: "hold" | "care" };
export function plateaus(items: LogItem[], today: string, settings: Settings): Plateau[] {
  const ids = [...new Set(items.filter((i): i is Workout => i.kind === "workout" && !!i.exerciseId && LOADED.has(i.unit) && i.date >= addDays(today, -56)).map(i => i.exerciseId!))];
  const out: Plateau[] = [];
  for (const id of ids) {
    const sessions = workoutSessions(items, id).filter(w => w.date >= addDays(today, -56)).reverse();
    const values = sessions.map(w => ({ date: w.date, value: e1rm(w) })).filter((v): v is { date: string; value: number } => v.value !== null);
    if (values.length < 5) continue;
    const recent = values.slice(-3), earlier = values.slice(0, -3);
    if (dayDiff(recent[2].date, recent[0].date) < 10) continue;
    const bestRecent = Math.max(...recent.map(v => v.value)), bestEarlier = Math.max(...earlier.map(v => v.value));
    const name = sessions.at(-1)!.exerciseName ?? "这个动作";
    if (bestRecent < bestEarlier * .95) out.push({ id, name, tone: "care", text: `${name}最近 3 次比之前的最好成绩低 ${Math.round((1 - bestRecent / bestEarlier) * 100)}%。先看睡眠、饮食和疲劳，必要时安排减载周。` });
    else if (settings.phase !== "fat_loss" && bestRecent <= bestEarlier) out.push({ id, name, tone: "hold", text: `${name}已经 3 次没有超过之前的最好成绩。可以换一个次数区间（如 6–8 改 10–12）或换个变式，减载一周后再冲。` });
  }
  return out;
}

/* ── Training load (heart-rate TRIMP) ──────────────────────────────────── */
/** Banister TRIMP from a workout's average heart rate; strength logs without heart rate count ~2 per hard set. */
export function trainingLoad(items: LogItem[], today: string, settings: Settings) {
  const restValues = items.filter((i): i is Health => i.kind === "health" && i.restingHeartRate != null && i.date >= addDays(today, -28)).map(i => i.restingHeartRate!);
  const rest = median(restValues) ?? 60;
  const peak = Math.max(180, ...items.filter((i): i is Workout => i.kind === "workout" && !!i.maxHr && i.date >= addDays(today, -180)).map(i => i.maxHr!));
  const [a, b] = settings.strengthSex === "female" ? [.86, 1.67] : [.64, 1.92];
  const daily = new Map<string, number>();
  const byDay = new Map<string, Workout[]>();
  for (const item of items) if (item.kind === "workout" && item.date >= addDays(today, -41) && item.date <= today) byDay.set(item.date, [...(byDay.get(item.date) ?? []), item]);
  for (const [date, list] of byDay) {
    const hr = list.filter(w => w.avgHr && w.durationMin);
    let load = hr.reduce((n, w) => { const r = Math.min(1, Math.max(0, (w.avgHr! - rest) / (peak - rest))); return n + w.durationMin! * r * a * Math.exp(b * r); }, 0);
    // A day with sets but no Watch workout (or only a walk) still counts its strength work.
    if (!hr.some(w => /力量|训练/.test(w.exerciseName ?? ""))) load += 2 * list.reduce((n, w) => n + working(w).length, 0);
    if (load > 0) daily.set(date, load);
  }
  const sum = (from: number, to: number) => { let n = 0; for (let d = from; d <= to; d++) n += daily.get(addDays(today, -d)) ?? 0; return n; };
  const acute = sum(0, 6), chronic = sum(0, 27) / 4;
  const firstDay = [...daily.keys()].sort()[0];
  const enough = !!firstDay && dayDiff(today, firstDay) >= 20 && chronic > 0;
  const ratio = enough ? acute / chronic : null;
  const tone = ratio === null ? "" : ratio > 1.5 ? "care" : ratio > 1.3 ? "hold" : ratio < .8 ? "low" : "good";
  const text = ratio === null ? "记录满 3 周后显示负荷对比。"
    : ratio > 1.5 ? "这周负荷比过去一个月的平均高很多，受伤和过度疲劳风险上升。接下来几次别再加量。"
    : ratio > 1.3 ? "这周负荷偏高，注意睡眠和恢复。"
    : ratio < .8 ? "这周负荷偏低。减载或休息周正常；否则可以恢复正常训练量。"
    : "负荷和过去一个月相当，节奏合适。";
  return { acute: Math.round(acute), chronic: Math.round(chronic), ratio, tone, text, daily };
}

/* ── Periodisation: when to deload ─────────────────────────────────────── */
export function weeklyHardSets(items: LogItem[], monday: string) {
  return items.filter((i): i is Workout => i.kind === "workout" && !!i.exerciseId && i.date >= monday && i.date <= addDays(monday, 6)).reduce((n, w) => n + working(w).length, 0);
}
export function deloadAdvice(items: LogItem[], today: string, settings: Settings, extra: { loadRatio: number | null; plateaus: number; lowReadinessDays: number }) {
  const thisMonday = weekStart(today);
  const weeks = Array.from({ length: 10 }, (_, i) => addDays(thisMonday, -7 * (i + 1))).map(monday => ({ monday, sets: weeklyHardSets(items, monday) }));
  // Count full weeks of normal training back to the last light (deload) or empty week.
  let streak = 0;
  for (let i = 0; i < weeks.length; i++) {
    const reference = mean(weeks.slice(i + 1, i + 5).map(w => w.sets).filter(n => n > 0));
    const light = weeks[i].sets === 0 || (reference !== null && weeks[i].sets < reference * .6);
    if (light) break;
    streak++;
  }
  const current = weeklyHardSets(items, thisMonday);
  const limit = settings.phase === "fat_loss" ? 5 : 6;
  const reasons: string[] = [];
  if (streak >= limit) reasons.push(`已经连续练了 ${streak} 周`);
  if (streak >= 3 && (extra.loadRatio ?? 0) > 1.4) reasons.push("近期负荷明显升高");
  if (streak >= 3 && extra.plateaus >= 2) reasons.push(`${extra.plateaus} 个动作停滞或下降`);
  if (streak >= 3 && extra.lowReadinessDays >= 3) reasons.push("最近几天身体状态偏低");
  const due = reasons.length > 0 && (streak >= limit || reasons.length >= 2);
  return {
    streak, current, due,
    text: due ? `建议安排一周减载：${reasons.join("，")}。减载周保持动作和重量，每个动作的组数减少约一半，不做到力竭。`
      : streak ? `已连续训练 ${streak} 周。${settings.phase === "fat_loss" ? "减脂期" : ""}一般练 ${limit} 周左右安排一次减载。` : "上周是轻松周或没有训练。",
  };
}

/* ── Strength standards (one-rep max ÷ bodyweight) ─────────────────────── */
export const LEVELS = ["入门", "新手", "中级", "高级", "精英"];
const STANDARDS: { lift: string; match: RegExp; exclude?: RegExp; male: number[]; female: number[] }[] = [
  { lift: "卧推", match: /卧推|bench/i, exclude: /哑铃|上斜|下斜|窄距|史密斯|器械/, male: [.5, .75, 1, 1.5, 2], female: [.25, .5, .75, 1, 1.5] },
  { lift: "深蹲", match: /深蹲|squat/i, exclude: /哈克|保加利亚|箭步|高脚杯|史密斯|分腿/, male: [.75, 1.25, 1.5, 2.25, 2.75], female: [.5, .75, 1.25, 1.5, 2] },
  { lift: "硬拉", match: /硬拉|deadlift/i, exclude: /罗马尼亚|直腿|单腿|哑铃/, male: [1, 1.5, 2, 2.5, 3], female: [.5, 1, 1.25, 1.75, 2.5] },
  { lift: "推举", match: /推举|过头推|overhead|military/i, exclude: /哑铃|器械|坐姿/, male: [.35, .55, .75, 1.05, 1.35], female: [.2, .35, .5, .75, 1] },
  { lift: "划船", match: /杠铃划船|barbell row/i, male: [.5, .75, 1, 1.4, 1.75], female: [.3, .4, .65, .9, 1.2] },
];
export function strengthLevel(name: string, unit: string, best: number, bodyweight: number, sex: "male" | "female") {
  if (unit !== "kg" || !bodyweight) return null;
  const standard = STANDARDS.find(s => s.match.test(name) && !s.exclude?.test(name));
  if (!standard) return null;
  const table = standard[sex], ratio = best / bodyweight;
  const index = table.reduce((level, threshold, i) => ratio >= threshold ? i : level, -1);
  const next = table[index + 1];
  return { lift: standard.lift, ratio, level: index >= 0 ? LEVELS[index] : "入门以下", next: next ? { level: LEVELS[index + 1], kg: Math.ceil(next * bodyweight / 2.5) * 2.5 } : null };
}

/* ── Morning readiness ─────────────────────────────────────────────────── */
export function readiness(items: LogItem[], today: string, settings: Settings) {
  const value = (date: string, key: "hrvMs" | "restingHeartRate" | "sleepH" | "wristTempC") => key === "wristTempC"
    ? items.filter((i): i is Health => i.kind === "health" && i.date === date && i.wristTempC != null).at(-1)?.wristTempC ?? null
    : dailyHealthValue(items, date, key);
  const baseline = (key: "hrvMs" | "restingHeartRate" | "wristTempC") => Array.from({ length: 28 }, (_, i) => value(addDays(today, -(i + 1)), key)).filter((v): v is number => v !== null);
  const hrv = value(today, "hrvMs"), rest = value(today, "restingHeartRate"), sleep = value(today, "sleepH"), temp = value(today, "wristTempC");
  if (hrv === null && rest === null && sleep === null && temp === null) return null;
  const reasons: string[] = [], good: string[] = [];
  let penalty = 0;
  const hrvBase = baseline("hrvMs"), hrvMean = mean(hrvBase), hrvSd = sd(hrvBase);
  if (hrv !== null && hrvMean !== null && hrvBase.length >= 7) {
    const z = (hrv - hrvMean) / Math.max(hrvSd ?? 1, hrvMean * .05);
    if (z < -1) { penalty += z < -1.5 ? 2 : 1; reasons.push(`HRV ${Math.round(hrv)} ms，比平时低 ${Math.round((1 - hrv / hrvMean) * 100)}%`); } else good.push("HRV 正常");
  }
  const restBase = median(baseline("restingHeartRate"));
  if (rest !== null && restBase !== null && baseline("restingHeartRate").length >= 7) {
    if (rest - restBase >= 5) { penalty += rest - restBase >= 8 ? 2 : 1; reasons.push(`静息心率 ${Math.round(rest)}，比平时高 ${Math.round(rest - restBase)}`); } else good.push("静息心率正常");
  }
  const need = settings.sleepMin ?? 7;
  if (sleep !== null) { if (sleep < need - 1) { penalty += 2; reasons.push(`只睡了 ${sleep.toFixed(1)} 小时`); } else if (sleep < need) { penalty += 1; reasons.push(`睡了 ${sleep.toFixed(1)} 小时，略少`); } else good.push(`睡了 ${sleep.toFixed(1)} 小时`); }
  const tempBase = median(baseline("wristTempC"));
  if (temp !== null && tempBase !== null && baseline("wristTempC").length >= 5 && temp - tempBase >= .5) { penalty += 2; reasons.push(`夜间手腕温度比平时高 ${(temp - tempBase).toFixed(1)}°C，留意是否要生病`); }
  const level = penalty >= 3 ? "low" : penalty >= 1 ? "fair" : "good";
  return {
    level, reasons, good,
    title: level === "low" ? "状态偏低" : level === "fair" ? "状态一般" : "状态良好",
    advice: level === "low" ? "今天不冲重量：保持或减少组数，或者改成轻松有氧。" : level === "fair" ? "可以正常练，但不追求新纪录。" : "可以按计划正常训练。",
  };
}
export function lowReadinessDays(items: LogItem[], today: string, settings: Settings) {
  return Array.from({ length: 5 }, (_, i) => readiness(items, addDays(today, -i), settings)).filter(r => r?.level === "low").length;
}

/* ── Energy balance: what the weight trend says about actual expenditure ─ */
export function intakeOn(items: LogItem[], date: string) {
  const foods = items.filter(i => i.kind === "food" && i.date === date);
  if (!foods.length || foods.some(f => f.kind === "food" && f.calories === null)) return null;
  return foods.reduce((n, f) => n + (f.kind === "food" ? f.calories ?? 0 : 0), 0);
}
/** Expenditure ≈ average intake − (trend change × 7700 kcal/kg) / days, over the last 21 complete days. */
export function energyBalance(items: LogItem[], today: string) {
  const end = addDays(today, -1), start = addDays(end, -20);
  const intakes = Array.from({ length: 21 }, (_, i) => intakeOn(items, addDays(start, i))).filter((v): v is number => v !== null);
  const weights = metricSeries(items, "weight").filter(p => p.date >= addDays(start, -6) && p.date <= end);
  const at = (date: string) => { const rows = weights.filter(p => p.date > addDays(date, -7) && p.date <= date); return rows.length >= 3 ? mean(rows.map(r => r.value)) : null; };
  const first = at(addDays(start, 6)), last = at(end);
  if (intakes.length < 14 || first === null || last === null) return null;
  const days = 14, change = last - first;
  const intake = mean(intakes)!;
  const expenditure = intake - change * 7700 / days;
  return { intake: Math.round(intake), expenditure: Math.round(expenditure / 10) * 10, perWeek: change / days * 7 };
}

/* ── The plan's own 14-day review rules ────────────────────────────────── */
export type Review = { tone: "good" | "hold" | "care" | ""; title: string; text: string; adjust?: number };
export function dietReview(items: LogItem[], today: string, settings: Settings, signals: { strengthDown: boolean; lowReadinessDays: number }): Review | null {
  const start = planStart(settings);
  if (!start || start > today) return null;
  const day = dayDiff(today, start) + 1;
  const weights = metricSeries(items, "weight");
  const weekAvg = (end: string) => { const rows = weights.filter(p => p.date > addDays(end, -7) && p.date <= end); return rows.length >= 3 ? mean(rows.map(r => r.value)) : null; };
  const changes = [0, 7, 14].map(offset => { const a = weekAvg(addDays(today, -offset)), b = weekAvg(addDays(today, -offset - 7)); return a !== null && b !== null ? a - b : null; });
  const [loss, fastest] = planOf(settings)?.weeklyLossKg ?? DEFAULT_WEEKLY_LOSS;
  const waists = metricSeries(items, "waist");
  const waistNow = waists.filter(p => p.date > addDays(today, -7)).at(-1)?.value ?? null, waistBefore = waists.filter(p => p.date <= addDays(today, -14)).at(-1)?.value ?? null;
  const waistFlat = waistNow === null || waistBefore === null || waistNow - waistBefore > -.5;
  const fmt = (n: number) => `${n < 0 ? "降" : "升"} ${Math.abs(n).toFixed(2)} kg`;
  if (signals.strengthDown || signals.lowReadinessDays >= 3) return { tone: "care", title: "提前复盘", text: `${signals.strengthDown ? "训练表现在下降" : "最近恢复偏差"}。按计划规则：很饿、训练明显下降或恢复差时提前复盘，必要时每天加回 100–150 kcal。`, adjust: 120 };
  if (day < REVIEW_DAYS) return { tone: "", title: `执行第 ${day} 天`, text: `先稳定执行 ${REVIEW_DAYS} 天，第 ${REVIEW_DAYS} 天后按体重 7 日均值和腰围调整。${changes[0] !== null ? `目前 7 日均重比上周${fmt(changes[0])}。` : ""}` };
  if (changes[0] === null) return { tone: "", title: "体重数据不够", text: "最近两周每周至少称 3 天，才能按计划规则判断。" };
  if (changes[0] <= -loss && changes[0] >= -fastest) return { tone: "good", title: "继续当前计划，不用改", text: `7 日均重比上周${fmt(changes[0])}，在 ${loss}–${fastest} kg 的目标内。` };
  const flatWeeks = changes.filter(c => c !== null && c > -loss).length;
  if (flatWeeks >= 2 && waistFlat) return { tone: "hold", title: "连续两周基本没变", text: "体重周均值和腰围都基本不变。按计划规则：每天再减 100–150 kcal，或每天多走 1500–2000 步。", adjust: -120 };
  if (changes[0] < -fastest) return { tone: "hold", title: "掉得偏快", text: `7 日均重比上周${fmt(changes[0])}，超过 ${fastest} kg。如果饿或训练下降，每天加回 100–150 kcal。` };
  return { tone: "", title: "再观察一周", text: `7 日均重比上周${fmt(changes[0])}。单周波动正常，连续 2 周不降再调整。` };
}

/** Today's targets from the plan (or the general goals when the plan is off). */
export function nutritionTargets(items: LogItem[], date: string, today: string, settings: Settings, chosen: Record<string, DayType> = {}) {
  const type = dayType(items, date, today, settings, chosen);
  const start = planStart(settings);
  const t = planTargets(type, settings);
  if (start && start <= date && t) return { type, kcal: t.kcal, protein: t.protein, fromPlan: true };
  return { type, kcal: settings.calorieTarget, protein: settings.proteinMin, fromPlan: false };
}
