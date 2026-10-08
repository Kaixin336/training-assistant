import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { addDays, dailyTotals, dayDiff, workoutSessions, type AppData, type Food, type LogItem, type Settings } from "@/lib/domain";
import { dayType, isPlanned, planStart, type DayType } from "@/lib/diet";
import { dayBalance, nutritionTargets, readiness } from "@/lib/insights";
import { useApp } from "./context";
import { fmt, formatLoad, nextStep } from "./metrics";
import { Section, useToast } from "./ui";

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

/** The day's food on 今天 as one line — energy, protein, balance — opening the 饮食 page for the table. */
export function DietLink({ date }: { date: string }) {
  const { data, actions } = useApp();
  const foods = data.items.filter((i): i is Food => i.kind === "food" && i.date === date);
  const start = planStart(data.settings);
  if (!foods.length && !(start && start <= date)) return null;
  const totals = dailyTotals(data.items, date);
  const target = nutritionTargets(data.items, date, data.today, data.settings, data.dayTypes);
  const balance = dayBalance(data.items, date, data.today);
  const changed = foods.filter(f => !isPlanned(f)).length;
  const cutting = data.settings.phase !== "lean_gain";
  const n = (v: number) => Math.round(v).toLocaleString("zh-CN");
  return <Section title="饮食">
    <button className="hub" onClick={() => actions.openTab("diet")}>
      <span className="hub-main"><strong>{n(totals.calories)}</strong><small>{target.kcal ? ` / ${n(target.kcal)}` : ""} kcal</small>
        <span className="hub-sub">蛋白质 {n(totals.protein)} g{changed ? ` · 改了 ${changed} 处` : target.fromPlan ? " · 按计划" : ""}</span></span>
      {balance && <span className={`hub-value ${balance.diff < 0 === cutting ? "good" : "hold"}`}>{balance.diff <= 0 ? "缺口" : "盈余"} {n(Math.abs(balance.diff))}</span>}
      <ChevronRight className="row-chev" />
    </button>
  </Section>;
}

/** Morning state from HRV, resting heart rate, sleep and wrist temperature: one line, details on tap. */
export function ReadinessCard() {
  const { data } = useApp();
  const [open, setOpen] = useState(false);
  const result = readiness(data.items, data.today, data.settings);
  if (!result) return null;
  const details = [...result.reasons, ...result.good];
  return <button type="button" className={`state ${result.level}`} onClick={() => setOpen(!open)} aria-expanded={open}>
    <span className="state-dot" /><span className="state-main"><strong>{result.title}</strong><span>{result.advice}</span>
      {open && details.length > 0 && <span className="state-more">{details.join(" · ")}</span>}</span>
  </button>;
}

/**
 * Today's target for an exercise as one short line ("保持 62.5 kg × 8"); the full reasoning lives on the
 * exercise page. Based on the heaviest working set of the last session.
 */
export function exerciseTarget(items: LogItem[], id: string | null, date: string, unit: string, settings: Settings) {
  if (!id) return null;
  const before = workoutSessions(items, id).filter(w => w.date < date);
  const last = before[0];
  if (!last) return null;
  const step = nextStep(before, settings, unit);
  if (step?.tone === "care") return { text: "有疼痛记录 · 先别加重", tone: "care" };
  const sets = last.sets.filter(s => !s.isWarmup && s.reps !== null);
  if (!sets.length) return null;
  const top = [...sets].sort((a, b) => (b.weightKg ?? 0) - (a.weightKg ?? 0) || (b.reps ?? 0) - (a.reps ?? 0))[0];
  const load = top.weightKg !== null && unit !== "bodyweight" ? `${formatLoad(top.weightKg, unit)} kg × ` : "";
  const reps = top.reps!;
  const atTop = last.repMax !== null && sets.every(s => (s.reps ?? 0) >= last.repMax!) && !sets.some(s => s.feel === "Hard");
  if (settings.phase === "lean_gain") {
    if (atTop && top.weightKg !== null && unit !== "bodyweight") return { text: `加到 ${formatLoad(top.weightKg + 2.5, unit)} kg`, tone: "good" };
    return { text: `${load}${reps + 1}${load ? "" : " 次"}`, tone: "good" };
  }
  return { text: `保持 ${load}${reps}${load ? "" : " 次"}`, tone: "" };
}

/** Today's four numbers. A missing weigh-in or waist measurement becomes the reminder itself. */
export function TodayStrip({ date }: { date: string }) {
  const { data, actions } = useApp();
  const day = dailyTotals(data.items, date);
  const isToday = date === data.today;
  const monday = addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
  const waists = data.items.filter(i => i.kind === "metric" && i.metric === "waist" && i.date <= date).sort((a, b) => a.date.localeCompare(b.date));
  const waistWeek = new Set(waists.filter(i => i.date >= monday).map(i => i.date)).size;
  const lastWaist = waists.at(-1);
  const waistDue = isToday && waistWeek < 2 && (!lastWaist || dayDiff(date, lastWaist.date) >= 3);
  const latest = (match: (i: LogItem) => boolean) => data.items.filter(i => i.date === date && match(i)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  // Sleep comes from the Health Shortcut: once it has arrived that way, a morning without it means "run the sync".
  const sleepSyncs = data.items.some(i => i.kind === "health" && i.id.startsWith("health-") && i.sleepH != null && i.date >= addDays(date, -14));
  const sleepDue = isToday && day.sleep === null && sleepSyncs;
  const tiles = [
    { label: "体重", value: day.weight === null ? null : fmt(day.weight, 1), unit: "kg", due: isToday && day.weight === null, prefill: "体重 ", record: latest(i => i.kind === "metric" && i.metric === "weight") },
    { label: `腰围 ${waistWeek}/2`, value: lastWaist?.kind === "metric" ? fmt(lastWaist.value, 1) : null, unit: "cm", due: waistDue, prefill: "腰围 ", record: latest(i => i.kind === "metric" && i.metric === "waist") },
    { label: "睡眠", value: day.sleep === null ? null : fmt(day.sleep, 1), unit: "h", due: sleepDue, dueText: "同步", prefill: "睡眠 ", record: latest(i => i.kind === "health" && i.sleepH !== null), run: sleepDue ? () => { window.location.href = `shortcuts://run-shortcut?name=${encodeURIComponent("同步健康")}`; } : undefined },
    { label: "步数", value: day.steps === null ? null : day.steps.toLocaleString("zh-CN"), unit: "", due: false, prefill: "步数 ", record: latest(i => i.kind === "health" && i.steps !== null) },
  ];
  return <div className="stats">{tiles.map(t => <button key={t.label} className={`stat${t.value === null ? " empty" : ""}${t.due ? " due" : ""}`} onClick={() => "run" in t && t.run ? t.run() : t.record ? actions.edit(t.record) : actions.compose(t.prefill)}>
    <div className="stat-label">{t.label}</div>
    <div className="stat-value">{t.due && t.value === null ? ("dueText" in t && t.dueText) || "记一下" : t.value ?? "—"}{t.value !== null && t.unit && <span className="stat-unit">{t.unit}</span>}</div>
  </button>)}</div>;
}

/** The one reminder that is not a number on the strip: the Health sync has stopped. */
export function planCheckIns(data: AppData) {
  const out: { key: string; label: string }[] = [];
  if (data.healthLastSync && Date.now() - Date.parse(data.healthLastSync) > 36 * 3600_000) out.push({ key: "sync", label: `健康数据 ${Math.floor((Date.now() - Date.parse(data.healthLastSync)) / 86400_000)} 天没同步 · 立即同步` });
  return out;
}
