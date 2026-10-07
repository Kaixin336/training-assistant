import { logItemSchema, type LogItem } from "./domain";
import {
  HEALTH_FIELD_LABELS, HEALTH_TIMEZONE, MAX_HEALTH_IMPORT_ITEMS, MAX_HEALTH_SAMPLES,
  type HealthDayField, type HealthImportSource,
} from "./health-types";

type Row = Record<string, unknown>;
type Point = { field: HealthDayField; date: string; value: number; time: number; bucket: string; source: string | null };
type SleepSegment = { date: string; start: number; end: number; asleep: boolean; source: string | null };
type MetricMapping = { field: HealthDayField; unit: "count" | "hours" | "kg" | "kcal" | "bpm" | "ms" | "minutes" | "cm"; cumulative?: boolean };

const mappings: Record<string, MetricMapping> = {
  step_count: { field: "steps", unit: "count", cumulative: true },
  sleep_analysis: { field: "sleepH", unit: "hours" },
  "weight_&_body_mass": { field: "weightKg", unit: "kg" },
  weight_body_mass: { field: "weightKg", unit: "kg" },
  body_mass: { field: "weightKg", unit: "kg" },
  body_weight: { field: "weightKg", unit: "kg" },
  waist_circumference: { field: "waistCm", unit: "cm" },
  active_energy: { field: "activeEnergyKcal", unit: "kcal", cumulative: true },
  active_energy_burned: { field: "activeEnergyKcal", unit: "kcal", cumulative: true },
  resting_heart_rate: { field: "restingHeartRate", unit: "bpm" },
  heart_rate_variability: { field: "hrvMs", unit: "ms" },
  heart_rate_variability_sdnn: { field: "hrvMs", unit: "ms" },
  apple_exercise_time: { field: "exerciseMin", unit: "minutes", cumulative: true },
  exercise_time: { field: "exerciseMin", unit: "minutes", cumulative: true },
};

const fieldLimits: Record<HealthDayField, { min: number; max: number; positive?: boolean; integer?: boolean }> = {
  steps: { min: 0, max: 200000, integer: true },
  sleepH: { min: 0, max: 24 },
  weightKg: { min: 0, max: 600, positive: true },
  activeEnergyKcal: { min: 0, max: 20000 },
  restingHeartRate: { min: 0, max: 300, positive: true },
  hrvMs: { min: 0, max: 1000 },
  exerciseMin: { min: 0, max: 1440 },
  waistCm: { min: 0, max: 300, positive: true },
  wristTempC: { min: 25, max: 45, positive: true },
};

export class HealthImportError extends Error {
  constructor(message: string) { super(message); this.name = "HealthImportError"; }
}

function fail(message: string): never { throw new HealthImportError(message); }
function object(input: unknown, label: string): Row {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(`${label}必须是 JSON 对象。`);
  return input as Row;
}
function list(input: unknown, label: string, max = MAX_HEALTH_SAMPLES): unknown[] {
  if (!Array.isArray(input)) fail(`${label}必须是数组。`);
  if (input.length > max) fail(`${label}数量过多，请按较短日期范围分批导入。`);
  return input;
}
function string(input: unknown, label: string, max = 160): string {
  if (typeof input !== "string" || !input.trim() || input.length > max) fail(`${label}需要 1–${max} 个字符。`);
  return input.trim();
}
function number(input: unknown, label: string, min: number, max: number, positive = false): number {
  if (typeof input !== "number" || !Number.isFinite(input) || input < min || input > max || (positive && input === 0)) {
    fail(`${label}必须是${positive ? "大于 0 且" : `不小于 ${min} 且`}不大于 ${max} 的数字；不要把缺失值写成 0。`);
  }
  return input;
}
function validDay(input: unknown, label: string, today: string): string {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input)) fail(`${label}须使用 YYYY-MM-DD。`);
  const parsed = new Date(`${input}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input || input < "1900-01-01") fail(`${label}不是有效日期。`);
  if (input > today) fail(`${label}在未来；请检查日期或时区。`);
  return input;
}
const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: HEALTH_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
function localDay(time: number): string {
  const parts = dayFormatter.formatToParts(new Date(time));
  return `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}-${parts.find(p => p.type === "day")!.value}`;
}
function timestamp(input: unknown, label: string, today: string, dateOnly = true): { date: string; time: number; key: string } {
  if (typeof input !== "string") fail(`${label}缺少日期。`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    if (!dateOnly) fail(`${label}须包含时间和时区。`);
    const date = validDay(input, label, today);
    return { date, time: Date.parse(`${date}T12:00:00Z`), key: date };
  }
  // HAE: yyyy-MM-dd HH:mm:ss Z; ISO 8601 with an explicit offset is also accepted.
  const match = input.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?\s*(Z|[+-]\d{2}:?\d{2})$/);
  if (!match) fail(`${label}须包含明确时区，例如 2026-10-07 08:00:00 +1300。`);
  validDay(match[1], label, "9999-12-31");
  if (+match[2] > 23 || +match[3] > 59 || +match[4] > 59) fail(`${label}的时间无效。`);
  const offset = match[6] === "Z" ? "Z" : match[6].replace(/([+-]\d{2}):?(\d{2})/, "$1:$2");
  if (offset !== "Z" && (+offset.slice(1, 3) > 14 || +offset.slice(4) > 59 || (+offset.slice(1, 3) === 14 && +offset.slice(4) !== 0))) fail(`${label}的时区无效。`);
  const time = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}${match[5] ?? ""}${offset}`);
  if (!Number.isFinite(time)) fail(`${label}不是有效时间。`);
  const date = validDay(localDay(time), label, today);
  return { date, time, key: new Date(time).toISOString() };
}
function fieldValue(field: HealthDayField, input: unknown): number {
  const limit = fieldLimits[field];
  const value = number(input, HEALTH_FIELD_LABELS[field], limit.min, limit.max, limit.positive);
  if (limit.integer && !Number.isInteger(value)) fail(`${HEALTH_FIELD_LABELS[field]}必须是整数。`);
  return value;
}
function unitFactor(unitInput: unknown, kind: MetricMapping["unit"] | "metres", label: string): number {
  const unit = string(unitInput, `${label}单位`, 40).toLowerCase().replace(/\s+/g, "");
  const accepted: Record<string, Record<string, number>> = {
    count: { count: 1, counts: 1, steps: 1 },
    hours: { hr: 1, hrs: 1, h: 1, hour: 1, hours: 1, min: 1 / 60, minutes: 1 / 60, s: 1 / 3600, sec: 1 / 3600, seconds: 1 / 3600 },
    kg: { kg: 1, kilograms: 1, g: .001, lb: .45359237, lbs: .45359237 },
    kcal: { kcal: 1, kilocalories: 1, kj: 1 / 4.184 },
    bpm: { bpm: 1, "count/min": 1, "counts/min": 1, "beats/min": 1 },
    ms: { ms: 1, milliseconds: 1, s: 1000, sec: 1000, seconds: 1000 },
    minutes: { min: 1, mins: 1, minutes: 1, hr: 60, h: 60, hours: 60, s: 1 / 60, sec: 1 / 60, seconds: 1 / 60 },
    metres: { m: 1, metres: 1, meters: 1, km: 1000, mi: 1609.344, miles: 1609.344, yd: .9144 },
    cm: { cm: 1, centimeters: 1, centimetres: 1, m: 100, in: 2.54, inches: 2.54 },
  };
  const factor = Object.prototype.hasOwnProperty.call(accepted[kind], unit) ? accepted[kind][unit] : undefined;
  if (factor === undefined) fail(`${label}的单位“${unit}”不受支持，未猜测或导入。`);
  return factor;
}
function sourceOf(row: Row): string | null {
  return row.source === undefined || row.source === null ? null : string(row.source, "数据来源", 300);
}
function stableWorkoutKey(id: string): string {
  if (/^[a-zA-Z0-9._:-]{1,90}$/.test(id)) return id;
  // Two independent 64-bit hashes keep arbitrary Unicode/source IDs bounded.
  // This identifies records only; it is not an authentication hash.
  const mask = (1n << 64n) - 1n;
  let a = 14695981039346656037n, b = 7809847782465536322n;
  for (const byte of new TextEncoder().encode(id)) { a = ((a ^ BigInt(byte)) * 1099511628211n) & mask; b = ((b ^ BigInt(byte)) * 1099511628211n) & mask; }
  return `${a.toString(16).padStart(16, "0")}${b.toString(16).padStart(16, "0")}`;
}

/**
 * Pure validation/normalization. Callers must atomically upsert by id and must
 * never update rows whose IDs do not begin with health-. Missing fields produce
 * no record; every imported health row holds exactly one measurement.
 */
export function parseHealthImport(input: unknown, today: string): { items: LogItem[]; warnings: string[]; source: string } {
  validDay(today, "今天", "9999-12-31");
  const root = object(input, "导入内容");
  const source: HealthImportSource = root.source === "apple-shortcuts" ? "apple-shortcuts" : root.data !== undefined ? "health-auto-export" : fail("不支持这个 JSON。请选择本应用快捷指令格式或 Health Auto Export JSON v2。");
  if (source === "health-auto-export" && (root.days !== undefined || (root.source !== undefined && root.source !== "health-auto-export"))) fail("导入来源不明确，请不要混合两种格式。");
  const warnings = new Set<string>();
  const items = new Map<string, LogItem>();
  const createdAt = new Date().toISOString();
  let samples = 0;
  const countSample = () => { if (++samples > MAX_HEALTH_SAMPLES) fail("数据点过多，请缩短日期范围或改用按日汇总后再导入。"); };
  const base = (id: string, date: string, notes = "") => ({ id, date, createdAt, source, notes });
  const put = (candidate: unknown) => {
    const parsed = logItemSchema.safeParse(candidate);
    if (!parsed.success) fail(`导入记录未通过校验：${parsed.error.issues[0]?.message ?? "格式不正确"}。本次尚未保存。`);
    const previous = items.get(parsed.data.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(parsed.data)) fail("同一次导入包含相同标识但不同数值的记录，请分开导出或检查来源。");
    if (previous) warnings.add("已忽略同一文件中完全重复的记录。");
    items.set(parsed.data.id, parsed.data);
    if (items.size > MAX_HEALTH_IMPORT_ITEMS) fail("本次记录过多，请按较短日期范围分批导入。");
  };
  const emitDay = (field: HealthDayField, date: string, raw: number, notes = "") => {
    const value = fieldValue(field, raw);
    const common = base(`health-${source}-${field}-${date}`, date, notes);
    if (field === "weightKg") put({ ...common, kind: "metric", metric: "weight", value, unit: "kg" });
    else if (field === "waistCm") put({ ...common, kind: "metric", metric: "waist", value, unit: "cm" });
    else put({ ...common, kind: "health", sleepH: null, steps: null, creatineTaken: null, creatineG: null, [field]: value });
  };
  const emitWorkout = (row: { id: string; date: string; name: string; durationMin: number; distanceM?: number; energyKcal?: number; avgHr?: number; maxHr?: number; effort?: number; startedAt?: string; endedAt?: string }, notes = "") => {
    put({ ...base(`health-${source}-workout-${stableWorkoutKey(row.id)}`, row.date, notes), kind: "workout", session: "Apple Health", exerciseId: null, exerciseName: row.name,
      unit: "", sets: [], completed: row.durationMin > 0, durationMin: row.durationMin, pain: false, painScore: null, painWeeks: null, painResolved: false,
      isKeyLift: false, repMin: null, repMax: null, expectedSets: null, increment: "", ...(row.distanceM === undefined ? {} : { distanceM: row.distanceM }), ...(row.energyKcal === undefined ? {} : { energyKcal: row.energyKcal }),
      ...(row.avgHr === undefined ? {} : { avgHr: row.avgHr }), ...(row.maxHr === undefined ? {} : { maxHr: row.maxHr }), ...(row.effort === undefined ? {} : { effort: row.effort }),
      ...(row.startedAt && row.endedAt ? { startedAt: row.startedAt, endedAt: row.endedAt } : {}) });
  };

  if (source === "apple-shortcuts") {
    if (Object.keys(root).some(key => !["source", "days", "workouts"].includes(key))) fail("快捷指令 JSON 含未知字段，请使用文档中的 source、days、workouts 格式。");
    if (root.days === undefined && root.workouts === undefined) fail("快捷指令 JSON 缺少 days 或 workouts。");
    for (const raw of list(root.days ?? [], "days", MAX_HEALTH_IMPORT_ITEMS)) {
      countSample(); const row = object(raw, "每日记录"); const date = validDay(row.date, "每日记录日期", today);
      if (Object.keys(row).some(key => key !== "date" && !Object.prototype.hasOwnProperty.call(fieldLimits, key))) fail("每日记录含未知指标，请检查字段名与单位。");
      for (const field of Object.keys(fieldLimits) as HealthDayField[]) {
        if (row[field] === undefined) continue;
        if (row[field] === null) { warnings.add("空值代表尚无数据，已跳过；没有写成 0。"); continue; }
        emitDay(field, date, fieldValue(field, row[field]));
      }
    }
    for (const raw of list(root.workouts ?? [], "workouts", MAX_HEALTH_IMPORT_ITEMS)) {
      countSample(); const row = object(raw, "运动记录");
      if (Object.keys(row).some(key => !["id", "date", "name", "durationMin", "distanceM", "energyKcal", "avgHr", "maxHr", "effort", "startedAt", "endedAt"].includes(key))) fail("运动记录含未知字段，请使用文档中的运动摘要格式。");
      emitWorkout({ id: string(row.id, "运动来源 ID", 300), date: validDay(row.date, "运动日期", today), name: string(row.name, "运动名称"), durationMin: number(row.durationMin, "运动分钟数", 0, 1440),
        ...(row.distanceM == null ? {} : { distanceM: number(row.distanceM, "运动距离（米）", 0, 1000000) }), ...(row.energyKcal == null ? {} : { energyKcal: number(row.energyKcal, "运动活动能量（kcal）", 0, 20000) }),
        ...(row.avgHr == null ? {} : { avgHr: number(row.avgHr, "平均心率", 20, 250) }), ...(row.maxHr == null ? {} : { maxHr: number(row.maxHr, "最高心率", 20, 250) }), ...(row.effort == null ? {} : { effort: number(row.effort, "运动强度", 1, 10) }),
        ...(typeof row.startedAt === "string" && typeof row.endedAt === "string" && Number.isFinite(Date.parse(row.startedAt)) && Number.isFinite(Date.parse(row.endedAt)) ? { startedAt: new Date(row.startedAt).toISOString(), endedAt: new Date(row.endedAt).toISOString() } : {}) });
    }
  } else {
    const data = object(root.data, "Health Auto Export data");
    const points = new Map<string, Point[]>();
    const sleepSegments: SleepSegment[] = [];
    const cumulativeFields = new Set<HealthDayField>(["steps", "activeEnergyKcal", "exerciseMin"]);
    const addPoint = (point: Point) => { const key = `${point.field}|${point.date}`; const group = points.get(key); if (group) group.push(point); else points.set(key, [point]); };
    for (const rawMetric of list(data.metrics ?? [], "metrics", 200)) {
      const metric = object(rawMetric, "健康指标");
      const name = string(metric.name, "健康指标名称", 100);
      const mapping = Object.prototype.hasOwnProperty.call(mappings, name) ? mappings[name] : undefined;
      if (!mapping) { warnings.add(name === "heart_rate" ? "一般心率不是静息心率，本次未将 heart_rate 填入静息心率。" : `暂不支持指标 ${name}，已跳过。`); continue; }
      const factor = unitFactor(metric.units, mapping.unit, HEALTH_FIELD_LABELS[mapping.field]);
      for (const rawPoint of list(metric.data, `${name}.data`)) {
        countSample(); const row = object(rawPoint, `${name} 数据点`); const pointSource = sourceOf(row);
        if (mapping.field === "sleepH" && row.startDate !== undefined) {
          const start = timestamp(row.startDate, "睡眠片段开始", today, false), end = timestamp(row.endDate, "睡眠片段结束", today, false);
          const duration = (end.time - start.time) / 3600000;
          number(duration, "睡眠片段时长", 0, 24);
          if (row.qty != null && Math.abs(number(row.qty, "睡眠片段数值", 0, 86400) * factor - duration) > 1 / 60) fail("睡眠片段数值与开始、结束时间不一致，未导入。");
          const state = string(row.value, "睡眠阶段", 40).toLowerCase().replace(/[ _-]/g, "");
          if (!["core", "deep", "rem", "asleep", "unspecified", "awake", "inbed"].includes(state)) fail("无法识别睡眠阶段，未猜测其是否为睡眠。");
          if (state === "unspecified") { warnings.add("Unspecified 睡眠片段未明确是否入睡，已跳过；没有把未知阶段算成睡眠。"); continue; }
          let date = end.date;
          if (row.sleepEnd !== undefined) {
            const nightEnd = timestamp(row.sleepEnd, "整晚睡眠结束", today, false);
            if (nightEnd.time < end.time) fail("整晚睡眠结束时间早于片段结束时间。");
            date = nightEnd.date;
          } else warnings.add("部分睡眠片段没有整晚结束日期，按片段结束的奥克兰日期归档；建议导出按日睡眠汇总。");
          sleepSegments.push({ date, start: start.time, end: end.time, asleep: !["awake", "inbed"].includes(state), source: pointSource });
          continue;
        }
        const at = timestamp(row.date, `${name} 日期`, today);
        let value: number;
        if (mapping.field === "sleepH") {
          // A sleep total already contains its phases. Never add total + phases + in-bed.
          if (row.totalSleep != null) value = number(row.totalSleep, "总睡眠", 0, 86400) * factor;
          else if (row.asleep != null) value = number(row.asleep, "已入睡时长", 0, 86400) * factor;
          else if (["core", "deep", "rem"].some(key => row[key] != null)) value = ["core", "deep", "rem"].reduce((sum, key) => sum + (row[key] == null ? 0 : number(row[key], "睡眠阶段时长", 0, 86400) * factor), 0);
          else { warnings.add("睡眠记录没有可用的睡眠总时长或阶段，未把卧床时间当成睡眠。"); continue; }
          // Reject malformed subordinate values too, even when a valid total takes precedence.
          for (const key of ["totalSleep", "asleep", "core", "deep", "rem", "inBed"]) if (row[key] != null) number(number(row[key], "睡眠时长", 0, 86400) * factor, "睡眠时长（小时）", 0, 24);
        } else value = number(row.qty, HEALTH_FIELD_LABELS[mapping.field], 0, 1000000000) * factor;
        addPoint({ field: mapping.field, date: at.date, value: fieldValue(mapping.field, value), time: at.time, bucket: at.key, source: pointSource });
      }
    }
    const segmentDays = new Map<string, SleepSegment[]>();
    for (const segment of sleepSegments) segmentDays.set(segment.date, [...(segmentDays.get(segment.date) ?? []), segment]);
    for (const [date, segments] of segmentDays) {
      if (points.has(`sleepH|${date}`)) { warnings.add("同日同时含睡眠汇总与片段，只采用汇总，未重复累计。"); continue; }
      const sources = new Set(segments.map(segment => segment.source ?? "(未标注)"));
      if (sources.size > 1) { warnings.add(`${date} 睡眠含多个来源，已跳过该日睡眠；请先在导出端设置首选来源。`); continue; }
      const intervals = segments.filter(s => s.asleep).sort((a, b) => a.start - b.start || a.end - b.end);
      let total = 0, start: number | null = null, end = 0;
      for (const interval of intervals) {
        if (start === null) { start = interval.start; end = interval.end; }
        else if (interval.start <= end) end = Math.max(end, interval.end);
        else { total += end - start; start = interval.start; end = interval.end; }
      }
      if (start !== null) total += end - start;
      if (!intervals.length) { warnings.add(`${date} 仅有清醒或卧床片段，未生成睡眠时长。`); continue; }
      emitDay("sleepH", date, total / 3600000, "来自睡眠片段的时间并集；已排除清醒和卧床，重叠片段只计一次。");
    }
    for (const [key, group] of points) {
      const { field, date } = group[0];
      const sources = new Set(group.map(point => point.source ?? "(未标注)"));
      if (sources.size > 1) { warnings.add(`${date} ${HEALTH_FIELD_LABELS[field]}含多个来源，已跳过；请在导出端设置首选来源，避免手机与手表重复计数。`); continue; }
      const buckets = new Map<string, Point>();
      for (const point of group) {
        const previous = buckets.get(point.bucket);
        if (previous && previous.value !== point.value) fail(`${date} ${HEALTH_FIELD_LABELS[field]}在同一时间有冲突数值，请检查导出范围或来源。`);
        if (previous) warnings.add("已忽略同一文件中完全重复的健康数据点。");
        buckets.set(point.bucket, point);
      }
      const rows = [...buckets.values()].sort((a, b) => a.time - b.time);
      let value: number;
      if (cumulativeFields.has(field)) {
        if (rows.length > 1 && rows.some(point => /^\d{4}-\d{2}-\d{2}$/.test(point.bucket))) {
          warnings.add(`${date} ${HEALTH_FIELD_LABELS[field]}混合了按日汇总和带时间的数据点，已跳过；请每次使用一种汇总粒度。`); continue;
        }
        value = rows.reduce((sum, point) => sum + point.value, 0);
      }
      else {
        if (field === "sleepH" && rows.length > 1) { warnings.add(`${date} 包含多份睡眠汇总，无法确认是否重叠，已跳过；请导出每天一份汇总。`); continue; }
        value = rows.at(-1)!.value;
        if (rows.length > 1) warnings.add(`${date} ${HEALTH_FIELD_LABELS[field]}有多次读数，采用当天最新读数。`);
      }
      emitDay(field, date, value, `Health Auto Export ${cumulativeFields.has(field) ? "去除完全重复数据点后的日合计" : "每日读数"}${group[0].source ? `；来源：${group[0].source}` : "；导出未标注设备来源"}。`);
      void key;
    }
    for (const raw of list(data.workouts ?? [], "workouts", MAX_HEALTH_IMPORT_ITEMS)) {
      countSample(); const row = object(raw, "Health Auto Export 运动");
      const id = string(row.id, "Workout v2 id", 300), name = string(row.name, "运动名称");
      const start = timestamp(row.start, "运动开始", today, false), end = timestamp(row.end, "运动结束", today, false);
      if (end.time < start.time) fail("运动结束时间早于开始时间。");
      const durationSec = number(row.duration, "运动时长（秒）", 0, 86400);
      if (durationSec > (end.time - start.time) / 1000 + 60) fail("运动时长超过其开始、结束时间范围。");
      let distanceM: number | undefined, energyKcal: number | undefined;
      if (row.distance != null || row.totalDistance != null) {
        const distance = object(row.distance ?? row.totalDistance, "运动距离");
        distanceM = number(number(distance.qty, "运动距离", 0, 1000000000) * unitFactor(distance.units, "metres", "运动距离"), "运动距离（米）", 0, 1000000);
      }
      if (row.activeEnergyBurned != null || row.activeEnergy != null) {
        const energy = object(row.activeEnergyBurned ?? row.activeEnergy, "运动活动能量");
        energyKcal = number(number(energy.qty, "运动活动能量", 0, 1000000000) * unitFactor(energy.units, "kcal", "运动活动能量"), "运动活动能量（kcal）", 0, 20000);
      } else if (row.totalEnergy != null) warnings.add("部分运动仅有包含静息消耗的总能量，未将它填入活动消耗。");
      if (row.route != null || row.heartRateData != null || row.metrics != null) warnings.add("本次只导入运动摘要，不保存 GPS 路线和逐秒运动样本。");
      emitWorkout({ id, date: start.date, name, durationMin: durationSec / 60, ...(distanceM === undefined ? {} : { distanceM }), ...(energyKcal === undefined ? {} : { energyKcal }) }, "Apple Health 运动摘要；不包含力量动作、负重或组数。运动消耗不重复加到当天活动能量。");
    }
    if (Object.keys(data).some(key => !["metrics", "workouts"].includes(key))) warnings.add("本次仅导入健康指标与运动摘要；其他类别已跳过。");
  }
  if (items.size === 0) warnings.add("没有可导入的有效记录。缺失或未授权的数据不会变成 0。");
  return { items: [...items.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)), warnings: [...warnings], source };
}
