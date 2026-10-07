import { useState } from "react";
import { addDays, dailyTotals, dayDiff, workoutSessions, type AppData, type Food, type LogItem, type Settings } from "@/lib/domain";
import { dayType, isPlanned, planStart, SLOTS, slotOf, type DayType } from "@/lib/diet";
import { nutritionTargets, readiness } from "@/lib/insights";
import { useApp } from "./context";
import { fmt, nextStep, sessionText } from "./metrics";
import { Note, Section, useToast } from "./ui";

export function useDayType(date: string): DayType {
  const { data } = useApp();
  return dayType(data.items, date, data.today, data.settings, data.dayTypes);
}

/** Top-left of the Today page: 训练日 / 休息日. One tap switches the day's plan meals and targets. */
export function DayTypeToggle({ date }: { date: string }) {
  const { data, actions } = useApp();
  const toast = useToast();
  const current = useDayType(date);
  const [pending, setPending] = useState<DayType | null>(null);
  const shown = pending ?? current;
  if (date > data.today) return null;
  async function flip() {
    const next: DayType = shown === "training" ? "rest" : "training";
    setPending(next);
    try { await actions.action("day_type", { item: { date, dayType: next } }); toast(next === "training" ? "已改成训练日" : "已改成休息日"); }
    catch (cause) { toast(cause instanceof Error ? cause.message : "没改成"); }
    finally { setPending(null); }
  }
  return <button type="button" className={`daytype ${shown}`} onClick={() => void flip()} aria-label={`${shown === "training" ? "训练日" : "休息日"}，点一下切换`}>
    {shown === "training" ? "训练日" : "休息日"}<span className="daytype-swap" aria-hidden="true">⇄</span>
  </button>;
}

/** The day's meals: the fixed plan where nothing else was reported, reported meals in their slot, extras after. */
export function MealsSection({ date }: { date: string }) {
  const { data, actions } = useApp();
  const foods = data.items.filter((i): i is Food => i.kind === "food" && i.date === date);
  const start = planStart(data.settings);
  const target = nutritionTargets(data.items, date, data.today, data.settings, data.dayTypes);
  if (!foods.length && !(start && start <= date)) return null;
  const totals = dailyTotals(data.items, date);
  const bySlot = SLOTS.map(slot => ({ slot, foods: foods.filter(f => (isPlanned(f) && f.time === slot) || (!isPlanned(f) && slotOf(f) === slot)) }));
  const extras = foods.filter(f => !isPlanned(f) && slotOf(f) === null);
  const row = (f: Food, label?: string) => <button key={f.id} className="entry" onClick={() => isPlanned(f) ? actions.compose(`${f.time}吃了：`) : actions.edit(f)}>
    <span className="entry-main">{label && <span className="meal-slot">{label}</span>}{f.description}
      <span className="entry-sub">{isPlanned(f) ? "按计划 · 吃了别的就点这里告诉我" : [f.isEstimate ? "估算" : "", f.time && !SLOTS.includes(f.time as never) ? f.time : ""].filter(Boolean).join(" · ") || "已记录"}</span></span>
    <span className="entry-value">{f.calories === null ? "—" : Math.round(f.calories)} kcal<small className="faint"> · {f.protein === null ? "—" : fmt(f.protein, 0)} g</small></span>
  </button>;
  const pct = (value: number, goal: number | null) => goal ? Math.min(100, Math.round(value / goal * 100)) : 0;
  return <Section title="饮食" meta={target.fromPlan ? `${target.type === "training" ? "训练日" : "休息日"}计划` : undefined}>
    {bySlot.map(({ slot, foods: list }) => list.map((f, i) => row(f, i === 0 ? slot : undefined)))}
    {extras.map(f => row(f, "加餐"))}
    <div className="total"><span>合计</span><span>{Math.round(totals.calories)}{target.kcal ? ` / ${target.kcal}` : ""} kcal · 蛋白质 {Math.round(totals.protein)}{target.protein ? ` / ${target.protein}` : ""} g</span></div>
    {target.kcal && <div className="meter" aria-hidden="true"><span style={{ width: `${pct(totals.calories, target.kcal)}%` }} /></div>}
  </Section>;
}

/** Morning state from HRV, resting heart rate, sleep and wrist temperature (when the shortcut sends them). */
export function ReadinessCard() {
  const { data } = useApp();
  const result = readiness(data.items, data.today, data.settings);
  if (!result) return null;
  const tone = result.level === "low" ? "care" : result.level === "fair" ? "hold" : "good";
  return <Note tone={tone}><strong>{result.title}</strong> · {result.advice}
    {(result.reasons.length > 0 || result.good.length > 0) && <span className="faint" style={{ display: "block", fontSize: 13 }}>{[...result.reasons, ...result.good].join("；")}</span>}
  </Note>;
}

/** "今天的目标" for an exercise: last session and the next step, phrased for today. */
export function exerciseTarget(items: LogItem[], id: string | null, date: string, unit: string, settings: Settings, today = date) {
  if (!id) return null;
  const before = workoutSessions(items, id).filter(w => w.date < date);
  if (!before.length) return null;
  const step = nextStep(before, settings, unit);
  if (!step) return null;
  const ago = dayDiff(date, before[0].date);
  return { last: `上次（${ago === 1 ? "昨天" : `${ago} 天前`}）${sessionText(before[0])}`, text: step.text.replace(/^下次/, date === today ? "今天" : "这次").replace(/；?下次/g, date === today ? "；今天" : "；这次"), tone: step.tone };
}

/** Reminders that follow the plan's habits: weigh every morning, waist twice a week, Health sync alive. */
export function planCheckIns(data: AppData) {
  const out: { key: string; label: string }[] = [];
  const has = (date: string, metric: string) => data.items.some(i => i.kind === "metric" && i.metric === metric && i.date === date);
  if (!has(data.today, "weight")) out.push({ key: "weight", label: "今天还没称体重" });
  const monday = addDays(data.today, -((new Date(`${data.today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const waistThisWeek = new Set(data.items.filter(i => i.kind === "metric" && i.metric === "waist" && i.date >= monday && i.date <= data.today).map(i => i.date)).size;
  const lastWaist = data.items.filter(i => i.kind === "metric" && i.metric === "waist").map(i => i.date).sort().at(-1);
  if (waistThisWeek < 2 && (!lastWaist || dayDiff(data.today, lastWaist) >= 3)) out.push({ key: "waist", label: `本周腰围 ${waistThisWeek}/2` });
  if (data.healthLastSync && Date.now() - Date.parse(data.healthLastSync) > 36 * 3600_000) out.push({ key: "sync", label: `健康数据 ${Math.floor((Date.now() - Date.parse(data.healthLastSync)) / 86400_000)} 天没同步` });
  return out;
}
