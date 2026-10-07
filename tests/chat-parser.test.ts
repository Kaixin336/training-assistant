import test from "node:test";
import assert from "node:assert/strict";
import { parseBasicChat, resolveDate } from "../lib/chat-engine";
import { DEFAULT_SETTINGS, setSummary, type AppData, type TrainingSession, type Workout } from "../lib/domain";

const TODAY = "2026-10-07";
const data = (activeSession: TrainingSession | null = null): AppData => ({ settings: structuredClone(DEFAULT_SETTINGS), plan: [], planVersion: 0, items: [], changes: [], messages: [], aiEnabled: false, today: TODAY, activeSession, sessions: activeSession ? [activeSession] : [] });
const benchSession: TrainingSession = { id: "s1", date: TODAY, startedAt: "", lastActivityAt: new Date().toISOString(), endedAt: null, activeExerciseId: "x", activeExerciseName: "杠铃卧推", activeUnit: "kg", lastWeightKg: 60 };
function workouts(text: string, d = data()) {
  const result = parseBasicChat(text, d);
  assert.equal(result.type, "records", `${text} → ${"reply" in result ? result.reply : ""}`);
  return result.type === "records" ? result.items.filter((i): i is Workout => i.kind === "workout") : [];
}
const sets = (w: Workout) => w.sets.map(s => [s.weightKg, s.reps, s.feel, s.isWarmup]);
function asks(text: string, pattern: RegExp, d = data()) {
  const result = parseBasicChat(text, d);
  assert.equal(result.type, "clarification", text);
  if (result.type === "clarification") assert.match(result.reply, pattern);
}

test("sets × reps in both notations, with effort", () => {
  for (const text of ["卧推 60kg 3x8 吃力", "卧推 60公斤 3组8次 吃力"]) {
    const [w] = workouts(text);
    assert.equal(w.exerciseName, "杠铃卧推");
    assert.equal(w.unit, "kg");
    assert.deepEqual(sets(w), Array(3).fill([60, 8, "Hard", false]));
  }
});
test("per-set loads and rep lists keep every set; effort marks only the last", () => {
  assert.deepEqual(sets(workouts("卧推 60x8 65x6 65kg×5 吃力")[0]), [[60, 8, null, false], [65, 6, null, false], [65, 5, "Hard", false]]);
  assert.deepEqual(sets(workouts("深蹲 80kg 5/5/4 吃力")[0]), [[80, 5, null, false], [80, 5, null, false], [80, 4, "Hard", false]]);
  assert.deepEqual(sets(workouts("卧推 60kg 8次")[0]), [[60, 8, null, false]]);
});
test("load conventions stay distinct and dumbbells are never guessed", () => {
  assert.equal(workouts("臀推 每边40kg 3x10")[0].unit, "kg/side");
  assert.equal(workouts("哑铃卧推 单手20kg 3x10")[0].unit, "kg/hand");
  assert.equal(workouts("引体向上 加重10kg 3x5")[0].unit, "added kg");
  const combined = workouts("哑铃卧推 两只合计40kg 3x10")[0];
  assert.equal(combined.unit, "kg");
  assert.match(combined.exerciseName!, /两只合计/);
  asks("哑铃卧推 20kg 3x10", /单手还是两只合计/);
});
test("bodyweight work and ambiguous numbers", () => {
  assert.deepEqual(sets(workouts("引体向上 3组8次")[0]).map(s => s[1]), [8, 8, 8]);
  assert.deepEqual(sets(workouts("引体 8 7 6")[0]).map(s => s[1]), [8, 7, 6]);
  assert.equal(workouts("俯卧撑 3x15")[0].unit, "bodyweight");
  asks("卧推 3x8", /组数×次数还是重量×次数/);
});
test("warm-up sets are flagged and summarised as warm-up", () => {
  const [w] = workouts("热身 卧推 40kg 10次");
  assert.equal(w.sets[0].isWarmup, true);
  assert.match(setSummary(w), /^热身 /);
});
test("an open session lets a bare set continue the current exercise", () => {
  const active = data(benchSession);
  const [a] = workouts("第三组 62.5kg 8次", active);
  assert.equal(a.exerciseName, "杠铃卧推");
  assert.deepEqual(sets(a), [[62.5, 8, null, false]]);
  assert.deepEqual(sets(workouts("又一组 8个 吃力", active)[0]), [[60, 8, "Hard", false]], "reuses the last weight");
  assert.deepEqual(sets(workouts("62.5 x 8", active)[0]), [[62.5, 8, null, false]]);
  asks("第三组 62.5kg 8次", /没有找到正在进行的动作/);
  asks("又一组 8个", /没有找到正在进行的动作/, data({ ...benchSession, date: "2026-10-06" }));
});
test("mixed messages keep every part, including the second half", () => {
  const result = parseBasicChat("卧推 60kg 3x8，深蹲 80kg 3x5，体重 72.4", data());
  assert.equal(result.type, "records");
  if (result.type === "records") assert.deepEqual(result.items.map(i => i.kind === "workout" ? i.exerciseName : i.kind), ["杠铃卧推", "深蹲", "metric"]);
  const rows = parseBasicChat("高位下拉 50kg 3x10，划船 40kg 3x10 适中", data());
  assert.equal(rows.type === "records" && rows.items.length, 2);
  const meal = parseBasicChat("午餐：鸡胸肉米饭，650kcal，45g蛋白质", data());
  assert.ok(meal.type === "records" && meal.items[0].kind === "food" && meal.items[0].description === "午餐 鸡胸肉米饭" && meal.items[0].protein === 45);
});
test("dates resolve relative to Auckland today", () => {
  const result = parseBasicChat("昨天 睡眠 7.5小时，步数 9000", data());
  assert.ok(result.type === "records" && result.items.every(i => i.date === "2026-10-06"));
  assert.equal(resolveDate("前天 体重 72", TODAY).date, "2026-10-05");
  assert.equal(resolveDate("2026-10-01 体重 72", TODAY).date, "2026-10-01");
});
test("corrections and unclear sentences never create records", () => {
  assert.equal(parseBasicChat("刚才那个卧推写错了，改成 65", data()).type, "clarification");
  asks("今天练得不错，状态很好", /DeepSeek/);
});
