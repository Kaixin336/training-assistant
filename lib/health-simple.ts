import { HealthImportError } from "./health-import";
import type { ShortcutHealthPayload } from "./health-types";
import { parseShortcutTime, WORKOUT_SAMPLE_KEYS } from "./workout-detect";

/**
 * The shortest possible iOS Shortcut sends today's Health samples straight into a JSON body:
 * { "steps": <sample>, "weight": <sample> }. Shortcuts may serialise a sample as a number,
 * as text such as "8,234 步" / "72.4 kg", or as a one-item list. Missing values are skipped.
 */
const fields = {
  steps: ["steps", "步数"], weightKg: ["weight", "weightKg", "体重"], activeEnergyKcal: ["activeEnergy", "activeEnergyKcal", "活动能量"],
  waistCm: ["waist", "waistCm", "腰围"], restingHeartRate: ["restingHeartRate", "静息心率"], hrvMs: ["hrv", "hrvMs"], exerciseMin: ["exerciseMinutes", "exerciseMin"], sleepH: ["sleep", "sleepH", "睡眠"],
  wristTempC: ["wristTemp", "wristTempC", "手腕温度"], basalEnergyKcal: ["basalEnergy", "basalEnergyKcal", "静息能量"],
} as const;
const simpleKeys: string[] = Object.values(fields).flat();
const KJ = 4.184;
// Raw heart-rate/energy/step samples used to rebuild the day's workouts (lib/workout-detect.ts).
const workoutKeys: string[] = Object.values(WORKOUT_SAMPLE_KEYS).flat();
// Last night's sleep as stage samples ("睡眠分析", grouped by nothing): stage, start and end of each.
const SLEEP_KEYS = { stage: ["sleepStage", "睡眠阶段"], start: ["sleepStart"], end: ["sleepEnd"] };
const sleepKeys: string[] = Object.values(SLEEP_KEYS).flat();
// These may arrive as several lines (all of last night's HRV readings, or a list): average or newest first.
const MULTI: Record<string, "average" | "first"> = { hrvMs: "average", restingHeartRate: "first", wristTempC: "first" };

export function isSimpleHealthBody(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input) && !("source" in input) && !("data" in input) && Object.keys(input).some(key => simpleKeys.includes(key) || workoutKeys.includes(key) || sleepKeys.includes(key));
}

function reading(value: unknown, label: string): { value: number; text: string } | null {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) {
    if (!value.length) return null;
    if (value.length > 1) throw new HealthImportError(`${label}收到 ${value.length} 个数值。请在“查找健康样本”里把“分组方式”设为“天”，或把“限制”设为 1。`);
    return reading(value[0], label);
  }
  if (typeof value === "number") return Number.isFinite(value) ? { value, text: String(value) } : null;
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    const key = Object.keys(row).find(k => /^(qty|quantity|value|值|数值)$/i.test(k));
    return reading(key ? row[key] : undefined, label);
  }
  if (typeof value !== "string") return null;
  const match = value.replace(/\s/g, "").match(/-?\d[\d,，]*(?:\.\d+)?/);
  if (!match) throw new HealthImportError(`${label}看不懂：“${value.slice(0, 40)}”。`);
  return { value: Number(match[0].replace(/[,，]/g, "")), text: value };
}

/** What the Shortcut actually sent, shown when nothing could be read so the setup can be fixed from the phone. */
export function describeSimpleBody(body: Record<string, unknown>): string {
  // Sample lists can be thousands of lines: report their size, not their content.
  const show = (value: unknown) => typeof value === "string" && value.includes("\n") ? `${value.split("\n").filter(Boolean).length} 行`
    : Array.isArray(value) && value.length > 1 ? `${value.length} 项` : value === undefined ? "（无）" : JSON.stringify(value).slice(0, 40);
  return Object.entries(body).filter(([key]) => simpleKeys.includes(key) || workoutKeys.includes(key))
    .map(([key, value]) => `${key}=${show(value)}`).join("，");
}

const LABELS: Record<keyof typeof fields, string> = {
  steps: "步数", weightKg: "体重", activeEnergyKcal: "活动能量", waistCm: "腰围", restingHeartRate: "静息心率", hrvMs: "HRV",
  exerciseMin: "运动分钟", sleepH: "睡眠", wristTempC: "手腕温度", basalEnergyKcal: "静息能量",
};
/**
 * Fields the Shortcut sends that hold nothing today ("静息能量" without the Watch on). Listed in the reply so a
 * newly added field can be confirmed as wired up before it has data.
 */
export function emptyFields(body: Record<string, unknown>): string[] {
  return fieldReport(body).empty;
}

/** Every field the Shortcut is wired to send, split into those with data today and those without. */
export function fieldReport(body: Record<string, unknown>): { filled: string[]; empty: string[] } {
  const blank = (value: unknown, key: string) => {
    if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return true;
    const first = Array.isArray(value) ? value[0] : typeof value === "string" ? value.split("\n")[0] : value;
    try { const r = reading(first, key); return !r || !(r.value > 0); } catch { return false; }
  };
  const filled: string[] = [], empty: string[] = [];
  for (const field of Object.keys(fields) as (keyof typeof fields)[]) {
    const key = fields[field].find(k => k in body);
    if (key === undefined) continue;
    const derived = field === "activeEnergyKcal" && typeof body.kcal === "string" && body.kcal.trim();
    (blank(body[key], key) && !derived ? empty : filled).push(LABELS[field]);
  }
  const stage = SLEEP_KEYS.stage.find(k => k in body);
  if (stage && !filled.includes("睡眠") && !empty.includes("睡眠")) (blank(body[stage], stage) ? empty : filled).push("睡眠");
  const hr = WORKOUT_SAMPLE_KEYS.hr.find(k => k in body);
  if (hr) (blank(body[hr], hr) ? empty : filled).push("心率（运动识别）");
  return { filled, empty };
}

/** Hours asleep from stage samples: the union of core/deep/REM/asleep intervals; awake and in-bed time excluded. */
export function sleepFromSamples(body: Record<string, unknown>, today: string): number | null {
  const pick = (keys: string[]) => keys.map(k => body[k]).find(v => v !== undefined && v !== null && v !== "");
  const lines = (value: unknown) => Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split("\n").map(s => s.trim()).filter(Boolean) : [];
  const stages = lines(pick(SLEEP_KEYS.stage)), starts = lines(pick(SLEEP_KEYS.start)), ends = lines(pick(SLEEP_KEYS.end));
  if (!stages.length) return null;
  if (stages.length !== starts.length || stages.length !== ends.length) throw new HealthImportError(`睡眠收到 ${stages.length} 个阶段、${starts.length} 个开始时间、${ends.length} 个结束时间，对不上。三个字段要选同一个睡眠样本，分别取“值”“开始日期”“结束日期”。`);
  const intervals: [number, number][] = [];
  for (let i = 0; i < stages.length; i++) {
    if (/清醒|awake|在床|in ?bed/i.test(stages[i]) || !/睡|sleep|core|deep|rem|核心|深度|快速/i.test(stages[i])) continue;
    const start = parseShortcutTime(starts[i], today), end = parseShortcutTime(ends[i], today);
    if (start === null || end === null) throw new HealthImportError(`睡眠的时间看不懂：“${(start === null ? starts[i] : ends[i]).slice(0, 40)}”。`);
    if (end > start) intervals.push([start, end]);
  }
  if (!intervals.length) return null;
  intervals.sort((a, b) => a[0] - b[0]);
  // The card may cover several days ("开始日期 是最近 2 天"): group stages into nights (gaps under 2 h) and keep
  // the ones that ended today — last night, including its stages before midnight, plus any nap today.
  const nights: [number, number][][] = [];
  for (const interval of intervals) {
    const night = nights.at(-1);
    if (night && interval[0] - Math.max(...night.map(i => i[1])) <= 2 * 36e5) night.push(interval); else nights.push([interval]);
  }
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" });
  const kept = nights.filter(night => day.format(new Date(Math.max(...night.map(i => i[1])))) === today).flat();
  if (!kept.length) return null;
  let total = 0, [from, to] = kept[0];
  for (const [start, end] of kept.slice(1)) { if (start <= to) to = Math.max(to, end); else { total += to - from; [from, to] = [start, end]; } }
  total += to - from;
  const hours = Math.round(total / 36e5 * 100) / 100;
  return hours > 0 && hours <= 24 ? hours : null;
}

export function simpleHealthPayload(body: Record<string, unknown>, today: string): ShortcutHealthPayload {
  const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : today;
  const day: Record<string, number | string> = { date };
  for (const [field, keys] of Object.entries(fields)) {
    const key = keys.find(k => k in body); if (!key) continue;
    let raw = body[key];
    const lines = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" && raw.includes("\n") ? raw.split("\n").map(s => s.trim()).filter(Boolean) : null;
    if (lines && lines.length > 1 && MULTI[field]) {
      const values = lines.map(line => Number(line.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0])).filter(Number.isFinite);
      raw = MULTI[field] === "average" ? String(values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)) : lines[0];
    }
    // A Shortcut number field with no sample sends 0; treat it as missing so one empty metric doesn't fail the whole sync.
    const r = reading(raw, key); if (!r || !(r.value > 0)) continue;
    let value = r.value;
    if (field === "weightKg" && /lb|磅/i.test(r.text)) value = Math.round(value * 0.45359237 * 100) / 100;
    if (field === "waistCm" && /in|英寸|吋/i.test(r.text) && !/cm|厘米/i.test(r.text)) value = Math.round(value * 2.54 * 10) / 10;
    if (field === "sleepH" && /min|分钟/i.test(r.text)) value = Math.round(value / 60 * 100) / 100;
    if (field === "steps") value = Math.round(value);
    if (field === "hrvMs" || field === "restingHeartRate") value = Math.round(value);
    if (field === "wristTempC") {
      // A card left on 华氏度 sends °F; a value that still isn't a body temperature is skipped, not fatal.
      if (/°?F\b|℉|华氏/i.test(r.text) || value > 60) value = (value - 32) * 5 / 9;
      if (value < 25 || value > 45) continue;
      value = Math.round(value * 100) / 100;
    }
    // A Health card left on 千焦 sends kilojoules.
    if ((field === "basalEnergyKcal" || field === "activeEnergyKcal") && /kj|千焦/i.test(r.text)) value = Math.round(value / KJ);
    day[field] = value;
  }
  // Without a daily active-energy field, the workout-detection energy samples (today's, ungrouped) add up to it.
  if (day.activeEnergyKcal === undefined && typeof body.kcal === "string") {
    const total = body.kcal.split("\n").reduce((n, line) => n + (Number(line.replace(/,/g, "").match(/\d+(?:\.\d+)?/)?.[0]) || 0) / (/kj|千焦/i.test(line) ? KJ : 1), 0);
    if (total > 0 && total < 20000) day.activeEnergyKcal = Math.round(total);
  }
  const sleep = sleepFromSamples(body, today);
  if (sleep !== null && day.sleepH === undefined) day.sleepH = sleep;
  return { source: "apple-shortcuts", days: Object.keys(day).length > 1 ? [day as never] : [] };
}
