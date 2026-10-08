import { addDays, type DietPlan, type Food, type LogItem, type Settings } from "./domain";
import { estimateText, kindOf, kindsIn, partShares, samePart, splitParts } from "./meal-parts";

/**
 * A fixed eating plan stored in settings (set by sending it to the AI). The user eats exactly this unless they
 * report otherwise, so every day from the start date gets the plan's meals implicitly. A food reported for a
 * meal (time 早餐/午餐/晚餐) swaps only the plan parts of the same kind — meat for meat — and the rest of that
 * meal stays; anything else is extra. Nothing here is written to the database. Meal values are estimates
 * calibrated to add up to the plan's daily targets.
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
  // Without a time, a description that starts with the meal ("午餐：鸡胸 200g") names it.
  const text = food.time.trim() || (food.description.trim().match(/^(早餐|早饭|午餐|午饭|晚餐|晚饭)/)?.[1] ?? "");
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
    for (const key of ["kcal", "protein", "fat", "carbs"] as const) {
      const target = plan.targets[type][key];
      if (target == null || used.some(m => m[key] == null)) continue;
      const fixed = shared.reduce((n, m) => n + (m[key] ?? 0), 0), current = own.reduce((n, m) => n + (m[key] ?? 0), 0);
      const want = target - fixed;
      if (current <= 0 || want <= 0) continue;
      const factor = want / current;
      if (factor < .5 || factor > 2) continue;
      for (const meal of own) meal[key] = Math.round((meal[key] ?? 0) * factor);
      // Put the rounding remainder on the last meal so the day adds up exactly.
      own[own.length - 1][key] = (own[own.length - 1][key] ?? 0) + Math.round(want - own.reduce((n, m) => n + (m[key] ?? 0), 0));
    }
  }
  return { ...plan, meals };
}

/**
 * Which parts of a plan meal a reported food stands in for: the parts it names (`replaces`), else the parts of
 * the same kind as what it describes. A dish the food table doesn't know ("火锅") replaces the whole meal.
 */
export function partsReplaced(food: Pick<Food, "description" | "replaces">, parts: string[]): Set<number> {
  const all = new Set(parts.map((_, i) => i));
  if (food.replaces === "all") return all;
  const named = food.replaces;
  if (Array.isArray(named)) return new Set(parts.flatMap((p, i) => named.some(r => samePart(p, r)) ? [i] : []));
  const kinds = kindsIn(food.description);
  if (!kinds.size) return all;
  return new Set(parts.flatMap((p, i) => { const kind = kindOf(p); return kind && kinds.has(kind) ? [i] : []; }));
}

/**
 * One plan meal with the user's changes: what is left of the plan (its parts and their share of the values)
 * and the reported foods, with missing values estimated — from the food table, or as an even swap for the parts
 * they replace.
 */
export function applyChanges(meal: PlanMeal, reported: Food[]) {
  const parts = splitParts(meal.text), shares = partShares(parts, meal);
  const gone = new Set<number>(), foods: Food[] = [];
  for (const food of reported) {
    const replaced = partsReplaced(food, parts);
    replaced.forEach(i => gone.add(i));
    if (food.calories !== null && food.protein !== null && food.fat != null && food.carbs != null) { foods.push(food); continue; }
    // Fill only what is missing: a skipped part (0 kcal) is all zeros; otherwise the food table, or an even swap.
    const sum = (key: "kcal" | "protein" | "fat" | "carbs") => { const values = [...replaced].map(i => shares[i][key]); return values.some(v => v == null) ? null : values.reduce<number>((n, v) => n + v!, 0); };
    const even = replaced.size && replaced.size < parts.length ? { kcal: sum("kcal")!, protein: sum("protein")!, fat: sum("fat"), carbs: sum("carbs") } : null;
    const guess = food.calories === 0 ? { kcal: 0, protein: 0, fat: 0, carbs: 0 } : estimateText(food.description) ?? (food.calories === null ? even : null);
    if (!guess) { foods.push(food); continue; }
    const round = (v: number | null) => v === null ? null : Math.round(v);
    foods.push({ ...food, calories: food.calories ?? round(guess.kcal), protein: food.protein ?? round(guess.protein), fat: food.fat ?? round(guess.fat), carbs: food.carbs ?? round(guess.carbs), isEstimate: food.isEstimate || food.calories === null || food.protein === null });
  }
  const kept = parts.flatMap((p, i) => gone.has(i) ? [] : [i]);
  if (!kept.length) return { rest: null, foods };
  const total = (key: "kcal" | "protein" | "fat" | "carbs") => meal[key] == null ? null : Math.round(kept.reduce((n, i) => n + (shares[i][key] ?? 0), 0));
  const rest = gone.size ? { text: kept.map(i => parts[i]).join("、"), kcal: total("kcal")!, protein: total("protein")!, fat: total("fat"), carbs: total("carbs") } : { text: meal.text, kcal: meal.kcal, protein: meal.protein, fat: meal.fat ?? null, carbs: meal.carbs ?? null };
  return { rest, foods };
}

/** The plan's meals for every day from its start through today, with the user's reported changes applied. */
export function withPlannedMeals(items: LogItem[], settings: Settings, today: string, chosen: Record<string, DayType> = {}): LogItem[] {
  const start = planStart(settings);
  if (!start || start > today) return items;
  const real = items.filter(i => !isPlanned(i));
  const bySlot = new Map<string, Food[]>();
  for (const item of real) {
    if (item.kind !== "food" || item.date < start || item.date > today) continue;
    const slot = slotOf(item); if (!slot) continue;
    const key = `${item.date}|${slot}`; bySlot.set(key, [...(bySlot.get(key) ?? []), item]);
  }
  const updated = new Map<string, Food>(), planned: Food[] = [];
  for (let date = start; date <= today; date = addDays(date, 1)) {
    for (const meal of planMeals(dayType(real, date, today, settings, chosen), settings)) {
      const { rest, foods } = applyChanges(meal, bySlot.get(`${date}|${meal.slot}`) ?? []);
      foods.forEach(f => updated.set(f.id, f));
      if (!rest) continue;
      const changed = rest.text !== meal.text;
      planned.push({ id: `plan-${date}-${meal.slot}`, kind: "food", date, createdAt: `${date}T00:00:00.000Z`, source: "diet-plan", notes: changed ? "这一餐计划里没换掉的部分" : "按固定饮食计划推定；吃了别的告诉 AI，只替换同类的那部分", description: rest.text, calories: rest.kcal, protein: rest.protein, ...(rest.fat != null ? { fat: rest.fat } : {}), ...(rest.carbs != null ? { carbs: rest.carbs } : {}), isEstimate: true, time: meal.slot });
    }
  }
  return [...real.map(i => updated.get(i.id) ?? i), ...planned];
}

