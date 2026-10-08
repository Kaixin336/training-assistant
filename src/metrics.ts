import { addDays, dailyWeight, dayDiff, metricSeries, workoutSessions, type AppData, type LogItem, type Metric, type Settings, type Workout, type WorkingSet } from "@/lib/domain";
import { phaseLabels } from "./labels";

/** Loads that can be compared as kilograms; assisted and bodyweight work is compared by reps. */
export const LOADED = new Set(["kg", "kg/side", "kg/hand", "added kg"]);
export type Measure = "e1rm" | "top" | "volume" | "reps";
export const measureLabels: Record<Measure, string> = { e1rm: "估算 1RM", top: "最重一组", volume: "训练量", reps: "总次数" };
export const primaryMeasure = (unit: string): Measure => LOADED.has(unit) ? "e1rm" : "reps";
const working = (w: Workout) => w.sets.filter(s => !s.isWarmup);

export function sessionValue(w: Workout, measure: Measure): number | null {
  const sets = working(w).filter(s => s.reps !== null);
  if (!sets.length) return null;
  if (measure === "reps") return sets.reduce((n, s) => n + (s.reps ?? 0), 0);
  const loaded = sets.filter(s => s.weightKg !== null);
  if (!loaded.length) return null;
  if (measure === "top") return Math.max(...loaded.map(s => s.weightKg!));
  if (measure === "volume") return loaded.reduce((n, s) => n + s.weightKg! * (s.reps ?? 0), 0);
  // Epley; beyond 12 reps the estimate is unreliable, so those sets are ignored.
  const usable = loaded.filter(s => s.reps! >= 1 && s.reps! <= 12);
  return usable.length ? Math.max(...usable.map(s => s.weightKg! * (1 + s.reps! / 30))) : null;
}

export type ExerciseInfo = { id: string; name: string; unit: string; sessions: Workout[]; last: string; measure: Measure; values: number[] };
/** All exercises ever logged, newest first. `sessions` merge sets logged across several messages. */
export function exerciseList(items: LogItem[]): ExerciseInfo[] {
  const ids = new Map<string, Workout>();
  for (const item of items) if (item.kind === "workout" && item.exerciseId && item.sets.some(s => !s.isWarmup)) ids.set(item.exerciseId, item);
  return [...ids.values()].map(sample => {
    const sessions = workoutSessions(items, sample.exerciseId!);
    const measure = primaryMeasure(sample.unit);
    const values = [...sessions].reverse().map(w => sessionValue(w, measure)).filter((v): v is number => v !== null);
    return { id: sample.exerciseId!, name: sample.exerciseName ?? sample.session, unit: sample.unit, sessions, last: sessions[0]?.date ?? sample.date, measure, values };
  }).sort((a, b) => b.last.localeCompare(a.last) || b.sessions.length - a.sessions.length);
}

export type Comparison = { base: number; now: number; ratio: number; tone: "good" | "hold" | "care" | ""; text: string; short: string };
/** Current phase versus its own start. Never claims a change in muscle mass. */
export function phaseComparison(sessions: Workout[], settings: Settings, measure: Measure): Comparison | null {
  const start = settings.phaseStart;
  if (!start || settings.phase === "unspecified") return null;
  const valued = [...sessions].reverse().map(w => ({ w, value: sessionValue(w, measure) })).filter((x): x is { w: Workout; value: number } => x.value !== null);
  const before = valued.filter(x => x.w.date < start).slice(-2);
  const early = valued.filter(x => x.w.date >= start && x.w.date < addDays(start, 14)).slice(0, 2);
  const baseline = before.length ? before : early;
  const recent = valued.filter(x => x.w.date >= start).slice(-2);
  if (!baseline.length || !recent.length || recent.every(r => baseline.includes(r))) return null;
  const base = Math.max(...baseline.map(x => x.value)), now = Math.max(...recent.map(x => x.value)), ratio = now / base;
  const pct = Math.round((ratio - 1) * 100), unit = measure === "reps" ? "次" : "kg", digits = measure === "reps" ? 0 : 1;
  const short = `${pct >= 0 ? "+" : ""}${pct}%`;
  const detail = `${phaseLabels[settings.phase]}开始时约 ${base.toFixed(digits)} ${unit}，最近 ${now.toFixed(digits)} ${unit}。`;
  if (recent.some(x => x.w.pain)) return { base, now, ratio, tone: "care", short, text: `${detail}最近有疼痛记录，先恢复，不看数字加重。` };
  if (settings.phase === "fat_loss") return ratio >= .97 ? { base, now, ratio, tone: "good", short, text: `${detail}减脂中力量保持住了。` } : { base, now, ratio, tone: "hold", short, text: `${detail}有所下降。先看睡眠、蛋白质和减重速度是否过快。` };
  if (settings.phase === "lean_gain") return ratio > 1.02 ? { base, now, ratio, tone: "good", short, text: `${detail}同条件下在进步。` } : { base, now, ratio, tone: "hold", short, text: `${detail}暂时持平；增肌期的进步以周和月计。` };
  return { base, now, ratio, tone: "", short, text: detail };
}

/**
 * Conservative next-session advice. Pain or missing effort data always means "hold";
 * a cut aims to keep performance; a build adds reps first and load only at the top of the range.
 */
export function nextStep(sessions: Workout[], settings: Settings, unit: string): { tone: string; text: string } | null {
  const last = sessions[0];
  if (!last) return null;
  const sets = working(last);
  const painIndex = sessions.findIndex(w => w.pain), resolvedIndex = sessions.findIndex(w => w.painResolved);
  if (painIndex >= 0 && (resolvedIndex < 0 || resolvedIndex > painIndex)) return { tone: "care", text: "最近有疼痛且未确认恢复：先不加重，可减轻重量或换成不痛的动作。恢复后说一声“已经不疼了”。" };
  const repMax = last.repMax, repMin = last.repMin;
  const hard = sets.some(s => s.feel === "Hard"), unknown = sets.some(s => s.feel === null);
  const topWeight = Math.max(0, ...sets.map(s => s.weightKg ?? 0));
  const atTop = repMax !== null && sets.length > 0 && sets.every(s => (s.reps ?? 0) >= repMax);
  if (settings.phase === "fat_loss") {
    if (hard) return { tone: "hold", text: `下次保持 ${topWeight ? `${topWeight} kg` : "同样的负荷"}，做到同样的次数就算成功。减脂期的目标是守住力量，不是破纪录。` };
    return { tone: "good", text: `下次保持 ${topWeight ? `${topWeight} kg` : "同样的负荷"}${atTop ? "；感觉有余力的话可以尝试小幅加重，但守住次数更重要" : "，争取每组次数和上次一样或多 1 次"}。` };
  }
  if (settings.phase === "lean_gain") {
    if (repMax === null || unknown) return { tone: "hold", text: `下次保持重量，每组多做 1 次。告诉我目标次数（如“卧推目标 6–10 次”）并记下每组感觉，我才能判断什么时候该加重。` };
    if (atTop && !hard) return { tone: "good", text: `上次每组都到了 ${repMax} 次且不吃力：下次可以加一小档（${LOADED.has(unit) ? "约 2.5 kg" : "更难的变式或加重"}），次数回到 ${repMin ?? repMax - 2} 左右重新往上做。` };
    return { tone: "hold", text: `保持重量，把每组做到 ${repMax} 次后再加重。不用每次都加。` };
  }
  return { tone: "", text: "保持同样的负荷，关注动作质量和恢复。" };
}

export type DayExercise = { key: string; id: string | null; name: string; unit: string; rows: { set: WorkingSet; record: Workout; index: number }[]; records: Workout[]; previous: Workout | null };
/** One day's training grouped by exercise, in the order it was logged, with last session for reference. */
export function dayExercises(items: LogItem[], date: string): DayExercise[] {
  const records = items.filter((i): i is Workout => i.kind === "workout" && i.date === date).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const groups = new Map<string, DayExercise>();
  for (const record of records) {
    const key = `${record.exerciseId ?? record.exerciseName ?? record.id}|${record.unit}`;
    const group = groups.get(key) ?? { key, id: record.exerciseId, name: record.exerciseName ?? record.session, unit: record.unit, rows: [], records: [], previous: record.exerciseId ? workoutSessions(items, record.exerciseId).find(w => w.date < date) ?? null : null };
    record.sets.forEach((set, index) => group.rows.push({ set, record, index }));
    group.records.push(record);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function formatLoad(weight: number | null, unit: string) {
  if (unit === "bodyweight") return weight === null ? "自重" : `${weight}`;
  if (weight === null) return "—";
  if (unit === "added kg") return `+${weight}`;
  if (unit === "assisted kg") return `−${weight}`;
  return `${weight}`;
}
export const setText = (s: WorkingSet, unit: string) => `${unit === "bodyweight" ? "" : `${formatLoad(s.weightKg, unit)}×`}${s.reps ?? (s.durationSec !== null ? `${s.durationSec}s` : "?")}`;
export const sessionText = (w: Workout) => working(w).map(s => setText(s, w.unit)).join("  ") || "—";

/** Bodyweight trend: 7-day mean now vs the 7 days before, as kg and % per week. */
export function weightTrend(items: LogItem[], today: string) { return metricTrend(items, today, "weight", 2); }
/** The same for any measurement; waist is measured about twice a week, so one reading per week is enough. */
export function metricTrend(items: LogItem[], today: string, metric: Metric["metric"], minPoints: number) {
  const series = metricSeries(items, metric);
  const window = (end: string) => series.filter(p => p.date > addDays(end, -7) && p.date <= end);
  const now = window(today), before = window(addDays(today, -7));
  const mean = (rows: { value: number }[]) => rows.length ? rows.reduce((n, r) => n + r.value, 0) / rows.length : null;
  const a = mean(now), b = mean(before);
  const enough = a !== null && b !== null && now.length >= minPoints && before.length >= minPoints;
  return { series, avg: a, latest: series.at(-1) ?? null, perWeek: enough ? a! - b! : null, pct: enough ? (a! - b!) / b! * 100 : null };
}

/** Gentle reminders shown only while the app is open. */
export function checkIns(items: LogItem[], today: string) {
  const lastDate = (match: (i: LogItem) => boolean) => items.filter(i => i.date <= today && match(i)).map(i => i.date).sort().at(-1) ?? null;
  const weight = lastDate(i => i.kind === "metric" && i.metric === "weight");
  const waist = lastDate(i => i.kind === "metric" && i.metric !== "weight");
  const photo = lastDate(i => i.kind === "photo");
  const since = (date: string | null) => date === null ? null : dayDiff(today, date);
  const out: { key: "weight" | "measure" | "photo"; label: string }[] = [];
  const w = since(weight), m = since(waist), p = since(photo);
  if (w === null || w >= 3) out.push({ key: "weight", label: w === null ? "记一次体重" : `${w} 天没称体重` });
  if (m === null || m >= 14) out.push({ key: "measure", label: m === null ? "量一次围度" : `${m} 天没量围度` });
  if (p === null || p >= 28) out.push({ key: "photo", label: p === null ? "拍第一组对比照" : `${p} 天没拍照片` });
  return out;
}

export function measurementSummary(items: LogItem[], metric: Metric["metric"], settings: Settings) {
  const series = metricSeries(items, metric).map(p => ({ date: p.date, value: p.value }));
  const latest = series.at(-1) ?? null;
  const start = settings.phaseStart;
  const base = start ? series.filter(p => p.date <= start).at(-1) ?? series.find(p => p.date >= start) ?? null : series[0] ?? null;
  return { series, latest, change: latest && base && base.date !== latest.date ? latest.value - base.value : null };
}

export const fmt = (value: number | null | undefined, digits = 1) => value === null || value === undefined ? "—" : value.toLocaleString("zh-CN", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
export const signed = (value: number, digits = 1) => `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value).toFixed(digits)}`;
export const dayLabel = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
export const weekday = (date: string) => ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(`${date}T12:00:00Z`).getUTCDay()];
export function phaseWeek(data: AppData) { return data.settings.phaseStart ? Math.floor(dayDiff(data.today, data.settings.phaseStart) / 7) + 1 : null; }
export function weightOn(items: LogItem[], date: string) { return dailyWeight(items, date); }
