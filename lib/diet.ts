import { addDays, type DietPlan, type Food, type LogItem, type Settings } from "./domain";

/**
 * A fixed eating plan stored in settings (set by sending it to the AI). The user eats exactly this unless they
 * report otherwise, so every day from the start date gets the plan's meals implicitly; a meal they report
 * (food with time 早餐/午餐/晚餐) replaces that slot, anything else is extra. Nothing here is written to the
 * database. Meal values are estimates calibrated to add up to the plan's daily targets.
 */
export type DayType = "training" | "rest";
export type Slot = "早餐" | "午餐" | "晚餐";
export type PlanMeal = DietPlan["meals"][number];
export const DEFAULT_WEEKLY_LOSS: [number, number] = [0.2, 0.5];
export const REVIEW_DAYS = 14;

export const planOf = (settings: Settings): DietPlan | null => settings.dietPlan ?? null;
export const SLOTS: Slot[] = ["早餐", "午餐", "晚餐"];
export const planStart = (settings: Settings) => planOf(settings)?.startDate ?? null;
export const isPlanned = (item: Pick<LogItem, "id">) => item.id.startsWith("plan-");

/** A strength day: working sets logged, or a Watch/Health workout recognised as strength training. */
export function isStrengthDay(items: LogItem[], date: string) {
  return items.some(i => i.kind === "workout" && i.date === date && (i.sets.some(s => !s.isWarmup) || /力量/.test(i.exerciseName ?? "")));
}

/**
 * The user's own choice for a day wins (tapping 训练日/休息日 on the Today page). Otherwise 练一休一:
 * a past day is what actually happened; today is a training day unless yesterday was one.
 */
export function dayType(items: LogItem[], date: string, today: string, settings?: Settings, chosen: Record<string, DayType> = {}): DayType {
  if (chosen[date]) return chosen[date];
  if (isStrengthDay(items, date)) return "training";
  if (date < today) return "rest";
  if (settings?.trainingPattern === "free") return "rest";
  return isStrengthDay(items, addDays(date, -1)) ? "rest" : "training";
}

/** Which plan slot a reported meal replaces; snacks and unknown times are extras. */
export function slotOf(food: Pick<Food, "time" | "description">): Slot | null {
  const text = food.time.trim();
  if (/早|breakfast/i.test(text)) return "早餐";
  if (/午|lunch/i.test(text)) return "午餐";
  if (/晚|dinner|supper/i.test(text)) return "晚餐";
  const clock = text.match(/^(\d{1,2}):(\d{2})/);
  if (!clock) return null;
  const hour = +clock[1] + +clock[2] / 60;
  return hour < 10.5 ? "早餐" : hour >= 11 && hour < 15 ? "午餐" : hour >= 17 && hour < 22 ? "晚餐" : null;
}

/** The meal for each slot on this kind of day: a day-specific meal wins over a "both" one; missing slots are skipped. */
export function mealsFor(plan: DietPlan, type: DayType): PlanMeal[] {
  return SLOTS.flatMap(slot => { const meal = plan.meals.find(m => m.slot === slot && m.day === type) ?? plan.meals.find(m => m.slot === slot && m.day === "both"); return meal ? [meal] : []; });
}

export function planMeals(type: DayType, settings: Settings): PlanMeal[] {
  const plan = planOf(settings);
  if (!plan) return [];
  // A calorie adjustment from the 14-day review is split over the day's non-breakfast meals.
  const meals = mealsFor(plan, type), adjust = settings.dietAdjustKcal ?? 0;
  const later = meals.filter(m => m.slot !== "早餐");
  return !adjust || !later.length ? meals : meals.map(m => m.slot === "早餐" ? m : { ...m, kcal: m.kcal + Math.round(adjust / later.length) });
}

export function planTargets(type: DayType, settings: Settings) {
  const plan = planOf(settings);
  if (!plan) return null;
  const base = plan.targets[type];
  return { kcal: base.kcal + (settings.dietAdjustKcal ?? 0), protein: base.protein, fat: base.fat ?? null, carbs: base.carbs ?? null };
}

/**
 * Meal values read from a photo are estimates. Scale each day type's own meals so the day adds up to its
 * targets; meals shared by both kinds of day stay as estimated.
 */
export function calibratePlan(plan: DietPlan): DietPlan {
  const meals = plan.meals.map(m => ({ ...m }));
  for (const type of ["training", "rest"] as DayType[]) {
    const used = mealsFor({ ...plan, meals }, type);
    const own = used.filter(m => m.day === type), shared = used.filter(m => m.day === "both");
    if (!own.length) continue;
    for (const key of ["kcal", "protein"] as const) {
      const fixed = shared.reduce((n, m) => n + m[key], 0), current = own.reduce((n, m) => n + m[key], 0);
      const want = plan.targets[type][key] - fixed;
      if (current <= 0 || want <= 0) continue;
      const factor = want / current;
      if (factor < .5 || factor > 2) continue;
      for (const meal of own) meal[key] = Math.round(meal[key] * factor);
      // Put the rounding remainder on the last meal so the day adds up exactly.
      own[own.length - 1][key] += Math.round(want - own.reduce((n, m) => n + m[key], 0));
    }
  }
  return { ...plan, meals };
}

/** The plan's meals for every day from its start through today, except slots the user reported. */
export function withPlannedMeals(items: LogItem[], settings: Settings, today: string, chosen: Record<string, DayType> = {}): LogItem[] {
  const start = planStart(settings);
  if (!start || start > today) return items;
  const real = items.filter(i => !isPlanned(i));
  const reported = new Set(real.filter((i): i is Food => i.kind === "food").flatMap(f => { const slot = slotOf(f); return slot ? [`${f.date}|${slot}`] : []; }));
  const planned: Food[] = [];
  for (let date = start; date <= today; date = addDays(date, 1)) {
    for (const meal of planMeals(dayType(real, date, today, settings, chosen), settings)) {
      if (reported.has(`${date}|${meal.slot}`)) continue;
      planned.push({ id: `plan-${date}-${meal.slot}`, kind: "food", date, createdAt: `${date}T00:00:00.000Z`, source: "diet-plan", notes: "按固定饮食计划推定；吃了别的告诉 AI，会替换这一餐", description: meal.text, calories: meal.kcal, protein: meal.protein, isEstimate: true, time: meal.slot });
    }
  }
  return [...real, ...planned];
}

