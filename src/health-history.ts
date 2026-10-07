/**
 * Reads weight, waist and workout history out of the Health app's "导出所有健康数据" file (the zip,
 * or the xml inside it) entirely on the phone. The export is often hundreds of MB, so it is streamed:
 * only the one xml entry is inflated and scanned. One weight/waist reading per day (the latest) and a
 * short summary per workout are kept; nothing else is ever uploaded.
 */
export type HistoryDay = { date: string; weightKg?: number; waistCm?: number };
export type HistoryWorkout = { id: string; date: string; name: string; durationMin: number; startedAt?: string; endedAt?: string; distanceM?: number; energyKcal?: number; avgHr?: number; maxHr?: number; effort?: number };
export type HealthHistory = { days: HistoryDay[]; workouts: HistoryWorkout[] };
type Field = "weightKg" | "waistCm";

const ACTIVITY: Record<string, string> = {
  TraditionalStrengthTraining: "传统力量训练", FunctionalStrengthTraining: "功能性力量训练", HighIntensityIntervalTraining: "高强度间歇训练", CoreTraining: "核心训练",
  Running: "跑步", Walking: "步行", Hiking: "徒步", Cycling: "骑车", Swimming: "游泳", Elliptical: "椭圆机", Rowing: "划船机", StairClimbing: "爬楼梯", Stairs: "楼梯",
  StepTraining: "踏板训练", Yoga: "瑜伽", Pilates: "普拉提", Flexibility: "柔韧训练", Cooldown: "放松整理", MixedCardio: "混合有氧", CrossTraining: "交叉训练",
  JumpRope: "跳绳", Dance: "舞蹈", Boxing: "拳击", Kickboxing: "搏击", MartialArts: "武术", Tennis: "网球", Badminton: "羽毛球", TableTennis: "乒乓球",
  Basketball: "篮球", Soccer: "足球", Climbing: "攀岩", Other: "其他运动",
};
const INDOOR_CAPABLE = new Set(["Walking", "Running", "Cycling"]);
const DISTANCE: Record<string, number> = { m: 1, km: 1000, mi: 1609.344, yd: .9144, ft: .3048 };
const ENERGY: Record<string, number> = { kcal: 1, Cal: 1, cal: .001, kJ: 1 / 4.184 };
const DURATION: Record<string, number> = { min: 1, s: 1 / 60, hr: 60, h: 60 };
/** "2026-10-07 18:00:00 +1300" → epoch ms. */
const instant = (text: string) => Date.parse(text.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/, "$1T$2$3:$4"));
const attr = (tag: string, name: string) => tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1];

const TYPES: Record<string, Field> = { HKQuantityTypeIdentifierBodyMass: "weightKg", HKQuantityTypeIdentifierWaistCircumference: "waistCm" };
const UNITS: Record<Field, Record<string, number>> = {
  weightKg: { kg: 1, g: .001, lb: .45359237, st: 6.35029318 },
  waistCm: { cm: 1, mm: .1, m: 100, in: 2.54, ft: 30.48 },
};
// Weight/waist/effort records, workouts with their statistics, and the indoor flag inside a workout.
const TAGS = /<Record type="HKQuantityTypeIdentifier(BodyMass|WaistCircumference|WorkoutEffortScore|EstimatedWorkoutEffortScore)"[^>]*>|<Workout\s[^>]*>|<WorkoutStatistics\s[^>]*>|<MetadataEntry key="HKIndoorWorkout"[^>]*>|<\/Workout>/g;

const u64 = (view: DataView, at: number) => view.getUint32(at, true) + view.getUint32(at + 4, true) * 2 ** 32;
const read = async (blob: Blob, start: number, end: number) => new DataView(await blob.slice(start, end).arrayBuffer());
const broken = () => new Error("这个压缩包不完整。请在健康 App 里重新导出一次。");

/** Finds the main export xml through the zip's central directory (handles ZIP64 and streamed entries). */
async function zipEntry(file: Blob): Promise<{ start: number; size: number; method: number }> {
  const tailStart = Math.max(0, file.size - 65557);
  const tail = await read(file, tailStart, file.size);
  let end = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw broken();
  let count = tail.getUint16(end + 10, true), dirSize = tail.getUint32(end + 12, true), dirOffset = tail.getUint32(end + 16, true);
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) {
    const locator = end - 20;
    if (locator < 0 || tail.getUint32(locator, true) !== 0x07064b50) throw broken();
    const at = u64(tail, locator + 8), record = await read(file, at, at + 56);
    if (record.getUint32(0, true) !== 0x06064b50) throw broken();
    count = u64(record, 32); dirSize = u64(record, 40); dirOffset = u64(record, 48);
  }
  const dir = await read(file, dirOffset, dirOffset + dirSize);
  let best: { method: number; size: number; offset: number; unpacked: number } | null = null;
  for (let p = 0, i = 0; i < count && p + 46 <= dir.byteLength && dir.getUint32(p, true) === 0x02014b50; i++) {
    const method = dir.getUint16(p + 10, true), nameLength = dir.getUint16(p + 28, true), extraLength = dir.getUint16(p + 30, true), commentLength = dir.getUint16(p + 32, true);
    let size = dir.getUint32(p + 20, true), unpacked = dir.getUint32(p + 24, true), offset = dir.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLength));
    for (let e = p + 46 + nameLength; e + 4 <= p + 46 + nameLength + extraLength;) {
      const id = dir.getUint16(e, true), length = dir.getUint16(e + 2, true);
      if (id === 1) {
        let q = e + 4;
        if (unpacked === 0xffffffff) { unpacked = u64(dir, q); q += 8; }
        if (size === 0xffffffff) { size = u64(dir, q); q += 8; }
        if (offset === 0xffffffff) offset = u64(dir, q);
      }
      e += 4 + length;
    }
    // The localized name differs (export.xml, 导出.xml …); export_cda.xml holds clinical documents.
    if (/\.xml$/i.test(name) && !/cda/i.test(name) && (!best || unpacked > best.unpacked)) best = { method, size, offset, unpacked };
    p += 46 + nameLength + extraLength + commentLength;
  }
  if (!best) throw new Error("压缩包里没有找到健康数据。请选择健康 App 导出的那个文件。");
  if (best.method !== 0 && best.method !== 8) throw new Error("这个压缩格式暂不支持。可以先在“文件”里点开压缩包，再选择里面的 xml 文件。");
  const local = await read(file, best.offset, best.offset + 30);
  if (local.getUint32(0, true) !== 0x04034b50) throw broken();
  return { start: best.offset + 30 + local.getUint16(26, true) + local.getUint16(28, true), size: best.size, method: best.method };
}

function counted(stream: ReadableStream<Uint8Array>, total: number, onProgress?: (done: number, total: number) => void) {
  let done = 0;
  return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, out) { done += chunk.byteLength; onProgress?.(done, total); out.enqueue(chunk); } }));
}

export async function readHealthExport(file: Blob, onProgress?: (done: number, total: number) => void): Promise<HealthHistory> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  let bytes: ReadableStream<Uint8Array>;
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const entry = await zipEntry(file);
    const raw = counted(file.slice(entry.start, entry.start + entry.size).stream(), entry.size, onProgress);
    bytes = entry.method === 8 ? raw.pipeThrough(new DecompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>) : raw;
  } else bytes = counted(file.stream(), file.size, onProgress);

  const latest = new Map<string, { at: string; value: number }>();
  type Open = { type: string; start: string; end: string; workout: HistoryWorkout; indoor: boolean };
  const workouts: Open[] = [], efforts: { start: number; value: number; rated: boolean }[] = [];
  let current: Open | null = null;
  const finish = () => {
    if (current && current.workout.durationMin >= 1) {
      if (current.indoor && INDOOR_CAPABLE.has(current.type)) current.workout.name = `室内${current.workout.name}`;
      workouts.push(current);
    }
    current = null;
  };
  const scan = (text: string) => {
    for (const match of text.matchAll(TAGS)) {
      const tag = match[0];
      if (match[1]) {
        const value = Number(attr(tag, "value")), at = attr(tag, "startDate");
        if (!at || !/^\d{4}-\d{2}-\d{2}/.test(at) || !(value > 0)) continue;
        if (match[1].endsWith("EffortScore")) { efforts.push({ start: instant(at), value, rated: match[1] === "WorkoutEffortScore" }); continue; }
        const field = TYPES[`HKQuantityTypeIdentifier${match[1]}`], unit = attr(tag, "unit"), factor = unit ? UNITS[field][unit] : undefined;
        if (!factor) continue;
        const key = `${field}|${at.slice(0, 10)}`, previous = latest.get(key);
        if (!previous || at >= previous.at) latest.set(key, { at, value: value * factor });
      } else if (tag.startsWith("<Workout ") || tag.startsWith("<Workout\t") || tag.startsWith("<Workout\n")) {
        finish();
        const type = (attr(tag, "workoutActivityType") ?? "").replace("HKWorkoutActivityType", ""), start = attr(tag, "startDate"), end = attr(tag, "endDate");
        if (!start || !end || !/^\d{4}-\d{2}-\d{2}/.test(start)) continue;
        const durationMin = Number(attr(tag, "duration")) * (DURATION[attr(tag, "durationUnit") ?? "min"] ?? 1);
        const workout: HistoryWorkout = { id: `${type}|${start}`, date: start.slice(0, 10), name: ACTIVITY[type] ?? "运动", durationMin: Math.round(durationMin * 10) / 10 };
        if (Number.isFinite(instant(start)) && Number.isFinite(instant(end))) { workout.startedAt = new Date(instant(start)).toISOString(); workout.endedAt = new Date(instant(end)).toISOString(); }
        // Older exports put totals on the workout itself.
        const distance = Number(attr(tag, "totalDistance")) * (DISTANCE[attr(tag, "totalDistanceUnit") ?? ""] ?? NaN);
        const energy = Number(attr(tag, "totalEnergyBurned")) * (ENERGY[attr(tag, "totalEnergyBurnedUnit") ?? ""] ?? NaN);
        if (distance > 0) workout.distanceM = Math.round(distance);
        if (energy > 0) workout.energyKcal = Math.round(energy);
        current = { type, start, end, workout, indoor: false };
        if (tag.endsWith("/>")) finish();
      } else if (tag === "</Workout>") finish();
      else if (current && tag.startsWith("<MetadataEntry")) current.indoor = attr(tag, "value") === "1";
      else if (current) {
        const type = attr(tag, "type") ?? "", unit = attr(tag, "unit") ?? "", w = current.workout;
        if (type.endsWith("HeartRate")) {
          const average = Number(attr(tag, "average")), maximum = Number(attr(tag, "maximum"));
          if (average > 0) w.avgHr = Math.round(average);
          if (maximum > 0) w.maxHr = Math.round(maximum);
        } else if (type.endsWith("ActiveEnergyBurned")) {
          const energy = Number(attr(tag, "sum")) * (ENERGY[unit] ?? NaN);
          if (energy > 0) w.energyKcal = Math.round(energy);
        } else if (/Distance(WalkingRunning|Cycling|Swimming)$/.test(type)) {
          const distance = Number(attr(tag, "sum")) * (DISTANCE[unit] ?? NaN);
          if (distance > 0) w.distanceM = Math.round(distance);
        }
      }
    }
  };
  const reader = bytes.pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>).getReader();
  let carry = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    // A tag can straddle two chunks: hold back everything from the last "<".
    const text = carry + value, cut = text.lastIndexOf("<");
    scan(cut > 0 ? text.slice(0, cut) : "");
    carry = cut > 0 ? text.slice(cut) : text;
  }
  scan(carry);
  finish();

  // Effort (iOS 18+) is stored as its own sample over the workout's time; the user's own rating wins over the estimate.
  for (const open of workouts) {
    const start = instant(open.start), end = instant(open.end);
    const matches = efforts.filter(e => e.start >= start - 60000 && e.start <= end + 60000);
    const effort = matches.find(e => e.rated) ?? matches[0];
    if (effort) open.workout.effort = Math.min(10, Math.max(1, Math.round(effort.value)));
  }

  const days = new Map<string, HistoryDay>();
  for (const [key, { value }] of latest) {
    const [field, date] = key.split("|") as [Field, string];
    const day = days.get(date) ?? { date };
    day[field] = field === "weightKg" ? Math.round(value * 100) / 100 : Math.round(value * 10) / 10;
    days.set(date, day);
  }
  return {
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    workouts: workouts.map(w => w.workout).sort((a, b) => a.id.localeCompare(b.id)),
  };
}
