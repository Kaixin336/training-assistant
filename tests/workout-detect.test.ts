import test from "node:test";
import assert from "node:assert/strict";
import { detectWorkouts, parseShortcutTime, samplesFrom, type Sample } from "../lib/workout-detect";

// 2026-10-08 in Auckland is NZDT (+13:00).
const at = (hhmm: string, seconds = 0) => Date.parse(`2026-10-08T${hhmm}:00+13:00`) + seconds * 1000;
const MIN = 60_000;

function day(): { hr: Sample[]; energy: Sample[]; steps: Sample[] } {
  const hr: Sample[] = [], energy: Sample[] = [], steps: Sample[] = [];
  // Background readings every 6 minutes from 06:00 to 22:00.
  for (let t = at("06:00"); t < at("22:00"); t += 6 * MIN) hr.push({ at: t, value: 68 });
  // 07:00–07:20 indoor walk: readings every 5 s, steady heart rate, about 100 steps a minute.
  for (let t = at("07:00"); t <= at("07:20"); t += 5000) hr.push({ at: t, value: 105 + (t / 5000) % 5 });
  for (let t = at("07:00"); t < at("07:20"); t += MIN) { steps.push({ at: t, value: 100 }); energy.push({ at: t, value: 4 }); }
  // 18:00–18:52 strength: sets push the heart rate up, rests let it fall; a 3-minute sensor gap mid-way.
  for (let t = at("18:00"); t <= at("18:52"); t += 5000) {
    if (t > at("18:30") && t < at("18:33")) continue;
    const minute = Math.floor((t - at("18:00")) / MIN);
    hr.push({ at: t, value: minute % 3 === 0 ? 150 : 110 });
  }
  for (let t = at("18:00"); t < at("18:52"); t += MIN) { steps.push({ at: t, value: 6 }); energy.push({ at: t, value: 6 }); }
  // A short 4-minute burst (e.g. the Heart Rate app) is not a workout.
  for (let t = at("12:00"); t <= at("12:04"); t += 5000) hr.push({ at: t, value: 90 });
  return { hr, energy, steps };
}

test("dense heart-rate stretches become workouts with time, heart rate, energy and type", () => {
  const { hr, energy, steps } = day();
  const found = detectWorkouts(hr, { energy, steps });
  assert.equal(found.length, 2);
  const [walk, lift] = found;
  assert.equal(walk.start, at("07:00")); assert.equal(walk.end, at("07:20")); assert.equal(walk.durationMin, 20);
  assert.equal(walk.name, "步行"); assert.equal(walk.cadence, 100); assert.equal(walk.energyKcal, 80);
  assert.ok(walk.avgHr >= 105 && walk.avgHr <= 109 && walk.maxHr === 109);
  assert.equal(lift.durationMin, 52, "a 3-minute sensor gap does not split the workout");
  assert.equal(lift.maxHr, 150); assert.equal(lift.energyKcal, 312);
  assert.equal(lift.name, "力量训练", "few steps in the window: a gym workout");
});

test("logged strength sets decide the type, and without step data the type stays generic", () => {
  const { hr } = day();
  const generic = detectWorkouts(hr);
  assert.deepEqual(generic.map(w => w.name), ["体能训练", "体能训练"]);
  // Sets typed into the app shortly after the 18:00 workout.
  const logged = detectWorkouts(hr, { strength: [{ start: at("19:10"), end: at("19:25") }] });
  assert.deepEqual(logged.map(w => w.name), ["体能训练", "力量训练"]);
});

test("Shortcuts date text in Chinese, English, relative and ISO forms", () => {
  const expected = at("18:05", 12);
  assert.equal(parseShortcutTime("2026年10月8日 下午6:05:12", "2026-10-08"), expected);
  assert.equal(parseShortcutTime("2026/10/8 18:05:12", "2026-10-08"), expected);
  assert.equal(parseShortcutTime("Oct 8, 2026 at 6:05:12 PM", "2026-10-08"), expected);
  assert.equal(parseShortcutTime("8 October 2026 at 18:05:12", "2026-10-08"), expected);
  assert.equal(parseShortcutTime("今天 下午6:05:12", "2026-10-08"), expected);
  assert.equal(parseShortcutTime("2026-10-08T18:05:12+13:00", "2026-10-08"), expected);
  assert.equal(parseShortcutTime("2026年10月8日 凌晨12:07", "2026-10-08"), at("00:07"));
  assert.equal(parseShortcutTime("2026年10月8日 中午12:30", "2026-10-08"), at("12:30"));
  assert.equal(parseShortcutTime("没有时间", "2026-10-08"), null);
});

test("values and times line up one per line, and a mismatch is explained", () => {
  const samples = samplesFrom("128\n131 次/分\n", "2026年10月8日 下午6:05:12\n2026年10月8日 下午6:05:17", "心率", "2026-10-08");
  assert.deepEqual(samples, [{ at: at("18:05", 12), value: 128 }, { at: at("18:05", 17), value: 131 }]);
  assert.deepEqual(samplesFrom([128], ["2026-10-08T18:05:12+13:00"], "心率", "2026-10-08"), [{ at: at("18:05", 12), value: 128 }]);
  assert.throws(() => samplesFrom("128\n131", "2026年10月8日 下午6:05:12", "心率", "2026-10-08"), /2 个数值、1 个时间/);
});
