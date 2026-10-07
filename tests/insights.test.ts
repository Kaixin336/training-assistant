import test from "node:test";
import assert from "node:assert/strict";
import { addDays, DEFAULT_SETTINGS, type DietPlan, type Food, type LogItem, type Settings, type Workout } from "../lib/domain";
import { calibratePlan, dayType, planMeals, withPlannedMeals } from "../lib/diet";
import { deloadAdvice, dietReview, energyBalance, musclesOf, muscleSets, personalRecords, plateaus, readiness, strengthLevel, trainingLoad } from "../lib/insights";

// A plan as the AI would store it: shared breakfast, different lunch/dinner on training and rest days.
const PLAN: DietPlan = {
  name: "测试计划", startDate: "2026-10-01", rules: [],
  targets: { training: { kcal: 2100, protein: 148 }, rest: { kcal: 1900, protein: 143 } },
  meals: [
    { slot: "早餐", day: "both", text: "早餐", kcal: 615, protein: 39 },
    { slot: "午餐", day: "training", text: "训练日午餐", kcal: 850, protein: 65 }, { slot: "晚餐", day: "training", text: "训练日晚餐", kcal: 635, protein: 44 },
    { slot: "午餐", day: "rest", text: "休息日午餐", kcal: 740, protein: 62 }, { slot: "晚餐", day: "rest", text: "休息日晚餐", kcal: 545, protein: 42 },
  ],
};
const TARGETS = PLAN.targets;
const withPlan = (startDate: string | null) => ({ ...settings, dietPlan: startDate ? { ...PLAN, startDate } : null });
const settings: Settings = { ...DEFAULT_SETTINGS, phase: "fat_loss", dietPlan: PLAN };
const base = { createdAt: "2026-10-01T08:00:00.000Z", source: "test", notes: "" };
let n = 0;
const lift = (date: string, name: string, sets: [number, number][], extra: Partial<Workout> = {}): Workout => ({
  ...base, id: `w${++n}`, date, createdAt: `${date}T08:00:${String(n % 60).padStart(2, "0")}.000Z`, kind: "workout", session: "自由训练", exerciseId: `ex-${name}`, exerciseName: name, unit: "kg",
  sets: sets.map(([weightKg, reps]) => ({ weightKg, reps, durationSec: null, distanceM: null, notch: null, isWarmup: false, feel: "OK", side: "both" })),
  completed: true, durationMin: null, pain: false, painScore: null, painWeeks: null, painResolved: false, isKeyLift: true, repMin: null, repMax: null, expectedSets: null, increment: "", ...extra,
});
const weigh = (date: string, value: number): LogItem => ({ ...base, id: `m${++n}`, date, kind: "metric", metric: "weight", value, unit: "kg" });
const waist = (date: string, value: number): LogItem => ({ ...base, id: `m${++n}`, date, kind: "metric", metric: "waist", value, unit: "cm" });
const health = (date: string, values: Record<string, number>): LogItem => ({ ...base, id: `h${++n}`, date, kind: "health", sleepH: null, steps: null, creatineTaken: null, creatineG: null, ...values });
const meal = (date: string, time: string, calories: number): Food => ({ ...base, id: `f${++n}`, date, kind: "food", description: "火锅", calories, protein: 30, isEstimate: true, time });

test("the fixed plan fills every day, follows 练一休一 and gives way to reported meals", () => {
  const items: LogItem[] = [lift("2026-10-02", "卧推", [[60, 8]]), meal("2026-10-03", "晚餐", 1200), meal("2026-10-03", "加餐", 150)];
  const all = withPlannedMeals(items, settings, "2026-10-04");
  const day = (date: string) => all.filter((i): i is Food => i.kind === "food" && i.date === date);
  assert.equal(day("2026-10-01").length, 3);
  assert.equal(day("2026-10-02").reduce((s, f) => s + f.calories!, 0), TARGETS.training.kcal, "a day with sets eats the training-day plan");
  assert.equal(day("2026-10-01").reduce((s, f) => s + f.calories!, 0), TARGETS.rest.kcal, "a past day without training is a rest day");
  const replaced = day("2026-10-03");
  assert.equal(replaced.filter(f => f.time === "晚餐").length, 1, "the reported dinner replaces the plan's");
  assert.ok(replaced.some(f => f.id.startsWith("plan-") && f.time === "午餐") && replaced.some(f => f.time === "加餐"), "a snack is extra");
  // Today: trained yesterday → rest day; a tap on the Today page overrides it.
  const today = [lift("2026-10-04", "深蹲", [[80, 5]])];
  assert.equal(dayType(today, "2026-10-05", "2026-10-05", settings), "rest");
  assert.equal(dayType(today, "2026-10-06", "2026-10-06", settings), "training");
  assert.equal(dayType(today, "2026-10-05", "2026-10-05", settings, { "2026-10-05": "training" }), "training");
  assert.equal(withPlannedMeals([], withPlan(null), "2026-10-04").length, 0, "no plan, no implied meals");
});

test("muscle groups and weekly hard sets", () => {
  assert.deepEqual(musclesOf("杠铃卧推"), { primary: ["胸"], secondary: ["三头", "肩"] });
  assert.deepEqual(musclesOf("罗马尼亚硬拉").primary, ["腘绳", "臀"]);
  assert.deepEqual(musclesOf("坐姿腿弯举").primary, ["腘绳"]);
  assert.deepEqual(musclesOf("高位下拉").primary, ["背"]);
  const { sets, unknown } = muscleSets([lift("2026-10-06", "卧推", [[60, 8], [60, 8], [60, 7]]), lift("2026-10-06", "奇怪动作", [[10, 10]])], "2026-10-05", "2026-10-11");
  assert.equal(sets["胸"], 3); assert.equal(sets["三头"], 1.5); assert.deepEqual(unknown, ["奇怪动作"]);
});

test("personal records: a better estimated max, or more reps at the same load", () => {
  const history = [lift("2026-09-01", "卧推", [[60, 8]]), lift("2026-09-05", "引体向上", [[0, 6]], { unit: "bodyweight" })];
  assert.match(personalRecords(history, [lift("2026-10-01", "卧推", [[62.5, 8]])])[0].text, /估算 1RM 79\.2 kg（之前最好 76\.0）/);
  assert.match(personalRecords(history, [lift("2026-10-01", "引体向上", [[0, 8]], { unit: "bodyweight" })])[0].text, /做到 8 次/);
  assert.deepEqual(personalRecords(history, [lift("2026-10-01", "卧推", [[60, 7]])]), []);
  assert.deepEqual(personalRecords([], [lift("2026-10-01", "卧推", [[60, 8]])]), [], "a first session is not a record");
});

test("plateaus are only flagged for a real drop while cutting", () => {
  const values = [80, 82, 82, 72, 70, 71];
  const items = values.map((w, i) => lift(addDays("2026-09-01", i * 6), "深蹲", [[w, 5]]));
  assert.equal(plateaus(items, "2026-10-08", settings)[0].tone, "care");
  const flat = [80, 82, 82, 82, 81, 82].map((w, i) => lift(addDays("2026-09-01", i * 6), "深蹲", [[w, 5]]));
  assert.equal(plateaus(flat, "2026-10-08", settings).length, 0);
  assert.equal(plateaus(flat, "2026-10-08", { ...settings, phase: "lean_gain" })[0].tone, "hold");
});

test("training load compares this week with the month and suggests a deload after a long streak", () => {
  const items: LogItem[] = [];
  for (let d = 41; d >= 0; d -= 2) items.push(lift(addDays("2026-10-08", -d), "卧推", [[60, 8], [60, 8], [60, 8], [60, 8]], d <= 6 ? { avgHr: 150, durationMin: 90, exerciseName: "卧推" } : {}));
  const load = trainingLoad(items, "2026-10-08", settings);
  assert.ok(load.ratio! > 1.5 && load.tone === "care", `ratio ${load.ratio}`);
  const advice = deloadAdvice(items, "2026-10-08", settings, { loadRatio: load.ratio, plateaus: 0, lowReadinessDays: 0 });
  assert.equal(advice.streak, 6, "six weeks of data, no light week"); assert.ok(advice.due, advice.text);
});

test("strength standards by bodyweight", () => {
  const bench = strengthLevel("杠铃卧推", "kg", 75, 75, "male")!;
  assert.equal(bench.level, "中级"); assert.deepEqual(bench.next, { level: "高级", kg: 112.5 });
  assert.equal(strengthLevel("哑铃卧推", "kg", 75, 75, "male"), null, "dumbbell work has no barbell standard");
});

test("readiness from HRV, resting heart rate, sleep and wrist temperature against the personal baseline", () => {
  const items: LogItem[] = [];
  for (let d = 1; d <= 14; d++) items.push(health(addDays("2026-10-08", -d), { hrvMs: 60 + (d % 3), restingHeartRate: 55, wristTempC: 35.0 }));
  items.push(health("2026-10-08", { hrvMs: 40, restingHeartRate: 63, sleepH: 5.2, wristTempC: 35.7 }));
  const low = readiness(items, "2026-10-08", settings)!;
  assert.equal(low.level, "low"); assert.equal(low.reasons.length, 4);
  items.push(health("2026-10-09", { hrvMs: 61, restingHeartRate: 55, sleepH: 7.6 }));
  assert.equal(readiness(items, "2026-10-09", settings)!.level, "good");
  assert.equal(readiness([], "2026-10-09", settings), null);
});

test("energy balance: intake minus the weight trend's energy", () => {
  const items: LogItem[] = [];
  for (let d = 30; d >= 1; d--) items.push(weigh(addDays("2026-10-08", -d), 80 - (30 - d) * 0.5 / 7));
  const plan = withPlannedMeals(items, withPlan("2026-09-01"), "2026-10-08");
  const result = energyBalance(plan, "2026-10-08")!;
  assert.equal(result.intake, TARGETS.rest.kcal);
  assert.ok(Math.abs(result.expenditure - (1900 + 550)) <= 20, `expenditure ${result.expenditure}`);
  assert.ok(Math.abs(result.perWeek + 0.5) < .01);
});

test("the plan's 14-day review rules", () => {
  const start = "2026-09-20";
  const s = withPlan(start);
  const early = dietReview([], "2026-09-25", s, { strengthDown: false, lowReadinessDays: 0 })!;
  assert.match(early.title, /执行第 6 天/);
  const losing: LogItem[] = [];
  for (let d = 0; d <= 18; d++) losing.push(weigh(addDays(start, d), 80 - d * 0.05));
  assert.equal(dietReview(losing, addDays(start, 18), s, { strengthDown: false, lowReadinessDays: 0 })!.title, "继续当前计划，不用改");
  const flat: LogItem[] = [waist(start, 85), waist(addDays(start, 20), 85)];
  for (let d = 0; d <= 21; d++) flat.push(weigh(addDays(start, d), 80 + (d % 2) * 0.1));
  const review = dietReview(flat, addDays(start, 21), s, { strengthDown: false, lowReadinessDays: 0 })!;
  assert.equal(review.title, "连续两周基本没变"); assert.equal(review.adjust, -120);
  assert.equal(dietReview(flat, addDays(start, 21), s, { strengthDown: true, lowReadinessDays: 0 })!.adjust, 120);
});

test("a plan read from a photo is calibrated so each kind of day adds up to its targets", () => {
  const rough: DietPlan = { ...PLAN, meals: PLAN.meals.map(m => m.day === "both" ? m : { ...m, kcal: Math.round(m.kcal * 1.2), protein: Math.round(m.protein * .9) }) };
  const fixed = calibratePlan(rough);
  for (const type of ["training", "rest"] as const) {
    const meals = planMeals(type, { ...settings, dietPlan: fixed });
    assert.equal(meals.reduce((n, m) => n + m.kcal, 0), TARGETS[type].kcal);
    assert.equal(meals.reduce((n, m) => n + m.protein, 0), TARGETS[type].protein);
  }
  assert.equal(fixed.meals[0].kcal, 615, "the shared breakfast keeps its estimate");
  const adjusted = planMeals("rest", { ...settings, dietPlan: fixed, dietAdjustKcal: -120 });
  assert.equal(adjusted.reduce((n, m) => n + m.kcal, 0), TARGETS.rest.kcal - 120, "a review adjustment is spread over lunch and dinner");
});
