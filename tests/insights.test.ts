import test from "node:test";
import assert from "node:assert/strict";
import { addDays, DEFAULT_SETTINGS, type DietPlan, type Food, type LogItem, type Settings, type Workout } from "../lib/domain";
import { calibratePlan, dayType, planMeals, withPlannedMeals } from "../lib/diet";
import { dailyExpenditure, dayBalance, deloadAdvice, dietReview, energyBalance, musclesOf, muscleSets, personalRecords, plateaus, readiness, strengthLevel, trainingLoad } from "../lib/insights";

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

test("daily expenditure: the Watch's total, scaled to what the weight trend says was burned", () => {
  const items: LogItem[] = [];
  // Weight falls 0.5 kg/week on the plan's rest days (1900 kcal): the trend says ~2450 kcal burned per day.
  for (let d = 30; d >= 1; d--) {
    const date = addDays("2026-10-08", -d);
    items.push(weigh(date, 80 - (30 - d) * 0.5 / 7));
    // The Watch reads about 10% high.
    items.push(health(date, { basalEnergyKcal: 1750, activeEnergyKcal: 950 }));
  }
  const all = withPlannedMeals(items, withPlan("2026-09-01"), "2026-10-08");
  const yesterday = dailyExpenditure(all, "2026-10-07", "2026-10-08")!;
  assert.equal(yesterday.estimate, false);
  assert.ok(Math.abs(yesterday.kcal - 2450) <= 30, `calibrated ${yesterday.kcal}`);
  const balance = dayBalance(all, "2026-10-07", "2026-10-08")!;
  assert.equal(balance.intake, 1900); assert.ok(balance.diff < -500 && balance.diff > -600);
  assert.equal(dailyExpenditure(all, "2026-10-08", "2026-10-08")!.estimate, true, "today is not over");
  // Without weight history the Watch is used as it is.
  const watchOnly = [health("2026-10-07", { basalEnergyKcal: 1700, activeEnergyKcal: 600 })];
  assert.equal(dailyExpenditure(watchOnly, "2026-10-07", "2026-10-08")!.kcal, 2300);
  // Synced by the 22:00 run (09:00 UTC in NZ summer time): resting energy is scaled up to the whole day.
  const lateSync: LogItem[] = [{ ...health("2026-10-07", { basalEnergyKcal: 1650, activeEnergyKcal: 600 }), createdAt: "2026-10-07T09:00:00.000Z" }];
  assert.equal(dailyExpenditure(lateSync, "2026-10-07", "2026-10-08")!.kcal, 2400);
  assert.equal(dailyExpenditure([], "2026-10-07", "2026-10-08"), null);
});

test("fat and carbs are calibrated with the plan and carried by implied meals", () => {
  const withMacros: DietPlan = { ...PLAN, targets: { training: { kcal: 2100, protein: 148, fat: 59, carbs: 235 }, rest: { kcal: 1900, protein: 143, fat: 59, carbs: 191 } },
    meals: PLAN.meals.map(m => ({ ...m, fat: 20, carbs: 70 })) };
  const fixed = calibratePlan(withMacros);
  for (const type of ["training", "rest"] as const) {
    const meals = planMeals(type, { ...settings, dietPlan: fixed });
    assert.equal(meals.reduce((n, m) => n + (m.fat ?? 0), 0), withMacros.targets[type].fat);
    assert.equal(meals.reduce((n, m) => n + (m.carbs ?? 0), 0), withMacros.targets[type].carbs);
  }
  const food = withPlannedMeals([], { ...settings, dietPlan: { ...fixed, startDate: "2026-10-08" } }, "2026-10-08").find(i => i.kind === "food");
  assert.ok(food && food.kind === "food" && food.fat === 20 && food.carbs === 70, "breakfast keeps its own macros");
});

test("a reported change swaps only the same kind of food in that meal", () => {
  const plan: DietPlan = { ...PLAN, startDate: "2026-10-08", meals: [
    { slot: "早餐", day: "both", text: "鸡蛋 2 个、燕麦 60g、牛奶 250ml、香蕉 1 个", kcal: 600, protein: 32, fat: 20, carbs: 75 },
    { slot: "午餐", day: "both", text: "鸡腿 200g、米饭 250g、西兰花 200g、酸奶 150g", kcal: 820, protein: 56, fat: 26, carbs: 94 },
    { slot: "晚餐", day: "both", text: "三文鱼 150g、红薯 250g、混合蔬菜 200g", kcal: 680, protein: 40, fat: 21, carbs: 75 },
  ] };
  const s: Settings = { ...settings, dietPlan: plan };
  const food = (time: string, description: string, values: Partial<Food> = {}): Food => ({ ...base, id: `f${++n}`, date: "2026-10-08", kind: "food", description, calories: null, protein: null, isEstimate: true, time, ...values });
  const day = (items: LogItem[]) => withPlannedMeals(items, s, "2026-10-08").filter((i): i is Food => i.kind === "food");
  const planned = (foods: Food[], slot: string) => foods.find(f => f.id.startsWith("plan-") && f.time === slot);

  // Only the meat reported, no values and no `replaces` (how a basic record looks): the rest of lunch stays.
  const lunch = food("午餐", "鸡胸肉 180g");
  // The AI's form: values for the new part only, naming the plan part it replaces.
  const dinner = food("晚餐", "鸡胸肉 200g", { calories: 240, protein: 46, fat: 5, carbs: 0, replaces: ["三文鱼 150g"] });
  // One part skipped.
  const milk = food("早餐", "没吃：牛奶 250ml", { calories: 0, protein: 0, fat: 0, carbs: 0, replaces: ["牛奶 250ml"] });
  const foods = day([lunch, dinner, milk]);
  const restOfLunch = planned(foods, "午餐")!, filled = foods.find(f => f.id === lunch.id)!;
  assert.equal(restOfLunch.description, "米饭 250g、西兰花 200g、酸奶 150g", "only the meat is swapped out");
  assert.ok(filled.calories! > 150 && filled.calories! < 250 && filled.protein! > 30 && filled.isEstimate, "missing values are estimated from the food table");
  assert.ok(restOfLunch.calories! + filled.calories! > 600 && restOfLunch.calories! + filled.calories! < 900, "lunch stays a whole lunch");
  assert.ok(restOfLunch.carbs! >= 90, "the rice's carbs are kept");
  assert.equal(planned(foods, "晚餐")!.description, "红薯 250g、混合蔬菜 200g");
  assert.equal(planned(foods, "早餐")!.description, "鸡蛋 2 个、燕麦 60g、香蕉 1 个");
  assert.ok(planned(foods, "早餐")!.calories! < 600 && planned(foods, "早餐")!.calories! > 400, "the skipped milk comes off breakfast");

  // A dish the table doesn't know, or `replaces: "all"`, stands in for the whole meal.
  assert.equal(planned(day([food("午餐", "火锅", { calories: 1200, protein: 50 })]), "午餐"), undefined);
  assert.equal(planned(day([food("午餐", "鸡胸肉 200g、米饭 200g", { calories: 470, protein: 50, replaces: "all" })]), "午餐"), undefined);
  // Something added to a meal without replacing anything leaves the plan meal whole.
  assert.equal(planned(day([food("午餐", "苹果 1 个", { calories: 80, protein: 0, replaces: [] })]), "午餐")!.calories, 820);
  // The AI's earlier form — the complete changed meal — still replaces every part.
  assert.equal(planned(day([food("午餐", "鸡胸肉 180g、米饭 250g、西兰花 200g、酸奶 150g", { calories: 780, protein: 60 })]), "午餐"), undefined);
});
