import { logItemSchema, type LogItem, type TrainingSession, type Workout } from "./domain";
import { db } from "./server-store";
import { DETECTED_NAMES, detectWorkouts, samplesFrom, WORKOUT_SAMPLE_KEYS, type Interval } from "./workout-detect";

const pick = (body: Record<string, unknown>, keys: readonly string[]) => keys.map(key => body[key]).find(value => value !== undefined && value !== null && value !== "");
const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Pacific/Auckland", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;
const timeSpan = (w: Workout): Interval | null => w.startedAt && w.endedAt ? { start: Date.parse(w.startedAt), end: Date.parse(w.endedAt) } : null;

/**
 * Turns the Shortcut's raw heart-rate (and optional energy/step) samples into today's workouts.
 * Re-syncing replaces the previous guesses for the day, keeps their ids, and keeps a type the user
 * renamed by hand. Workouts imported from the full Health export already carry the real type, so
 * a detection overlapping one of them is dropped.
 */
export async function detectedWorkoutPlan(user: string, body: Record<string, unknown>, today: string): Promise<{ items: LogItem[]; remove: string[]; heartRates: number } | null> {
  const hrValues = pick(body, WORKOUT_SAMPLE_KEYS.hr);
  if (hrValues === undefined) return null;
  const hr = samplesFrom(hrValues, pick(body, WORKOUT_SAMPLE_KEYS.hrTime), "心率", today);
  const energyValues = pick(body, WORKOUT_SAMPLE_KEYS.kcal), stepValues = pick(body, WORKOUT_SAMPLE_KEYS.stepList);
  const energy = energyValues === undefined ? undefined : samplesFrom(energyValues, pick(body, WORKOUT_SAMPLE_KEYS.kcalTime), "活动能量", today);
  const steps = stepValues === undefined ? undefined : samplesFrom(stepValues, pick(body, WORKOUT_SAMPLE_KEYS.stepTime), "步数明细", today);

  const [sessionRows, recordRows] = await Promise.all([
    db().prepare("SELECT payload FROM training_sessions WHERE owner=? AND date=?").bind(user, today).all<{ payload: string }>(),
    db().prepare("SELECT id,payload FROM records WHERE owner=? AND date=? AND kind='workout' AND deleted=0").bind(user, today).all<{ id: string; payload: string }>(),
  ]);
  const workouts = recordRows.results.map(row => JSON.parse(row.payload) as Workout);
  const strength: Interval[] = [
    ...sessionRows.results.map(row => JSON.parse(row.payload) as TrainingSession).map(s => ({ start: Date.parse(s.startedAt), end: Date.parse(s.lastActivityAt) })),
    ...workouts.filter(w => w.sets.length > 0).map(w => ({ start: Date.parse(w.createdAt), end: Date.parse(w.createdAt) })),
  ];
  const imported = workouts.filter(w => w.id.startsWith("health-apple-shortcuts-workout-")).map(timeSpan).filter((w): w is Interval => w !== null);
  const previous = workouts.filter(w => w.id.startsWith("health-detected-"));
  const fromScreenshots = workouts.filter(w => w.session === "Apple Watch" && !w.id.startsWith("health-") && w.durationMin !== null);
  const sameAsScreenshot = (minutes: number) => fromScreenshots.some(w => Math.abs(w.durationMin! - minutes) <= Math.max(5, minutes * .2));

  const used = new Set<string>(), now = new Date().toISOString(), items: LogItem[] = [];
  for (const found of detectWorkouts(hr, { energy, steps, strength })) {
    if (dayFormat.format(new Date(found.start)) !== today || imported.some(w => overlaps(w, found)) || sameAsScreenshot(found.durationMin)) continue;
    const match = previous.find(w => !used.has(w.id) && (() => { const span = timeSpan(w); return span !== null && overlaps(span, found); })());
    const id = match?.id ?? `health-detected-${today}-${timeFormat.format(new Date(found.start)).replace(":", "")}`;
    used.add(id);
    const renamed = match?.exerciseName && !DETECTED_NAMES.includes(match.exerciseName) ? match.exerciseName : null;
    items.push(logItemSchema.parse({
      id, date: today, createdAt: match?.createdAt ?? now, source: "apple-shortcuts", notes: "按手表心率推算的运动时段",
      kind: "workout", session: "Apple Watch", exerciseId: null, exerciseName: renamed ?? found.name, unit: "", sets: [], completed: true,
      durationMin: found.durationMin, pain: false, painScore: null, painWeeks: null, painResolved: false, isKeyLift: false,
      repMin: null, repMax: null, expectedSets: null, increment: "", avgHr: found.avgHr, maxHr: found.maxHr,
      ...(found.energyKcal ? { energyKcal: found.energyKcal } : {}),
      startedAt: new Date(found.start).toISOString(), endedAt: new Date(found.end).toISOString(),
    }));
  }
  return { items, remove: previous.map(w => w.id).filter(id => !used.has(id)), heartRates: hr.length };
}
