/**
 * A plan meal is a list of parts ("鸡蛋 2 个、燕麦 60g、牛奶 250ml"). A reported change swaps only the
 * parts of the same kind — meat for meat, staple for staple — so the rest of the meal stays as planned.
 * Kinds and rough values come from a small table of common foods; values are per 100 g / 100 ml.
 */
export type PartKind = "protein" | "egg" | "dairy" | "staple" | "veg" | "fruit" | "fat";
export type Nutrients = { kcal: number; protein: number; fat: number; carbs: number };

type Food = { id: string; match: RegExp; kind: PartKind; per100: [number, number, number, number]; piece?: number };
// More specific names first: 高蛋白牛奶 before 蛋, 瘦牛肉 before 牛肉, 鸡胸 before 鸡肉.
const FOODS: Food[] = [
  { id: "protein-milk", match: /高蛋白(?:牛)?奶|蛋白奶/, kind: "dairy", per100: [62, 6.5, 1.8, 5] },
  { id: "greek-yogurt", match: /希腊酸奶/, kind: "dairy", per100: [97, 9, 5, 4] },
  { id: "yogurt", match: /酸奶/, kind: "dairy", per100: [80, 4, 3, 10] },
  { id: "cheese", match: /奶酪|芝士/, kind: "dairy", per100: [350, 25, 27, 2], piece: 20 },
  { id: "milk", match: /牛奶|鲜奶|纯奶/, kind: "dairy", per100: [64, 3.3, 3.6, 4.8], piece: 250 },
  { id: "egg-white", match: /蛋清/, kind: "egg", per100: [52, 11, 0.2, 0.7], piece: 33 },
  { id: "egg", match: /鸡蛋|蛋/, kind: "egg", per100: [144, 12.6, 10, 0.8], piece: 50 },
  { id: "lean-beef", match: /瘦牛肉|牛里脊|牛腱/, kind: "protein", per100: [110, 21, 2.5, 0] },
  { id: "beef", match: /牛肉|牛排/, kind: "protein", per100: [140, 21, 6, 0] },
  { id: "chicken-breast", match: /鸡胸/, kind: "protein", per100: [120, 23, 2.5, 0] },
  { id: "chicken", match: /鸡腿|鸡肉|鸡块/, kind: "protein", per100: [170, 19, 10, 0], piece: 150 },
  { id: "turkey", match: /火鸡/, kind: "protein", per100: [115, 23, 2, 0] },
  { id: "lean-pork", match: /猪里脊|瘦猪肉|里脊/, kind: "protein", per100: [140, 21, 6, 0] },
  { id: "pork", match: /猪肉|排骨|五花/, kind: "protein", per100: [250, 17, 20, 0] },
  { id: "lamb", match: /羊肉/, kind: "protein", per100: [200, 19, 14, 0] },
  { id: "salmon", match: /三文鱼/, kind: "protein", per100: [200, 20, 13, 0] },
  { id: "fish", match: /鱼|虾/, kind: "protein", per100: [90, 19, 1, 0.5] },
  { id: "tofu", match: /豆腐/, kind: "protein", per100: [80, 8, 4.5, 2] },
  { id: "potato", match: /土豆|马铃薯/, kind: "staple", per100: [77, 2, 0.1, 17], piece: 170 },
  { id: "sweet-potato", match: /红薯|地瓜/, kind: "staple", per100: [86, 1.6, 0.1, 20], piece: 200 },
  { id: "rice", match: /米饭|白饭/, kind: "staple", per100: [116, 2.6, 0.3, 26], piece: 200 },
  { id: "raw-rice", match: /大米|生米/, kind: "staple", per100: [346, 7.4, 0.8, 77] },
  { id: "oats", match: /燕麦/, kind: "staple", per100: [380, 13, 7, 66] },
  { id: "bread", match: /面包|吐司/, kind: "staple", per100: [265, 9, 3.5, 49], piece: 30 },
  { id: "bun", match: /馒头/, kind: "staple", per100: [223, 7, 1, 47], piece: 100 },
  { id: "noodles", match: /面条|意面|面/, kind: "staple", per100: [130, 4.5, 0.8, 26], piece: 250 },
  { id: "corn", match: /玉米/, kind: "staple", per100: [112, 4, 1.2, 23], piece: 200 },
  { id: "mixed-veg", match: /混合蔬菜/, kind: "veg", per100: [65, 3, 0.5, 12] },
  { id: "broccoli", match: /西兰花|西蓝花/, kind: "veg", per100: [34, 2.8, 0.4, 7] },
  { id: "veg", match: /蔬菜|青菜|菠菜|生菜|沙拉|黄瓜|番茄|西红柿|白菜|菜/, kind: "veg", per100: [25, 1.5, 0.3, 4] },
  { id: "banana", match: /香蕉/, kind: "fruit", per100: [89, 1.1, 0.3, 23], piece: 120 },
  { id: "fruit", match: /水果|苹果|橙|梨|猕猴桃|奇异果|蓝莓|草莓|葡萄|桃/, kind: "fruit", per100: [55, 0.6, 0.2, 14], piece: 150 },
  { id: "avocado", match: /牛油果|鳄梨/, kind: "fat", per100: [160, 2, 15, 9], piece: 140 },
  { id: "peanut-butter", match: /花生酱/, kind: "fat", per100: [590, 25, 50, 20] },
  { id: "nuts", match: /坚果|杏仁|核桃|腰果|花生/, kind: "fat", per100: [600, 20, 52, 18] },
  { id: "oil", match: /橄榄油|油/, kind: "fat", per100: [884, 0, 100, 0] },
];

const DIGITS: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: .5 };
const UNIT = /(\d+(?:\.\d+)?|[一二两三四五六七八九十半]+)\s*(kg|公斤|g|克|ml|毫升|l|升|个|颗|只|根|片|杯|碗|勺|份)?/i;

export function splitParts(text: string): string[] {
  return text.split(/[、，,;；+＋\n]/).map(s => s.trim()).filter(Boolean);
}

const foodOf = (part: string) => FOODS.find(f => f.match.test(part)) ?? null;
export const kindOf = (part: string): PartKind | null => foodOf(part)?.kind ?? null;
export const kindsIn = (text: string) => new Set(splitParts(text).map(kindOf).filter((k): k is PartKind => k !== null));

/** Grams (or ml) in a part, from its number and unit; pieces use the food's usual piece weight. */
function amount(part: string, food: Food): number {
  const m = part.match(UNIT);
  if (!m) return food.piece ?? 100;
  const n = /\d/.test(m[1]) ? Number(m[1]) : [...m[1]].reduce((sum, ch) => ch === "十" ? (sum || 1) * 10 : sum + (DIGITS[ch] ?? 0), 0);
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "kg" || unit === "公斤" || unit === "l" || unit === "升") return n * 1000;
  if (unit === "g" || unit === "克" || unit === "ml" || unit === "毫升") return n;
  if (unit === "杯") return n * 250;
  if (unit === "碗") return n * 200;
  if (unit === "勺") return n * 15;
  if (unit) return n * (food.piece ?? 100);
  return food.piece && n <= 12 ? n * food.piece : n;
}

export function estimatePart(part: string): Nutrients | null {
  const food = foodOf(part);
  if (!food) return null;
  const grams = amount(part, food), [kcal, protein, fat, carbs] = food.per100.map(v => v * grams / 100);
  return { kcal, protein, fat, carbs };
}

/** The whole text's estimate, only when every part is a known food. */
export function estimateText(text: string): Nutrients | null {
  const parts = splitParts(text).map(estimatePart);
  if (!parts.length || parts.some(p => !p)) return null;
  return parts.reduce<Nutrients>((sum, p) => ({ kcal: sum.kcal + p!.kcal, protein: sum.protein + p!.protein, fat: sum.fat + p!.fat, carbs: sum.carbs + p!.carbs }), { kcal: 0, protein: 0, fat: 0, carbs: 0 });
}

/** Two descriptions of the same part: one contains the other, or both are the same food. */
export function samePart(a: string, b: string) {
  const x = a.replace(/\s/g, ""), y = b.replace(/\s/g, "");
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const fa = foodOf(x), fb = foodOf(y);
  return !!fa && fa === fb;
}

type MealValues = { kcal: number; protein: number; fat?: number | null; carbs?: number | null };
/**
 * Each part's share of the meal's (calibrated) values: the table's estimates scaled so the parts add up to the
 * meal exactly. Unknown parts split whatever the known ones leave.
 */
export function partShares(parts: string[], meal: MealValues): { kcal: number; protein: number; fat: number | null; carbs: number | null }[] {
  const estimates = parts.map(estimatePart);
  const share = (total: number | null | undefined, key: keyof Nutrients): (number | null)[] => {
    if (total == null) return parts.map(() => null);
    const known = estimates.reduce((n, e) => n + (e ? e[key] : 0), 0), unknown = estimates.filter(e => !e).length;
    const raw = estimates.map(e => e ? e[key] : unknown ? Math.max(0, total - known) / unknown : 0);
    const sum = raw.reduce((n, v) => n + v, 0);
    return raw.map(v => sum > 0 ? total * v / sum : total / parts.length);
  };
  const kcal = share(meal.kcal, "kcal"), protein = share(meal.protein, "protein"), fat = share(meal.fat, "fat"), carbs = share(meal.carbs, "carbs");
  return parts.map((_, i) => ({ kcal: kcal[i]!, protein: protein[i]!, fat: fat[i], carbs: carbs[i] }));
}
