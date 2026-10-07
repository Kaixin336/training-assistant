import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, baseSet, type AppData, type Food, type Health, type LogItem, type Metric, type Workout } from "../lib/domain";
import { buildWeeklySummary } from "../lib/weekly-summary";

const common = (id: string, date: string) => ({ id, date, createdAt: `${date}T08:00:00Z`, source: "test", notes: "" });
const fixture = (items: LogItem[] = [], today = "2026-10-12"): AppData => ({ settings: structuredClone(DEFAULT_SETTINGS), plan: [], planVersion: 0, items, changes: [], messages: [], aiEnabled: false, today });
const weight = (id: string, date: string, value: number, extra: Partial<Metric> = {}): Metric => ({ ...common(id, date), kind: "metric", metric: "weight", value, unit: "kg", ...extra });
const health = (id: string, date: string, extra: Partial<Health> = {}): Health => ({ ...common(id, date), kind: "health", sleepH: null, steps: null, creatineG: null, creatineTaken: null, ...extra });
const meal = (id: string, date: string, calories: number | null, protein: number | null): Food => ({ ...common(id, date), kind: "food", description: "午餐", calories, protein, time: "", isEstimate: false });
const workout = (id: string, date: string, loads: (number | null)[], reps: (number | null)[] = loads.map(() => 8), extra: Partial<Workout> = {}): Workout => ({ ...common(id, date), kind: "workout", session: "自由训练", exerciseId: "bench-press", exerciseName: "卧推", unit: "kg", sets: loads.map((load, index) => ({ ...baseSet, weightKg: load, reps: reps[index], feel: "OK" })), completed: true, durationMin: null, pain: false, painScore: null, painWeeks: null, painResolved: false, isKeyLift: false, repMin: null, repMax: null, expectedSets: null, increment: "", ...extra });

test("default report always selects the last finished Monday through Sunday", () => {
  const monday = buildWeeklySummary(fixture());
  assert.deepEqual(monday.period, { start: "2026-10-05", end: "2026-10-11", calendarEnd: "2026-10-11", days: 7, complete: true });
  assert.equal(monday.previousPeriod.start, "2026-09-28");
  assert.equal(monday.comparisonMode, "complete_weeks");
  const sunday = buildWeeklySummary(fixture([], "2026-10-11"));
  assert.equal(sunday.period.end, "2026-10-04", "today's Sunday is not completed yet");
});

test("current-week preview compares matching weekdays, excluding later days in the previous week", () => {
  const report = buildWeeklySummary(fixture([workout("old-mon", "2026-09-28", [40]), workout("old-fri", "2026-10-02", [100]), workout("new-mon", "2026-10-05", [45])], "2026-10-07"), "2026-10-07");
  assert.equal(report.comparisonMode, "same_elapsed_days");
  assert.equal(report.period.days, 3);
  assert.equal(report.previousPeriod.end, "2026-09-30");
  assert.equal(report.previous.training.days, 1);
  assert.equal(report.exerciseComparisons[0].delta.topWeight, 5);
});

test("empty records are unknown rather than zero exercise, food or bodyweight", () => {
  const report = buildWeeklySummary(fixture());
  assert.equal(report.current.weight.value, null);
  assert.equal(report.current.calories.value, null);
  assert.equal(report.current.health.steps.value, null);
  assert.equal(report.current.training.days, null);
  assert.equal(report.current.training.workingSets, null);
  assert.equal(report.current.training.totalReps, null);
  assert.equal(report.current.recordedDays, 0);
  assert.equal(report.changes.workingSets, null);
});

test("bodyweight averages each day before averaging the recorded days", () => {
  const report = buildWeeklySummary(fixture([weight("a", "2026-10-05", 80), weight("b", "2026-10-05", 82), weight("c", "2026-10-06", 84)]));
  assert.equal(report.current.weight.value, 82.5);
  assert.equal(report.current.weight.days, 2);
  assert.equal(report.current.weight.missingDays, 5);
  assert.deepEqual(report.current.weight.daily.map(row => [row.value, row.records]), [[81, 2], [84, 1]]);
});

test("manual weight overrides imports and duplicate import sources use the latest daily value", () => {
  const report = buildWeeklySummary(fixture([
    weight("manual-a", "2026-10-05", 80), weight("manual-b", "2026-10-05", 82),
    weight("health-apple-a", "2026-10-05", 90, { createdAt: "2026-10-05T20:00:00Z" }),
    weight("health-a", "2026-10-06", 83), weight("health-b", "2026-10-06", 85, { createdAt: "2026-10-06T20:00:00Z" }),
  ]));
  assert.equal(report.current.weight.value, 83);
  assert.deepEqual(report.current.weight.daily.map(row => row.value), [81, 85]);
});

test("health uses manual priority per field and never sums duplicate source totals", () => {
  const report = buildWeeklySummary(fixture([
    health("health-steps", "2026-10-05", { steps: 9000, activeEnergyKcal: 500 }),
    health("health-sleep", "2026-10-05", { sleepH: 7, hrvMs: 42, restingHeartRate: 62, exerciseMin: 45, createdAt: "2026-10-05T10:00:00Z" }),
    health("manual", "2026-10-05", { steps: 7500 }),
    health("health-other", "2026-10-05", { steps: 9100, activeEnergyKcal: 510, createdAt: "2026-10-05T20:00:00Z" }),
  ]));
  assert.equal(report.current.health.steps.value, 7500);
  assert.equal(report.current.health.sleepH.value, 7);
  assert.equal(report.current.health.activeEnergyKcal.value, 510);
  assert.equal(report.current.health.hrvMs.value, 42);
  assert.equal(report.current.health.restingHeartRate.value, 62);
  assert.equal(report.current.health.exerciseMin.value, 45);
  assert.equal(report.current.recordedDays, 1);
});

test("nutrition excludes a day only for the field with missing meal values", () => {
  const report = buildWeeklySummary(fixture([meal("a", "2026-10-05", 500, 30), meal("b", "2026-10-05", null, 20), meal("c", "2026-10-06", 800, 60)]));
  assert.equal(report.current.calories.value, 800);
  assert.equal(report.current.calories.days, 1);
  assert.equal(report.current.calories.partialDays, 1);
  assert.equal(report.current.protein.value, 55);
  assert.equal(report.current.protein.days, 2);
});

test("working sets exclude warm-ups but keep unknown reps and weights unknown", () => {
  const row = workout("a", "2026-10-05", [20, 50, null], [12, 8, null]);
  row.sets[0].isWarmup = true;
  const report = buildWeeklySummary(fixture([row]));
  assert.equal(report.current.training.days, 1);
  assert.equal(report.current.training.workingSets, 2);
  assert.equal(report.current.training.warmupSets, 1);
  assert.equal(report.current.training.totalReps, 8);
  assert.equal(report.current.training.knownRepSets, 1);
  assert.equal(report.current.training.exercises[0].recordedVolume, 400);
  assert.equal(report.current.training.exercises[0].volumeSets, 1);
});

test("same exercise remains separate for kg, kg per side, left and right", () => {
  const row = workout("a", "2026-10-05", [20, 22], [8, 9]);
  row.sets[0].side = "left"; row.sets[1].side = "right";
  const report = buildWeeklySummary(fixture([row, workout("b", "2026-10-06", [30], [10], { unit: "kg/side" }), workout("c", "2026-10-06", [60])]));
  assert.equal(report.current.training.exercises.length, 4);
  assert.deepEqual(report.current.training.exercises.map(group => group.recordedVolume).sort((a, b) => a! - b!), [160, 198, 300, 480]);
  assert.equal(report.current.training.workingSets, 4);
});

test("assistance, bodyweight and timed sets never produce invented tonnage", () => {
  const timed = workout("time", "2026-10-07", [50], [8]); timed.sets[0].durationSec = 30;
  const report = buildWeeklySummary(fixture([workout("bw", "2026-10-05", [null], [10], { unit: "bodyweight" }), workout("assist", "2026-10-06", [30], [10], { unit: "assisted kg" }), timed]));
  assert.ok(report.current.training.exercises.every(group => group.recordedVolume === null));
});

test("legacy fragmented records without session ids merge by date even if message labels differ", () => {
  const report = buildWeeklySummary(fixture([workout("a", "2026-10-05", [50]), workout("b", "2026-10-05", [55]), workout("c", "2026-10-05", [60], [6], { session: "晚间训练", createdAt: "2026-10-05T19:00:00Z" })]));
  const sessions = report.current.training.exercises[0].sessions;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].workingSets, 3);
  assert.deepEqual(sessions[0].logIds, ["a", "b", "c"]);
  assert.equal(report.current.training.days, 1);
});

test("latest comparable sessions drive deltas while every dated set remains inspectable", () => {
  const report = buildWeeklySummary(fixture([workout("old-a", "2026-09-28", [40, 40], [10, 10]), workout("old-b", "2026-10-01", [50, 50], [8, 8]), workout("new-a", "2026-10-05", [52.5, 52.5], [8, 8]), workout("new-b", "2026-10-08", [55, 55], [8, 7])]));
  const item = report.exerciseComparisons[0];
  assert.equal(item.latest?.date, "2026-10-08");
  assert.equal(item.previousLatest?.date, "2026-10-01");
  assert.deepEqual(item.delta, { workingSets: 0, topWeight: 5, totalReps: -1, recordedVolume: 25 });
  assert.equal(item.current?.sessions.length, 2);
  assert.equal(item.previous?.sessions.length, 2);
  assert.deepEqual(item.setComparisons.map(set => [set.weightDelta, set.repsDelta]), [[5, 0], [5, -1]]);
  assert.doesNotMatch(item.observation, /建议加重|下次加|力量提高/);
});

test("unknown weight or reps prevents incomplete max-weight and rep-count deltas", () => {
  const report = buildWeeklySummary(fixture([workout("old", "2026-10-01", [50, 50], [8, 8]), workout("new", "2026-10-08", [55, null], [8, null])]));
  const item = report.exerciseComparisons[0];
  assert.equal(item.latest?.topWeight, 55);
  assert.equal(item.delta.topWeight, null);
  assert.equal(item.delta.totalReps, null);
  assert.equal(item.delta.recordedVolume, null);
  assert.equal(item.setComparisons[1].weightDelta, null);
});

test("free-form named exercises compare without a fixed plan or exercise id", () => {
  const report = buildWeeklySummary(fixture([workout("old", "2026-10-01", [20], [8], { exerciseId: null, exerciseName: "自由弯举" }), workout("new", "2026-10-08", [20], [10], { exerciseId: null, exerciseName: "自由弯举" })]));
  assert.equal(report.exerciseComparisons.length, 1);
  assert.equal(report.exerciseComparisons[0].delta.totalReps, 2);
});

test("unresolved older pain blocks progression despite later normal training", () => {
  const report = buildWeeklySummary(fixture([workout("pain", "2026-09-25", [], [], { pain: true, painScore: 4, notes: "肩部痛" }), workout("fine", "2026-10-08", [60])]));
  assert.equal(report.pain.records.length, 0);
  assert.equal(report.pain.unresolved.length, 1);
  assert.equal(report.pain.progressionBlocked, true);
});

test("explicit resolution clears old exercise pain but pain within the report still suppresses progression", () => {
  const old = workout("pain", "2026-09-25", [], [], { pain: true });
  const resolved = workout("resolved", "2026-10-06", [], [], { painResolved: true });
  const cleared = buildWeeklySummary(fixture([old, resolved]));
  assert.equal(cleared.pain.progressionBlocked, false);
  const current = buildWeeklySummary(fixture([{ ...old, date: "2026-10-05" }, resolved]));
  assert.equal(current.pain.unresolved.length, 0);
  assert.equal(current.pain.records.length, 1);
  assert.equal(current.pain.progressionBlocked, true);
});

test("ambiguous pain improvement does not silently resolve pain notes", () => {
  const note = (id: string, date: string, text: string): LogItem => ({ ...common(id, date), kind: "note", category: "pain", text });
  const report = buildWeeklySummary(fixture([note("p", "2026-09-25", "膝盖痛"), note("p2", "2026-10-04", "疼痛已缓解但仍有痛")]));
  assert.equal(report.pain.progressionBlocked, true);
  const resolved = buildWeeklySummary(fixture([note("p", "2026-09-25", "膝盖痛"), note("p2", "2026-10-04", "疼痛已经消失")]));
  assert.equal(resolved.pain.progressionBlocked, false);
});

test("future records are excluded and future requested end is limited to today", () => {
  const report = buildWeeklySummary(fixture([weight("future", "2026-10-30", 99)], "2026-10-07"), "2026-11-01");
  assert.equal(report.period.end, "2026-10-07");
  assert.equal(report.current.recordCount, 0);
  assert.throws(() => buildWeeklySummary(fixture(), "2026-02-31"));
});

test("circumference keeps the latest recorded day with its date in each week", () => {
  const report = buildWeeklySummary(fixture([weight("old-waist", "2026-09-30", 82, { metric: "waist", unit: "cm" }), weight("waist-a", "2026-10-05", 81, { metric: "waist", unit: "cm" }), weight("waist-b", "2026-10-09", 80, { metric: "waist", unit: "cm" })]));
  assert.deepEqual(report.current.measurements.waist, { date: "2026-10-09", value: 80, records: 1 });
  assert.equal(report.previous.measurements.waist?.value, 82);
  assert.equal(report.current.measurements.arm, null);
});

test("real recorded zero remains zero and is distinct from missing", () => {
  const report = buildWeeklySummary(fixture([health("steps", "2026-10-05", { steps: 0 }), meal("food", "2026-10-05", 0, 0)]));
  assert.equal(report.current.health.steps.value, 0);
  assert.equal(report.current.calories.value, 0);
  assert.equal(report.current.protein.value, 0);
});

test("phase history uses each week's end and marks a cut-to-gain transition", () => {
  const data = fixture([workout("old", "2026-10-01", [50]), workout("new", "2026-10-08", [55])]);
  data.settings.phase = "lean_gain";
  data.settings.phaseStart = "2026-10-05";
  data.settings.phaseHistory = [{ phase: "fat_loss", startDate: "2026-09-01" }, { phase: "lean_gain", startDate: "2026-10-05" }];
  const report = buildWeeklySummary(data);
  assert.equal(report.phase.current, "lean_gain");
  assert.equal(report.phase.previous, "fat_loss");
  assert.equal(report.phase.comparisonCaution, true);
  assert.deepEqual(report.phase.changes, [{ date: "2026-10-05", from: "fat_loss", to: "lean_gain" }]);
  assert.match(report.phase.message, /阶段变化/);
  assert.ok(!report.phase.focus.some(text => text.includes("记录了更高的最高重量")), "a cross-phase numeric delta is not interpreted as within-phase progress");
  assert.equal(report.exerciseComparisons[0].delta.topWeight, 5, "raw differences remain available");
});

test("phase changes within a week are marked even when both weeks end in the same phase", () => {
  const data = fixture();
  data.settings.phase = "lean_gain"; data.settings.phaseStart = "2026-10-09";
  data.settings.phaseHistory = [{ phase: "lean_gain", startDate: "2026-09-01" }, { phase: "fat_loss", startDate: "2026-10-07" }, { phase: "lean_gain", startDate: "2026-10-09" }];
  const report = buildWeeklySummary(data);
  assert.equal(report.phase.current, report.phase.previous);
  assert.equal(report.phase.mixedCurrent, true);
  assert.equal(report.phase.mixedPrevious, false);
  assert.equal(report.phase.comparisonCaution, true);
});

test("historical reports do not retroactively use today's phase or future phase changes", () => {
  const data = fixture([], "2026-10-26");
  data.settings.phase = "lean_gain"; data.settings.phaseStart = "2026-10-19";
  data.settings.phaseHistory = [{ phase: "fat_loss", startDate: "2026-10-07" }, { phase: "lean_gain", startDate: "2026-10-19" }];
  const old = buildWeeklySummary(data, "2026-10-04");
  assert.equal(old.phase.current, "unspecified");
  const cut = buildWeeklySummary(data, "2026-10-11");
  assert.equal(cut.phase.current, "fat_loss");
  assert.equal(cut.phase.mixedCurrent, true);
  assert.equal(cut.phase.changes.length, 1);
});

test("cutting phase observes maintained records and recovery without inferring muscle loss", () => {
  const data = fixture([weight("old-w", "2026-10-01", 80), weight("new-w", "2026-10-08", 79), workout("old", "2026-10-01", [50], [8]), workout("new", "2026-10-08", [50], [8]), health("sleep", "2026-10-08", { sleepH: 6 })]);
  data.settings.phaseHistory = [{ phase: "fat_loss", startDate: "2026-09-01" }]; data.settings.phaseStart = "2026-09-01"; data.settings.sleepMin = 7;
  const report = buildWeeklySummary(data);
  assert.equal(report.phase.comparisonCaution, false);
  assert.ok(report.phase.focus.some(text => text.includes("维持，不是肌肉量测量")));
  assert.ok(report.phase.focus.some(text => text.includes("体重下降本身不能说明肌肉减少")));
  assert.ok(report.phase.focus.some(text => text.includes("低于你设置的 7 小时目标")));
});

test("gain-phase observations describe repeated performance and require effort and rep-range context", () => {
  const data = fixture([workout("old", "2026-10-01", [50], [8]), workout("new", "2026-10-08", [50], [10])]);
  data.settings.phase = "lean_gain"; data.settings.phaseStart = "2026-09-01"; data.settings.phaseHistory = [{ phase: "lean_gain", startDate: "2026-09-01" }];
  const report = buildWeeklySummary(data);
  assert.ok(report.phase.focus.some(text => text.includes("记录了更多总次数")));
  assert.ok(report.phase.focus.some(text => text.includes("缺目标次数范围或每组努力程度")));
  assert.ok(report.phase.focus.some(text => text.includes("不能证明肌肉增长")));
});

test("pain takes precedence over gain-phase progression observations", () => {
  const data = fixture([workout("old", "2026-10-01", [50], [8]), workout("new", "2026-10-08", [55], [8], { pain: true, repMin: 6, repMax: 8 })]);
  data.settings.phase = "lean_gain"; data.settings.phaseStart = "2026-09-01"; data.settings.phaseHistory = [{ phase: "lean_gain", startDate: "2026-09-01" }];
  const report = buildWeeklySummary(data);
  assert.equal(report.pain.progressionBlocked, true);
  assert.ok(report.phase.focus.some(text => text.includes("本期不提供加重建议")));
  assert.ok(!report.phase.focus.some(text => text.includes("后续需结合相同动作表现")));
});

test("fragmented sets merge by stable session id despite each message declaring one expected set", () => {
  const rows = [1, 2, 3].map((ordinal, index) => ({
    ...workout(`set-${ordinal}`, "2026-10-08", [50], [8 - index], { expectedSets: 1, createdAt: `2026-10-08T08:0${index}:00Z` }),
    trainingSessionId: "morning-session", sets: [{ ...baseSet, weightKg: 50, reps: 8 - index, ordinal }],
  }));
  const report = buildWeeklySummary(fixture(rows));
  const session = report.exerciseComparisons[0].latest!;
  assert.equal(session.workingSets, 3);
  assert.equal(session.totalReps, 21);
  assert.equal(session.recordedVolume, 1050);
  assert.equal(session.trainingSessionId, "morning-session");
  assert.equal(session.startedAt, "2026-10-08T08:00:00Z");
  assert.equal(session.createdAt, "2026-10-08T08:02:00Z");
});

test("same-day separate session ids remain distinct and the latest session drives comparison", () => {
  const rows = [
    { ...workout("old", "2026-10-01", [50], [8]), trainingSessionId: "last-week" },
    { ...workout("morning", "2026-10-08", [55], [8], { createdAt: "2026-10-08T08:00:00Z" }), trainingSessionId: "am" },
    { ...workout("night", "2026-10-08", [45], [10], { createdAt: "2026-10-08T18:00:00Z" }), trainingSessionId: "pm" },
  ];
  const report = buildWeeklySummary(fixture(rows));
  assert.equal(report.current.training.exercises[0].sessions.length, 2);
  assert.equal(report.current.training.days, 1);
  assert.equal(report.current.training.totalReps, 18);
  assert.equal(report.exerciseComparisons[0].latest?.trainingSessionId, "pm");
  assert.equal(report.exerciseComparisons[0].delta.topWeight, -5);
  assert.equal(report.exerciseComparisons[0].delta.totalReps, 2);
});

test("even a reused session id cannot merge exercise records across different days", () => {
  const report = buildWeeklySummary(fixture([
    { ...workout("one", "2026-10-05", [50]), trainingSessionId: "reused" },
    { ...workout("two", "2026-10-06", [55]), trainingSessionId: "reused" },
  ]));
  assert.equal(report.current.training.exercises[0].sessions.length, 2);
  assert.equal(report.current.training.days, 2);
});
