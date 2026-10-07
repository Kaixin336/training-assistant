import test from "node:test";
import assert from "node:assert/strict";
import { HealthImportError, parseHealthImport } from "../lib/health-import";
import { dailyTotals, type LogItem } from "../lib/domain";

const TODAY = "2026-10-07";
const DATE = "2026-10-06";
const at = (hour = "08:00:00") => `${DATE} ${hour} +1300`;
const shortcuts = (days: unknown[], workouts: unknown[] = []) => ({ source: "apple-shortcuts", days, workouts });
const hae = (metrics: unknown[] = [], workouts: unknown[] = []) => ({ data: { metrics, workouts } });
const metric = (name: string, units: string, data: unknown[]) => ({ name, units, data });
const qty = (value: number, date = at(), source: string | undefined = "Watch") => ({ date, qty: value, ...(source === undefined ? {} : { source }) });
function value(items: LogItem[], field: string): number | null | undefined {
  if (field === "weightKg") return items.find(item => item.kind === "metric" && item.metric === "weight")?.value;
  const row = items.find(item => item.kind === "health" && (item as unknown as Record<string, unknown>)[field] != null);
  return (row as unknown as Record<string, number> | undefined)?.[field];
}
function rejects(payload: unknown, message: RegExp) {
  assert.throws(() => parseHealthImport(payload, TODAY), (error: unknown) => error instanceof HealthImportError && message.test(error.message));
}
function workout(overrides: Record<string, unknown> = {}) {
  return { id: "apple-workout-123", name: "Walking", start: at("08:00:00"), end: at("09:00:00"), duration: 3600, ...overrides };
}
function segment(value: string, start: string, end: string, overrides: Record<string, unknown> = {}) {
  return { value, startDate: `${DATE} ${start} +1300`, endDate: `${DATE} ${end} +1300`, source: "Watch", ...overrides };
}

test("Shortcuts keeps separate deterministic IDs for each daily field and stable updates", () => {
  const first = parseHealthImport(shortcuts([{ date: DATE, steps: 4000, sleepH: 7, weightKg: 72, activeEnergyKcal: 450, restingHeartRate: 58, hrvMs: 42, exerciseMin: 40 }]), TODAY);
  assert.equal(first.items.length, 7);
  assert.equal(new Set(first.items.map(item => item.id)).size, 7);
  assert.ok(first.items.every(item => item.id.startsWith("health-apple-shortcuts-")));
  const again = parseHealthImport(shortcuts([{ date: DATE, steps: 4800 }]), TODAY);
  assert.equal(again.items[0].id, first.items.find(item => item.id.includes("-steps-"))!.id);
  assert.equal(value(again.items, "steps"), 4800);
  assert.equal(value(first.items, "weightKg"), 72);
});

test("Missing and null fields stay absent while a measured zero stays zero", () => {
  const result = parseHealthImport(shortcuts([{ date: DATE, steps: 0, sleepH: null }]), TODAY);
  assert.equal(result.items.length, 1);
  assert.equal(value(result.items, "steps"), 0);
  assert.equal(value(result.items, "sleepH"), undefined);
  assert.match(result.warnings.join(" "), /空值/);
  assert.equal(result.items[0].kind, "health");
  if (result.items[0].kind === "health") assert.equal(result.items[0].creatineTaken, null);
});

test("Exact duplicates collapse and same-ID conflicts reject the whole import", () => {
  const row = { date: DATE, steps: 1000 };
  const result = parseHealthImport(shortcuts([row, row]), TODAY);
  assert.equal(result.items.length, 1);
  assert.match(result.warnings.join(" "), /完全重复/);
  rejects(shortcuts([row, { ...row, steps: 2000 }]), /相同标识但不同数值/);
});

test("Unknown fields, numeric strings, fractional steps and impossible dates are rejected", () => {
  rejects(shortcuts([{ date: DATE, stepz: 12 }]), /未知指标/);
  rejects(shortcuts([{ date: DATE, steps: "1200" }]), /数字/);
  rejects(shortcuts([{ date: DATE, steps: 12.5 }]), /整数/);
  rejects(shortcuts([{ date: "2026-02-30", steps: 12 }]), /有效日期/);
  rejects(shortcuts([{ date: "2026-10-08", steps: 12 }]), /未来/);
  rejects(shortcuts([{ date: DATE, weightKg: 0 }]), /大于 0/);
  rejects(shortcuts([{ date: DATE, sleepH: 25 }]), /不大于 24/);
  rejects(shortcuts([{ date: DATE, hrvMs: Infinity }]), /数字/);
});

test("Unsupported roots and mixed import formats fail without guessing", () => {
  rejects([], /JSON 对象/);
  rejects({ records: [] }, /不支持这个 JSON/);
  rejects({ source: "apple-shortcuts", data: {}, days: [] }, /未知字段/);
  rejects({ source: "other", data: { metrics: [] } }, /来源不明确/);
});

test("HAE converts supported units and preserves the meaning of each field", () => {
  const result = parseHealthImport(hae([
    metric("weight_&_body_mass", "lb", [qty(160)]),
    metric("active_energy", "kJ", [qty(418.4)]),
    metric("resting_heart_rate", "count/min", [qty(58)]),
    metric("heart_rate_variability", "s", [qty(.04)]),
    metric("apple_exercise_time", "h", [qty(.5)]),
  ]), TODAY);
  assert.equal(result.items.length, 5);
  assert.ok(Math.abs(value(result.items, "weightKg")! - 72.5747792) < 1e-7);
  assert.ok(Math.abs(value(result.items, "activeEnergyKcal")! - 100) < 1e-7);
  assert.equal(value(result.items, "restingHeartRate"), 58);
  assert.equal(value(result.items, "hrvMs"), 40);
  assert.equal(value(result.items, "exerciseMin"), 30);
});

test("Unsupported units reject rather than treating pounds or joules as canonical units", () => {
  rejects(hae([metric("body_mass", "stone", [qty(10)])]), /单位.*不受支持/);
  rejects(hae([metric("active_energy", "J", [qty(2000)])]), /单位.*不受支持/);
  rejects(hae([metric("step_count", "__proto__", [qty(2000)])]), /单位.*不受支持/);
});

test("HAE requires a timezone for timed samples and archives in Auckland", () => {
  const result = parseHealthImport(hae([metric("step_count", "count", [qty(100, "2026-10-06T12:30:00Z")])]), TODAY);
  assert.equal(result.items[0].date, "2026-10-07");
  rejects(hae([metric("step_count", "count", [qty(100, "2026-10-06 08:00:00")])]), /明确时区/);
  rejects(hae([metric("step_count", "count", [qty(100, "2026-10-07T23:00:00Z")])]), /未来/);
  rejects(hae([metric("step_count", "count", [qty(100, "2026-10-06T25:00:00+13:00")])]), /时间无效/);
});

test("HAE cumulative metrics sum unique buckets, never exact duplicate timestamps", () => {
  const result = parseHealthImport(hae([metric("step_count", "count", [qty(100), qty(200, at("09:00:00")), qty(100)])]), TODAY);
  assert.equal(value(result.items, "steps"), 300);
  assert.match(result.warnings.join(" "), /完全重复/);
  rejects(hae([metric("step_count", "count", [qty(100), qty(200)])]), /同一时间有冲突/);
});

test("HAE skips a daily aggregate mixed with timestamped samples", () => {
  const result = parseHealthImport(hae([metric("step_count", "count", [qty(10000, DATE), qty(300, at())])]), TODAY);
  assert.equal(result.items.length, 0);
  assert.match(result.warnings.join(" "), /混合了按日汇总/);
});

test("HAE skips conflicting sources, including a known source mixed with unlabelled data", () => {
  for (const other of ["iPhone", undefined]) {
    const second = other === undefined ? { date: at("09:00:00"), qty: 300 } : qty(300, at("09:00:00"), other);
    const result = parseHealthImport(hae([metric("step_count", "count", [qty(100), second])]), TODAY);
    assert.equal(result.items.length, 0);
    assert.match(result.warnings.join(" "), /多个来源/);
  }
});

test("HAE uses the latest weight reading instead of summing or averaging it", () => {
  const result = parseHealthImport(hae([metric("body_mass", "kg", [qty(73), qty(72.5, at("09:00:00"))])]), TODAY);
  assert.equal(value(result.items, "weightKg"), 72.5);
  assert.match(result.warnings.join(" "), /最新读数/);
});

test("General heart rate and unsupported Health categories do not become another metric", () => {
  const result = parseHealthImport({ data: { metrics: [metric("heart_rate", "bpm", [qty(170)]), metric("__proto__", "count", [])], bloodGlucose: [] } }, TODAY);
  assert.equal(result.items.length, 0);
  assert.match(result.warnings.join(" "), /不是静息心率/);
  assert.match(result.warnings.join(" "), /其他类别已跳过/);
});

test("Daily sleep total takes precedence over stages and in-bed time", () => {
  const result = parseHealthImport(hae([metric("sleep_analysis", "hr", [{ date: DATE, totalSleep: 7, asleep: 7, core: 4, deep: 1, rem: 2, inBed: 9, source: "Watch" }])]), TODAY);
  assert.equal(value(result.items, "sleepH"), 7);
});

test("Sleep stages convert minutes and do not include in-bed time", () => {
  const result = parseHealthImport(hae([metric("sleep_analysis", "min", [{ date: DATE, core: 240, deep: 60, rem: 120, inBed: 540 }])]), TODAY);
  assert.equal(value(result.items, "sleepH"), 7);
  const onlyInBed = parseHealthImport(hae([metric("sleep_analysis", "hr", [{ date: DATE, inBed: 8 }])]), TODAY);
  assert.equal(onlyInBed.items.length, 0);
});

test("Malformed sleep stages are rejected even if totalSleep looks valid", () => {
  rejects(hae([metric("sleep_analysis", "hr", [{ date: DATE, totalSleep: 7, deep: -1 }])]), /数字/);
  rejects(hae([metric("sleep_analysis", "hr", [{ date: DATE, totalSleep: 7, deep: 25 }])]), /不大于 24/);
});

test("Multiple daily sleep summaries are skipped instead of double counted", () => {
  const result = parseHealthImport(hae([metric("sleep_analysis", "hr", [{ date: at(), totalSleep: 7 }, { date: at("09:00:00"), totalSleep: 7.5 }])]), TODAY);
  assert.equal(result.items.length, 0);
  assert.match(result.warnings.join(" "), /多份睡眠汇总/);
});

test("Overlapping sleep segments merge as a union and exclude awake and in-bed", () => {
  const result = parseHealthImport(hae([metric("sleep_analysis", "hr", [
    segment("Core", "00:00:00", "02:00:00"), segment("Deep", "01:00:00", "03:00:00"),
    segment("REM", "04:00:00", "05:00:00"), segment("Awake", "03:00:00", "04:00:00"), segment("InBed", "00:00:00", "06:00:00"),
  ])]), TODAY);
  assert.equal(value(result.items, "sleepH"), 4);
  assert.match(result.warnings.join(" "), /没有整晚结束日期/);
});

test("Only awake, in-bed or unspecified segments do not create zero hours of sleep", () => {
  for (const state of ["Awake", "InBed", "Unspecified"]) {
    const result = parseHealthImport(hae([metric("sleep_analysis", "hr", [segment(state, "00:00:00", "06:00:00")])]), TODAY);
    assert.equal(result.items.length, 0);
  }
});

test("Sleep night-end attribution and summary precedence avoid cross-midnight double counting", () => {
  const result = parseHealthImport(hae([metric("sleep_analysis", "hr", [
    segment("Core", "22:00:00", "23:00:00", { sleepEnd: "2026-10-07 07:00:00 +1300" }),
    { date: "2026-10-07", totalSleep: 7 },
  ])]), TODAY);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].date, "2026-10-07");
  assert.equal(value(result.items, "sleepH"), 7);
  assert.match(result.warnings.join(" "), /只采用汇总/);
});

test("Sleep segments reject mismatched duration, backwards dates and multiple sources", () => {
  rejects(hae([metric("sleep_analysis", "hr", [segment("Core", "00:00:00", "01:00:00", { qty: 3 })])]), /不一致/);
  rejects(hae([metric("sleep_analysis", "hr", [segment("Core", "02:00:00", "01:00:00")])]), /数字/);
  const result = parseHealthImport(hae([metric("sleep_analysis", "hr", [segment("Core", "00:00:00", "02:00:00"), segment("Core", "02:00:00", "04:00:00", { source: "Other" })])]), TODAY);
  assert.equal(result.items.length, 0);
  assert.match(result.warnings.join(" "), /多个来源/);
});

test("Workout v2 IDs are stable and units convert without inventing strength sets", () => {
  const payload = hae([], [workout({ distance: { qty: 3, units: "km" }, activeEnergyBurned: { qty: 418.4, units: "kJ" } })]);
  const first = parseHealthImport(payload, TODAY), again = parseHealthImport(payload, TODAY);
  const row = first.items[0];
  assert.equal(row.id, again.items[0].id);
  assert.equal(row.kind, "workout");
  if (row.kind !== "workout") throw new Error("Expected workout");
  assert.equal(row.durationMin, 60);
  assert.equal(row.distanceM, 3000);
  assert.ok(Math.abs(row.energyKcal! - 100) < 1e-7);
  assert.deepEqual(row.sets, []);
  assert.equal(row.isKeyLift, false);
  assert.equal(row.exerciseId, null);
});

test("Workout total energy is not mislabelled as active energy and GPS data is excluded", () => {
  const result = parseHealthImport(hae([], [workout({ totalEnergy: { qty: 500, units: "kcal" }, route: [{ lat: 1, lon: 2 }] })]), TODAY);
  const row = result.items[0];
  assert.equal(row.kind, "workout");
  if (row.kind === "workout") assert.equal(row.energyKcal, undefined);
  assert.ok(!JSON.stringify(row).includes('"lat"'));
  assert.match(result.warnings.join(" "), /总能量/);
  assert.match(result.warnings.join(" "), /GPS/);
});

test("Workouts require stable source IDs and a valid time range", () => {
  rejects(hae([], [workout({ id: null })]), /Workout v2 id/);
  rejects(hae([], [workout({ duration: 7200 })]), /超过其开始/);
  rejects(hae([], [workout({ end: at("07:00:00") })]), /早于开始/);
  rejects(hae([], [workout({ start: DATE })]), /包含时间和时区/);
});

test("Arbitrary Unicode workout source IDs remain bounded and deterministic", () => {
  const sourceId = "设备中的稳定运动标识/".repeat(15);
  const payload = shortcuts([], [{ id: sourceId, date: DATE, name: "游泳", durationMin: 30 }]);
  const first = parseHealthImport(payload, TODAY), again = parseHealthImport(payload, TODAY);
  assert.equal(first.items[0].id, again.items[0].id);
  assert.ok(first.items[0].id.length < 160);
});

test("Imports preserve manual records and totals prefer manual values without adding sources", () => {
  const apple = parseHealthImport(shortcuts([{ date: DATE, steps: 6000, sleepH: 7, weightKg: 72 }]), TODAY).items;
  const exported = parseHealthImport(hae([metric("step_count", "count", [qty(6200, DATE)])]), TODAY).items;
  const manualHealth: LogItem = { id: "manual-health", kind: "health", date: DATE, createdAt: "2026-10-06T08:00:00Z", source: "手动", notes: "", sleepH: 8, steps: 6500, creatineTaken: null, creatineG: null };
  const manualWeight: LogItem = { id: "manual-weight", kind: "metric", metric: "weight", date: DATE, createdAt: "2026-10-06T08:00:00Z", source: "手动", notes: "", value: 71.5, unit: "kg" };
  const totals = dailyTotals([...apple, ...exported, manualHealth, manualWeight], DATE);
  assert.equal(totals.steps, 6500);
  assert.equal(totals.sleep, 8);
  assert.equal(totals.weight, 71.5);
  assert.ok([...apple, ...exported].every(item => item.id !== manualHealth.id && item.id !== manualWeight.id));
});

test("An empty export is a no-op and bounded inputs reject overlarge sample arrays", () => {
  const empty = parseHealthImport(hae(), TODAY);
  assert.deepEqual(empty.items, []);
  assert.match(empty.warnings.join(" "), /不会变成 0/);
  rejects(hae([metric("step_count", "count", Array.from({ length: 30001 }, () => qty(1)))]), /数量过多/);
});
