import { addDays, dateSchema, dayDiff, weekStart, type AppData, type Food, type Health, type LogItem, type Metric, type Workout, type WorkingSet } from "./domain";

export type WeeklyPeriod = { start: string; end: string; calendarEnd: string; days: number; complete: boolean };
export type DailyValue = { date: string; value: number; records: number };
export type RecordedAverage = { value: number | null; days: number; missingDays: number; partialDays: number; daily: DailyValue[] };
export type HealthKey = "sleepH" | "steps" | "activeEnergyKcal" | "restingHeartRate" | "hrvMs" | "exerciseMin";
export type ExerciseSession = {
  date: string; session: string; createdAt: string; logIds: string[]; sets: WorkingSet[];
  trainingSessionId: string | null; startedAt: string;
  repMin: number | null; repMax: number | null; expectedSets: number | null;
  workingSets: number; warmupSets: number; totalReps: number | null; knownRepSets: number;
  topWeight: number | null; knownWeightSets: number; recordedVolume: number | null;
  volumeSets: number; pain: boolean;
};
export type ExercisePeriod = {
  key: string; exerciseId: string | null; name: string; unit: string; side: WorkingSet["side"];
  sessions: ExerciseSession[]; workingSets: number; totalReps: number | null; knownRepSets: number;
  recordedVolume: number | null; volumeSets: number; volumeEligible: boolean;
};
export type TrainingTotals = {
  days: number | null; dates: string[]; workingSets: number | null; warmupSets: number | null;
  totalReps: number | null; knownRepSets: number; exercises: ExercisePeriod[];
};
export type WeekStats = {
  recordedDays: number; recordedDates: string[]; recordCount: number;
  weight: RecordedAverage; calories: RecordedAverage; protein: RecordedAverage;
  health: Record<HealthKey, RecordedAverage>; training: TrainingTotals;
  measurements: Record<(typeof metricKeys)[number], DailyValue | null>;
};
export type ExerciseComparison = {
  key: string; exerciseId: string | null; name: string; unit: string; side: WorkingSet["side"];
  current: ExercisePeriod | null; previous: ExercisePeriod | null;
  latest: ExerciseSession | null; previousLatest: ExerciseSession | null;
  delta: { workingSets: number | null; totalReps: number | null; topWeight: number | null; recordedVolume: number | null };
  setComparisons: { index: number; current: WorkingSet | null; previous: WorkingSet | null; weightDelta: number | null; repsDelta: number | null }[];
  observation: string;
};
export type PainReport = {
  records: { id: string; date: string; exerciseName: string | null; text: string; score: number | null }[];
  unresolved: { id: string; date: string; exerciseName: string | null; text: string }[];
  progressionBlocked: boolean; message: string;
};
export type TrainingPhase = AppData["settings"]["phase"];
export type WeeklyPhaseContext = {
  current: TrainingPhase; previous: TrainingPhase; currentLabel: string; previousLabel: string;
  changes: { date: string; from: TrainingPhase; to: TrainingPhase }[];
  mixedCurrent: boolean; mixedPrevious: boolean; comparisonCaution: boolean;
  message: string; focus: string[];
};
export type WeeklySummary = {
  version: 1; id: string; asOf: string; period: WeeklyPeriod; previousPeriod: WeeklyPeriod;
  comparisonMode: "complete_weeks" | "same_elapsed_days";
  current: WeekStats; previous: WeekStats;
  changes: { weight: number | null; calories: number | null; protein: number | null; trainingDays: number | null; workingSets: number | null; totalReps: number | null };
  exerciseComparisons: ExerciseComparison[]; pain: PainReport; phase: WeeklyPhaseContext; observations: string[];
};

const healthKeys: HealthKey[] = ["sleepH", "steps", "activeEnergyKcal", "restingHeartRate", "hrvMs", "exerciseMin"];
const metricKeys = ["waist", "arm"] as const;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const mean = (values: number[]) => values.length ? sum(values) / values.length : null;
const known = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const difference = (a: number | null, b: number | null) => a === null || b === null ? null : a - b;
const ordered = <T extends { date: string; createdAt: string; id: string }>(rows: T[]) => [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
const daysOf = (period: WeeklyPeriod) => Array.from({ length: period.days }, (_, index) => addDays(period.start, index));
const inPeriod = (item: { date: string }, period: WeeklyPeriod) => item.date >= period.start && item.date <= period.end;
const imported = (item: LogItem) => item.id.startsWith("health-");

function periodFor(end: string, today: string): WeeklyPeriod {
  const start = weekStart(end), calendarEnd = addDays(start, 6);
  return { start, end, calendarEnd, days: dayDiff(end, start) + 1, complete: end === calendarEnd && end < today };
}

function average(daily: DailyValue[], period: WeeklyPeriod, partialDays = 0): RecordedAverage {
  return { value: mean(daily.map(row => row.value)), days: daily.length, missingDays: period.days - daily.length, partialDays, daily };
}

// Manual measurements take precedence over device imports. Repeated device syncs
// represent a daily value, not additional independent weigh-ins or step totals.
function dailyMetrics(items: LogItem[], metric: Metric["metric"], period: WeeklyPeriod): DailyValue[] {
  return daysOf(period).flatMap(date => {
    const rows = ordered(items.filter((item): item is Metric => item.kind === "metric" && item.metric === metric && item.date === date));
    const manual = rows.filter(row => !imported(row));
    const selected = manual.length ? manual : rows.slice(-1);
    return selected.length ? [{ date, value: mean(selected.map(row => row.value))!, records: selected.length }] : [];
  });
}

function healthAverage(items: LogItem[], key: HealthKey, period: WeeklyPeriod): RecordedAverage {
  const daily = daysOf(period).flatMap(date => {
    const rows = ordered(items.filter((item): item is Health => item.kind === "health" && item.date === date))
      .filter(row => known((row as Health & Partial<Record<HealthKey, number | null>>)[key]));
    const manual = rows.filter(row => !imported(row));
    const selected = (manual.length ? manual : rows).at(-1);
    return selected ? [{ date, value: (selected as Health & Record<HealthKey, number>)[key], records: 1 }] : [];
  });
  return average(daily, period);
}

function foodAverage(items: LogItem[], key: "calories" | "protein", period: WeeklyPeriod): RecordedAverage {
  let partialDays = 0;
  const daily = daysOf(period).flatMap(date => {
    const rows = items.filter((item): item is Food => item.kind === "food" && item.date === date);
    if (!rows.length) return [];
    if (rows.some(row => !known(row[key]))) { partialDays++; return []; }
    return [{ date, value: sum(rows.map(row => row[key]!)), records: rows.length }];
  });
  return average(daily, period, partialDays);
}

function identity(row: Workout) {
  return row.exerciseId ? `id:${row.exerciseId}` : row.exerciseName?.trim() ? `name:${row.exerciseName.trim().toLocaleLowerCase()}` : `record:${row.id}`;
}

function supportsVolume(unit: string) {
  const label = unit.trim().toLowerCase();
  // Assistance is support provided by a machine, not lifted external load.
  return /(?:^|[^a-z])kg(?:$|[^a-z])|公斤|千克/.test(label) && !/assist|辅助|助力|bodyweight|自重|seconds|duration|秒|分钟/.test(label);
}

function summarizeSession(row: Workout, sets: WorkingSet[], eligible: boolean): ExerciseSession {
  const work = sets.filter(set => !set.isWarmup);
  const reps = work.filter(set => known(set.reps));
  const weights = work.filter(set => known(set.weightKg));
  const volume = eligible ? work.filter(set => known(set.weightKg) && known(set.reps) && set.durationSec === null && set.distanceM === null) : [];
  return {
    date: row.date, session: row.session, createdAt: row.createdAt, logIds: [row.id], sets,
    trainingSessionId: (row as Workout & { trainingSessionId?: string }).trainingSessionId ?? null, startedAt: row.createdAt,
    repMin: row.repMin, repMax: row.repMax, expectedSets: row.expectedSets,
    workingSets: work.length, warmupSets: sets.length - work.length,
    totalReps: reps.length ? sum(reps.map(set => set.reps!)) : null, knownRepSets: reps.length,
    topWeight: weights.length ? Math.max(...weights.map(set => set.weightKg!)) : null, knownWeightSets: weights.length,
    recordedVolume: volume.length ? sum(volume.map(set => set.weightKg! * set.reps!)) : null,
    volumeSets: volume.length, pain: row.pain,
  };
}

function trainingTotals(items: LogItem[]): TrainingTotals {
  const workouts = ordered(items.filter((item): item is Workout => item.kind === "workout"));
  const performed = workouts.filter(row => row.sets.length > 0 || row.completed || (row.durationMin ?? 0) > 0);
  const groups = new Map<string, ExercisePeriod>();
  for (const row of workouts) {
    const bySide = new Map<WorkingSet["side"], WorkingSet[]>();
    for (const set of row.sets) bySide.set(set.side, [...(bySide.get(set.side) ?? []), set]);
    for (const [side, sets] of bySide) {
      const unit = row.unit.trim();
      const key = JSON.stringify([identity(row), unit, side]);
      const group = groups.get(key) ?? { key, exerciseId: row.exerciseId, name: row.exerciseName || row.session || "未命名动作", unit, side, sessions: [], workingSets: 0, totalReps: null, knownRepSets: 0, recordedVolume: null, volumeSets: 0, volumeEligible: supportsVolume(unit) };
      // The backend assigns stable ids across fragmented messages. Date remains
      // part of the key to prevent malformed/reused ids crossing midnight.
      // Legacy rows without session ids fall back to one exercise session/day.
      const trainingSessionId = (row as Workout & { trainingSessionId?: string }).trainingSessionId ?? null;
      const earlier = group.sessions.find(session => session.date === row.date && session.trainingSessionId === trainingSessionId);
      const session = summarizeSession(row, earlier ? [...earlier.sets, ...sets] : sets, group.volumeEligible);
      if (earlier) {
        session.logIds = [...earlier.logIds, row.id];
        session.startedAt = earlier.startedAt;
        session.pain ||= earlier.pain;
        group.sessions[group.sessions.indexOf(earlier)] = session;
      } else group.sessions.push(session);
      groups.set(key, group);
    }
  }
  const exercises = [...groups.values()].map(group => {
    group.sessions.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
    group.workingSets = sum(group.sessions.map(session => session.workingSets));
    group.knownRepSets = sum(group.sessions.map(session => session.knownRepSets));
    group.totalReps = group.knownRepSets ? sum(group.sessions.map(session => session.totalReps ?? 0)) : null;
    group.volumeSets = sum(group.sessions.map(session => session.volumeSets));
    group.recordedVolume = group.volumeSets ? sum(group.sessions.map(session => session.recordedVolume ?? 0)) : null;
    return group;
  }).sort((a, b) => a.name.localeCompare(b.name, "zh-CN") || a.key.localeCompare(b.key));
  const dates = [...new Set(performed.map(row => row.date))].sort();
  const sets = performed.flatMap(row => row.sets), work = sets.filter(set => !set.isWarmup);
  const reps = work.filter(set => known(set.reps));
  return {
    days: performed.length ? dates.length : null, dates,
    workingSets: performed.length ? work.length : null,
    warmupSets: performed.length ? sets.length - work.length : null,
    totalReps: reps.length ? sum(reps.map(set => set.reps!)) : null,
    knownRepSets: reps.length, exercises,
  };
}

function statsFor(items: LogItem[], period: WeeklyPeriod): WeekStats {
  const rows = items.filter(item => inPeriod(item, period));
  const recordedDates = [...new Set(rows.map(item => item.date))].sort();
  return {
    recordedDays: recordedDates.length, recordedDates, recordCount: rows.length,
    weight: average(dailyMetrics(rows, "weight", period), period),
    calories: foodAverage(rows, "calories", period), protein: foodAverage(rows, "protein", period),
    health: Object.fromEntries(healthKeys.map(key => [key, healthAverage(rows, key, period)])) as Record<HealthKey, RecordedAverage>,
    training: trainingTotals(rows),
    measurements: Object.fromEntries(metricKeys.map(key => [key, dailyMetrics(rows, key, period).at(-1) ?? null])) as WeekStats["measurements"],
  };
}

function explicitResolution(text: string) {
  // Ambiguous text and negations remain unresolved; never infer recovery merely
  // because a later training record does not mention pain.
  if (/未(?:完全)?(?:恢复|缓解|消失)|没有(?:完全)?(?:恢复|缓解|消失)|仍[^。！？]*(?:痛|不适)|还有[^。！？]*痛|not (?:resolved|pain.free)|no pain relief|\bbut\b|\bhowever\b/i.test(text)) return false;
  return /(?:疼痛|痛感)(?:已经|已)?(?:完全)?消失|(?:已经|已)(?:完全)?无痛|(?:no (?:more )?pain|pain.free|pain (?:has )?resolved)/i.test(text);
}

function painFor(items: LogItem[], period: WeeklyPeriod, asOf: string): PainReport {
  const history = ordered(items.filter(item => item.date <= asOf));
  const pending = new Map<string, PainReport["unresolved"][number]>();
  const records: PainReport["records"] = [];
  for (const item of history) {
    if (item.kind === "workout") {
      const key = identity(item);
      if (item.painResolved && !item.pain) pending.delete(key);
      if (!item.pain) continue;
      const text = item.notes || "训练中记录了疼痛";
      pending.set(key, { id: item.id, date: item.date, exerciseName: item.exerciseName, text });
      if (inPeriod(item, period)) records.push({ id: item.id, date: item.date, exerciseName: item.exerciseName, text, score: item.painScore });
    } else if (item.kind === "note" && item.category === "pain") {
      if (explicitResolution(item.text)) pending.delete("general");
      else {
        pending.set("general", { id: item.id, date: item.date, exerciseName: null, text: item.text });
        if (inPeriod(item, period)) records.push({ id: item.id, date: item.date, exerciseName: null, text: item.text, score: null });
      }
    }
  }
  const unresolved = [...pending.values()];
  const progressionBlocked = records.length > 0 || unresolved.length > 0;
  return {
    records, unresolved, progressionBlocked,
    message: progressionBlocked ? "有疼痛记录或尚未确认恢复的疼痛。本报告仅展示实际变化，暂不建议加重；请先在助手里补充疼痛及恢复情况。" : "按实际记录比较。自由训练未设定目标次数范围时，不会仅凭一次表现就建议加重。",
  };
}

function compareExercise(current: ExercisePeriod | null, previous: ExercisePeriod | null): ExerciseComparison {
  const group = current ?? previous!;
  const latest = current?.sessions.filter(session => session.workingSets > 0).at(-1) ?? null;
  const previousLatest = previous?.sessions.filter(session => session.workingSets > 0).at(-1) ?? null;
  const fullReps = (session: ExerciseSession | null) => session && session.knownRepSets === session.workingSets ? session.totalReps : null;
  const fullWeights = (session: ExerciseSession | null) => session && session.knownWeightSets === session.workingSets ? session.topWeight : null;
  const fullVolume = (session: ExerciseSession | null) => session && session.volumeSets === session.workingSets ? session.recordedVolume : null;
  const delta = {
    workingSets: difference(latest?.workingSets ?? null, previousLatest?.workingSets ?? null),
    totalReps: difference(fullReps(latest), fullReps(previousLatest)),
    topWeight: difference(fullWeights(latest), fullWeights(previousLatest)),
    recordedVolume: difference(fullVolume(latest), fullVolume(previousLatest)),
  };
  const a = latest?.sets.filter(set => !set.isWarmup) ?? [], b = previousLatest?.sets.filter(set => !set.isWarmup) ?? [];
  const setComparisons = Array.from({ length: Math.max(a.length, b.length) }, (_, index) => ({ index: index + 1, current: a[index] ?? null, previous: b[index] ?? null, weightDelta: difference(a[index]?.weightKg ?? null, b[index]?.weightKg ?? null), repsDelta: difference(a[index]?.reps ?? null, b[index]?.reps ?? null) }));
  let observation = !latest ? "本期没有这个动作的工作组记录。" : !previousLatest ? "上期没有相同动作、单位和左右侧的工作组记录，暂不能比较。" : "两次记录的工作组、次数和最高已知重量如下。";
  if (latest && previousLatest) {
    const parts: string[] = [];
    if (delta.topWeight !== null) parts.push(delta.topWeight === 0 ? "最高工作重量相同" : `最高工作重量${delta.topWeight > 0 ? "增加" : "减少"} ${Math.abs(delta.topWeight).toLocaleString("zh-CN")} ${group.unit}`);
    if (delta.totalReps !== null) parts.push(delta.totalReps === 0 ? "总次数相同" : `总次数${delta.totalReps > 0 ? "增加" : "减少"} ${Math.abs(delta.totalReps)}`);
    if (delta.workingSets !== null && delta.workingSets !== 0) parts.push(`工作组${delta.workingSets > 0 ? "增加" : "减少"} ${Math.abs(delta.workingSets)} 组`);
    if (parts.length) observation = `${parts.join("；")}。这描述记录变化，不等同于力量或恢复状况的结论。`;
  }
  return { key: group.key, exerciseId: group.exerciseId, name: group.name, unit: group.unit, side: group.side, current, previous, latest, previousLatest, delta, setComparisons, observation };
}

const phaseLabels: Record<TrainingPhase, string> = { unspecified: "阶段未记录", fat_loss: "减脂期", maintenance: "维持期", lean_gain: "增肌期" };

function phaseContext(data: AppData, period: WeeklyPeriod, previousPeriod: WeeklyPeriod, current: WeekStats, comparisons: ExerciseComparison[], pain: PainReport): WeeklyPhaseContext {
  const timeline = [...(data.settings.phaseHistory ?? [])];
  // Current settings do not retroactively classify earlier weeks. A dated phase
  // entry is required before using that phase to interpret historical records.
  if (data.settings.phaseStart && !timeline.some(entry => entry.startDate === data.settings.phaseStart)) timeline.push({ phase: data.settings.phase, startDate: data.settings.phaseStart });
  timeline.sort((a, b) => a.startDate.localeCompare(b.startDate));
  const at = (date: string): TrainingPhase => timeline.filter(entry => entry.startDate <= date).at(-1)?.phase ?? "unspecified";
  const transitions = timeline.map(entry => ({ date: entry.startDate, from: at(addDays(entry.startDate, -1)), to: entry.phase })).filter(entry => entry.from !== entry.to);
  const changes = transitions.filter(entry => entry.date >= previousPeriod.start && entry.date <= period.end);
  const mixedCurrent = new Set(daysOf(period).map(at)).size > 1;
  const mixedPrevious = new Set(daysOf(previousPeriod).map(at)).size > 1;
  const currentPhase = at(period.end), previousPhase = at(previousPeriod.end);
  const comparisonCaution = currentPhase !== previousPhase || mixedCurrent || mixedPrevious || currentPhase === "unspecified" || previousPhase === "unspecified";
  const message = mixedCurrent || mixedPrevious || currentPhase !== previousPhase
    ? "两期涉及阶段变化。下方保留客观数值对比，但不把不同阶段的体重、训练量变化直接解释成进步或退步。"
    : currentPhase === "unspecified" ? "这个周期没有已生效的阶段记录，先按实际数据回顾，不套用当前目标解释过去。"
      : `两个周期都处于${phaseLabels[currentPhase]}，仍需结合记录天数和恢复情况看待变化。`;
  const focus: string[] = [];
  if (currentPhase === "fat_loss") {
    focus.push("减脂期重点观察同动作表现是否维持，以及睡眠和恢复情况。体重下降本身不能说明肌肉减少。");
  } else if (currentPhase === "lean_gain") {
    focus.push("增肌期观察同一动作、单位和左右侧的工作重量、次数及组数变化。体重或围度增加本身不能证明肌肉增长。");
  } else if (currentPhase === "maintenance") {
    focus.push("维持期观察体重、同动作表现与恢复是否稳定，不因单周波动自动调整训练量。");
  } else {
    focus.push("阶段未记录时，只描述重量、次数、围度和体重的变化；后续阶段会按生效日期分别回顾。");
  }
  if (!comparisonCaution) {
    const moreReps = comparisons.filter(item => item.delta.topWeight === 0 && (item.delta.totalReps ?? 0) > 0 && item.delta.workingSets === 0);
    const samePerformance = comparisons.filter(item => item.delta.topWeight === 0 && item.delta.totalReps === 0 && item.delta.workingSets === 0);
    const moreLoad = comparisons.filter(item => (item.delta.topWeight ?? 0) > 0 && item.delta.workingSets === 0 && (item.delta.totalReps ?? -1) >= 0 && !/assist|辅助|助力/i.test(item.unit));
    if (currentPhase === "fat_loss" && samePerformance.length) focus.push(`${samePerformance.length} 组可比动作在最近两次记录中的最高重量、总次数和工作组数相同；这是已记录表现的维持，不是肌肉量测量。`);
    if (moreReps.length) focus.push(`${moreReps.length} 组可比动作在工作组数与最高重量相同的情况下，记录了更多总次数。`);
    if (moreLoad.length) focus.push(`${moreLoad.length} 组可比动作在工作组数相同、总次数未减少的情况下，记录了更高的最高重量。`);
  }
  const sleep = current.health.sleepH;
  if (sleep.value === null) focus.push("本期还没有睡眠记录，恢复情况的信息不完整。");
  else if (data.settings.sleepMin !== null && sleep.value < data.settings.sleepMin) focus.push(`本期已记录睡眠均值 ${sleep.value.toFixed(1)} 小时（${sleep.days} 天），低于你设置的 ${data.settings.sleepMin} 小时目标；先结合主观疲劳和训练感受查看恢复，再决定是否增加训练负担。`);
  else focus.push(`本期睡眠均值 ${sleep.value.toFixed(1)} 小时，来自 ${sleep.days} 天记录；睡眠时长不能单独判断是否已恢复。`);
  const latest = comparisons.flatMap(item => item.latest ? [item.latest] : []);
  const missingPrescription = latest.some(session => session.repMin === null || session.repMax === null || session.sets.some(set => !set.isWarmup && set.feel === null));
  if (pain.progressionBlocked) focus.push("疼痛会优先限制渐进加重，本期不提供加重建议。");
  else if (missingPrescription) focus.push("部分动作尚缺目标次数范围或每组努力程度，本期只描述变化。补充这些信息后再判断是否加重。");
  else if (latest.length) focus.push("工作重量或次数的一次提升不自动触发再次加重；后续需结合相同动作表现与恢复记录判断。");
  focus.push("围度、同条件照片和同动作表现可一起观察；这些数据不能直接计算肌肉量。");
  return { current: currentPhase, previous: previousPhase, currentLabel: phaseLabels[currentPhase], previousLabel: phaseLabels[previousPhase], changes, mixedCurrent, mixedPrevious, comparisonCaution, message, focus };
}

/** Default: the last finished Monday–Sunday. An explicit current-week end gives
 * a preview compared with the same weekdays one week earlier, never a full week. */
export function buildWeeklySummary(data: AppData, weekEnd?: string): WeeklySummary {
  dateSchema.parse(data.today);
  const requested = dateSchema.parse(weekEnd ?? addDays(weekStart(data.today), -1));
  const end = requested > data.today ? data.today : requested;
  const period = periodFor(end, data.today), previousPeriod = periodFor(addDays(end, -7), data.today);
  const current = statsFor(data.items, period), previous = statsFor(data.items, previousPeriod);
  const comparisonMode = period.complete && previousPeriod.complete ? "complete_weeks" : "same_elapsed_days";
  const groups = new Map<string, { current: ExercisePeriod | null; previous: ExercisePeriod | null }>();
  for (const exercise of current.training.exercises) groups.set(exercise.key, { current: exercise, previous: null });
  for (const exercise of previous.training.exercises) groups.set(exercise.key, { current: groups.get(exercise.key)?.current ?? null, previous: exercise });
  const exerciseComparisons = [...groups.values()].map(group => compareExercise(group.current, group.previous));
  const pain = painFor(data.items, period, end);
  const phase = phaseContext(data, period, previousPeriod, current, exerciseComparisons, pain);
  const completeReps = (value: TrainingTotals) => value.knownRepSets === value.workingSets ? value.totalReps : null;
  const changes = {
    weight: difference(current.weight.value, previous.weight.value), calories: difference(current.calories.value, previous.calories.value), protein: difference(current.protein.value, previous.protein.value),
    trainingDays: difference(current.training.days, previous.training.days), workingSets: difference(current.training.workingSets, previous.training.workingSets), totalReps: difference(completeReps(current.training), completeReps(previous.training)),
  };
  const observations = [
    comparisonMode === "complete_weeks" ? "本报告比较两个已结束的周一至周日。" : `本期尚未形成完整周报，预览只与上周相同 ${period.days} 天的星期范围比较。`,
    `本期 ${current.recordedDays}/${period.days} 天有记录，上期 ${previous.recordedDays}/${previousPeriod.days} 天有记录；未记录不代表没有训练或摄入。`,
  ];
  if (current.weight.value !== null) observations.push(`本期体重均值 ${current.weight.value.toFixed(2)} kg，来自 ${current.weight.days} 天的日均值${changes.weight === null ? "；上期数据不足，暂不能比较" : `；比上期${changes.weight >= 0 ? "增加" : "减少"} ${Math.abs(changes.weight).toFixed(2)} kg`}。`);
  if (current.calories.partialDays || current.protein.partialDays) observations.push("含缺失热量或蛋白质的日期未计入该项营养均值；已记录的食物也不一定覆盖全天。 ");
  if (pain.progressionBlocked) observations.push(pain.message);
  observations.push(phase.message, ...phase.focus);
  return { version: 1, id: `${period.start}_${period.end}`, asOf: end, period, previousPeriod, comparisonMode, current, previous, changes, exerciseComparisons, pain, phase, observations };
}
