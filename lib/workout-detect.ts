/**
 * Rebuilds the day's Apple Watch workouts from raw Health samples, because Shortcuts cannot read
 * workouts. During a workout the Watch measures heart rate every few seconds; the rest of the day
 * only every few minutes. A dense stretch of heart-rate samples is therefore a workout, and its
 * time window gives the duration, average and peak heart rate, energy and step cadence.
 */
import { HealthImportError } from "./health-import";

export type Sample = { at: number; value: number };
export type Interval = { start: number; end: number };
export type DetectedWorkout = Interval & { durationMin: number; avgHr: number; maxHr: number; energyKcal?: number; cadence?: number; name: string };

const MINUTE = 60_000;
/** Consecutive readings at most this far apart belong to one dense run (workouts sample every ~5 s). */
const DENSE_GAP = 75_000;
/** A sensor dropout or a long rest between sets shorter than this does not split a workout. */
const MERGE_GAP = 4 * MINUTE;
const MIN_DURATION = 8 * MINUTE;
/** Strength sets are often logged after the workout, so look a little before and well after it. */
const LOG_BEFORE = 20 * MINUTE, LOG_AFTER = 120 * MINUTE;

export const DETECTED_NAMES = ["力量训练", "跑步", "步行", "体能训练"];
/** JSON field names in the Shortcut: values from "值", times from "开始日期" of the same Health sample. */
export const WORKOUT_SAMPLE_KEYS = {
  hr: ["hr", "heartRate", "心率"], hrTime: ["hrTime", "hrAt", "心率时间"],
  kcal: ["kcal", "energyList"], kcalTime: ["kcalTime", "kcalAt"],
  stepList: ["stepList", "stepsList"], stepTime: ["stepTime", "stepsTime", "stepAt"],
} as const;

export function detectWorkouts(hr: Sample[], extra: { energy?: Sample[]; steps?: Sample[]; strength?: Interval[] } = {}): DetectedWorkout[] {
  const samples = hr.filter(s => s.value >= 30 && s.value <= 250).sort((a, b) => a.at - b.at);
  const runs: Interval[] = [];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].at - samples[i - 1].at > DENSE_GAP) continue;
    const last = runs.at(-1);
    if (last && samples[i - 1].at - last.end <= MERGE_GAP) last.end = samples[i].at;
    else runs.push({ start: samples[i - 1].at, end: samples[i].at });
  }
  return runs.filter(run => run.end - run.start >= MIN_DURATION).map(run => {
    const inside = samples.filter(s => s.at >= run.start && s.at <= run.end);
    const durationMin = Math.round((run.end - run.start) / MINUTE);
    const sum = (list: Sample[] | undefined) => list ? list.filter(s => s.at >= run.start && s.at <= run.end).reduce((n, s) => n + s.value, 0) : undefined;
    const energy = sum(extra.energy), steps = sum(extra.steps);
    const workout: DetectedWorkout = {
      ...run, durationMin,
      avgHr: Math.round(inside.reduce((n, s) => n + s.value, 0) / inside.length),
      maxHr: Math.round(Math.max(...inside.map(s => s.value))),
      name: "体能训练",
    };
    if (energy) workout.energyKcal = Math.round(energy);
    if (steps !== undefined && extra.steps?.length) workout.cadence = Math.round(steps / Math.max(1, durationMin));
    const logged = (extra.strength ?? []).some(s => s.end >= run.start - LOG_BEFORE && s.start <= run.end + LOG_AFTER);
    workout.name = logged ? "力量训练"
      : workout.cadence === undefined ? "体能训练"
      : workout.cadence >= 130 && workout.avgHr >= 130 ? "跑步"
      : workout.cadence >= 50 ? "步行" : "力量训练";
    return workout;
  });
}

// A day of heart rate is thousands of timestamps and the free Worker plan allows ~10 ms of CPU,
// so the (slow) Intl time-zone lookup runs once per wall-clock hour, not once per sample.
const formatters = new Map<string, Intl.DateTimeFormat>(), offsets = new Map<string, number>();
function zoneOffset(ms: number, zone: string) {
  let format = formatters.get(zone);
  if (!format) { format = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); formatters.set(zone, format); }
  const parts = format.formatToParts(new Date(ms)), get = (type: string) => Number(parts.find(p => p.type === type)!.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second")) - ms;
}
function zoned(y: number, m: number, d: number, h: number, mi: number, s: number, zone: string) {
  const key = `${zone}|${y}-${m}-${d}-${h}`;
  let offset = offsets.get(key);
  if (offset === undefined) {
    const hour = Date.UTC(y, m - 1, d, h);
    offset = zoneOffset(hour, zone);
    const corrected = zoneOffset(hour - offset, zone);
    if (corrected !== offset) offset = corrected;
    offsets.set(key, offset);
  }
  return Date.UTC(y, m - 1, d, h, mi, s) - offset;
}
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * Dates as Shortcuts writes them into text: ISO 8601, "2026年10月8日 下午6:05:12", "2026/10/8 18:05",
 * "Oct 8, 2026 at 6:05 PM" or relative "今天 18:05". Times without a zone are Auckland wall time.
 */
const FAST = /^(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})日?\s*(上午|下午|凌晨|早上|中午|晚上|傍晚)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
export function parseShortcutTime(input: string, today: string, zone = "Pacific/Auckland"): number | null {
  const text = input.trim();
  if (!text) return null;
  // Fast path for the usual "2026/10/8 下午6:05:12" / "2026年10月8日 18:05" shapes.
  const fast = FAST.exec(text);
  if (fast) {
    let hour = +fast[5];
    const mark = fast[4];
    if ((mark === "下午" || mark === "晚上" || mark === "傍晚") && hour < 12) hour += 12;
    else if (mark === "中午" && hour < 11) hour += 12;
    else if ((mark === "凌晨" || mark === "上午" || mark === "早上") && hour === 12) hour = 0;
    if (hour > 23 || +fast[6] > 59) return null;
    return zoned(+fast[1], +fast[2], +fast[3], hour, +fast[6], +(fast[7] ?? 0), zone);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text) && /(Z|[+-]\d{2}:?\d{2})$/.test(text)) { const ms = Date.parse(text); return Number.isFinite(ms) ? ms : null; }
  let ymd: number[] | null = null;
  const numeric = text.match(/(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})/);
  const english = text.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/) ?? text.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/);
  if (numeric) ymd = [+numeric[1], +numeric[2], +numeric[3]];
  else if (english) {
    const [month, day] = /^\d/.test(english[1]) ? [english[2], english[1]] : [english[1], english[2]];
    const m = MONTHS[month.toLowerCase()]; if (m) ymd = [+english[3], m, +day];
  } else if (/今天|today/i.test(text)) ymd = today.split("-").map(Number);
  else if (/昨天|yesterday/i.test(text)) ymd = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10).split("-").map(Number);
  const time = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!ymd || !time) return null;
  let hour = +time[1];
  if (/下午|晚上|傍晚|PM/i.test(text) && hour < 12) hour += 12;
  else if (/中午/.test(text) && hour < 11) hour += 12;
  else if (/凌晨|上午|早上|AM/i.test(text) && hour === 12) hour = 0;
  if (hour > 23 || +time[2] > 59) return null;
  return zoned(ymd[0], ymd[1], ymd[2], hour, +time[2], +(time[3] ?? 0), zone);
}

/** One value per line (or a JSON array), lined up with one date per line. */
export function samplesFrom(values: unknown, times: unknown, label: string, today: string): Sample[] {
  const lines = (input: unknown): string[] => Array.isArray(input) ? input.map(v => typeof v === "string" ? v : String(v))
    : typeof input === "number" ? [String(input)] : typeof input === "string" ? input.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [];
  const valueLines = lines(values), timeLines = lines(times);
  if (!valueLines.length) return [];
  if (valueLines.length !== timeLines.length) throw new HealthImportError(`${label}收到 ${valueLines.length} 个数值、${timeLines.length} 个时间，对不上。请让两个字段选同一个“健康样本”，一个取“值”，一个取“开始日期”。`);
  const samples: Sample[] = [];
  for (let i = 0; i < valueLines.length; i++) {
    // Energy cards left on 千焦 send kilojoules; everything here works in kcal.
    const value = Number(valueLines[i].replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0]) / (/kj|千焦/i.test(valueLines[i]) ? 4.184 : 1);
    const at = parseShortcutTime(timeLines[i], today);
    if (at === null) throw new HealthImportError(`${label}的时间看不懂：“${timeLines[i].slice(0, 40)}”。`);
    if (Number.isFinite(value)) samples.push({ at, value });
  }
  return samples;
}
