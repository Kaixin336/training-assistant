import { useMemo, useState } from "react";
import { addDays, dayOf, metricSeries, weekStart } from "@/lib/domain";
import { isStrengthDay } from "@/lib/diet";
import { deloadAdvice, dietReview, e1rm, energyBalance, lowReadinessDays, MUSCLES, muscleSets, plateaus, SETS_RANGE, strengthLevel, trainingLoad } from "@/lib/insights";
import { useApp } from "./context";
import { phaseLabels } from "./labels";
import { dayLabel, exerciseList, fmt, phaseComparison, signed, weightTrend } from "./metrics";
import { Section, useToast } from "./ui";

/* ── Strength ─────────────────────────────────────────────────────────── */
/** Strength level per exercise (best estimated max of the last 90 days ÷ bodyweight) and stalled lifts. */
export function useStrengthMarks() {
  const { data } = useApp();
  return useMemo(() => {
    const sex = data.settings.strengthSex ?? null;
    const bodyweight = weightTrend(data.items, data.today).avg ?? metricSeries(data.items, "weight").at(-1)?.value ?? null;
    const levels = new Map<string, NonNullable<ReturnType<typeof strengthLevel>> & { best: number }>();
    if (sex && bodyweight) for (const e of exerciseList(data.items)) {
      const best = Math.max(0, ...e.sessions.filter(w => w.date >= addDays(data.today, -90)).map(w => e1rm(w) ?? 0));
      const level = best ? strengthLevel(e.name, e.unit, best, bodyweight, sex) : null;
      if (level) levels.set(e.id, { ...level, best });
    }
    const stalls = new Map(plateaus(data.items, data.today, data.settings).map(p => [p.id, p]));
    return { levels, stalls };
  }, [data.items, data.today, data.settings]);
}

/* ── Weekly ───────────────────────────────────────────────────────────── */
export function TrainingCalendar({ week }: { week?: string } = {}) {
  const { data, setDate, actions } = useApp();
  const [monthOffset, setMonthOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const first = (() => { const d = new Date(`${data.today.slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - monthOffset); return d.toISOString().slice(0, 10); })();
  const month = first.slice(0, 7);
  // Whole weeks of the month, but not the empty weeks after this one.
  const lastOfMonth = (() => { const d = new Date(`${month}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); })();
  const lastWeek = weekStart([lastOfMonth, data.today].sort()[0]);
  const days = Array.from({ length: Math.round((Date.parse(lastWeek) - Date.parse(weekStart(first))) / 86400000) + 7 }, (_, i) => addDays(weekStart(first), i));
  const monday = weekStart(week ?? data.today);
  const thisWeek = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter(d => d <= data.today && isStrengthDay(data.items, d)).length;
  const label = monday === weekStart(data.today) ? "本周" : "这周";
  const goal = data.settings.trainingPattern === "free" ? null : 4;
  const cardio = new Set(data.items.filter(i => i.kind === "workout" && !i.sets.length).map(i => i.date));
  const cell = (d: string, other = false) => <button key={d} className={`cal-day${other ? " other" : ""}${isStrengthDay(data.items, d) ? " lift" : cardio.has(d) ? " move" : ""}${d === data.today ? " today" : ""}`} disabled={d > data.today} onClick={() => { setDate(d); actions.openTab("today"); }}>{Number(d.slice(8))}</button>;
  return <Section title="训练" meta={goal ? `${label} ${thisWeek} 次 · 目标 3–4 次` : `${label} ${thisWeek} 次`}>
    {!open ? <><div className="cal">{["一", "二", "三", "四", "五", "六", "日"].map(d => <span key={d} className="cal-dow">{d}</span>)}{Array.from({ length: 7 }, (_, i) => cell(addDays(monday, i)))}</div>
      <button className="more-link" onClick={() => setOpen(true)}>看整月</button></> : <>
    <div className="cal-head"><button className="icon-btn" aria-label="上个月" onClick={() => setMonthOffset(m => m + 1)}>‹</button><strong>{Number(month.slice(5))} 月</strong><button className="icon-btn" aria-label="下个月" disabled={monthOffset === 0} onClick={() => setMonthOffset(m => Math.max(0, m - 1))}>›</button></div>
    <div className="cal">{["一", "二", "三", "四", "五", "六", "日"].map(d => <span key={d} className="cal-dow">{d}</span>)}
      {days.map(d => cell(d, d.slice(0, 7) !== month))}
    </div>
    <div className="legend" style={{ marginTop: 8 }}><span><i className="dot-lift" />力量训练</span><span><i className="dot-move" />其他运动</span></div>
    <button className="more-link" onClick={() => { setOpen(false); setMonthOffset(0); }}>收起</button></>}
  </Section>;
}

export function MuscleVolume({ from, to }: { from: string; to: string }) {
  const { data } = useApp();
  const { sets, unknown } = muscleSets(data.items, from, to);
  const max = Math.max(SETS_RANGE[1] + 4, ...Object.values(sets));
  if (!Object.values(sets).some(Boolean)) return null;
  return <Section title="各肌群组数" meta={`建议 ${SETS_RANGE[0]}–${SETS_RANGE[1]} 组/周${unknown.length ? ` · ${unknown.length} 个动作未归类` : ""}`}>
    <div className="bars">{MUSCLES.map(m => {
      const value = sets[m], tone = value === 0 ? "none" : value < SETS_RANGE[0] / 2 ? "low" : value < SETS_RANGE[0] ? "mid" : value > SETS_RANGE[1] ? "high" : "ok";
      return <div key={m} className="bar-row"><span className="bar-label">{m}</span>
        <span className="bar-track"><span className="bar-band" style={{ left: `${SETS_RANGE[0] / max * 100}%`, width: `${(SETS_RANGE[1] - SETS_RANGE[0]) / max * 100}%` }} /><span className={`bar-fill ${tone}`} style={{ width: `${value / max * 100}%` }} /></span>
        <span className="bar-value">{fmt(value, 1)}</span></div>;
    })}</div>
  </Section>;
}

export function LoadAndCycle() {
  const { data } = useApp();
  const load = trainingLoad(data.items, data.today, data.settings);
  const stalls = plateaus(data.items, data.today, data.settings).length;
  const cycle = deloadAdvice(data.items, data.today, data.settings, { loadRatio: load.ratio, plateaus: stalls, lowReadinessDays: lowReadinessDays(data.items, data.today, data.settings) });
  const tone = load.tone === "low" ? "" : load.tone;
  const loadLabel = load.ratio === null ? "数据不足" : load.tone === "care" ? "骤增" : load.tone === "hold" ? "偏高" : load.tone === "low" ? "偏低" : "正常";
  return <Section title="负荷与周期">
    <div className="line"><span className={`dot ${tone || "good"}`} /><span className="line-label">负荷</span><span className="line-value">{loadLabel}{load.ratio !== null ? ` · ${load.ratio.toFixed(2)}×` : ""}</span></div>
    {load.tone && load.tone !== "good" && <p className="line-note">{load.text}</p>}
    <div className="line"><span className={`dot ${cycle.due ? "hold" : "good"}`} /><span className="line-label">周期</span><span className="line-value">{cycle.due ? "建议减载一周" : cycle.streak ? `连续 ${cycle.streak} 周` : "刚开始"}</span></div>
    {cycle.due && <p className="line-note">{cycle.text}</p>}
  </Section>;
}

/* ── Diet ─────────────────────────────────────────────────────────────── */
export function DietReviewCard() {
  const { data, actions } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const exercises = exerciseList(data.items).map(e => phaseComparison(e.sessions, data.settings, e.measure)).filter(Boolean);
  const strengthDown = exercises.length >= 2 && exercises.filter(c => c!.tone === "hold" && c!.ratio < .97).length >= 2;
  const review = dietReview(data.items, data.today, data.settings, { strengthDown, lowReadinessDays: lowReadinessDays(data.items, data.today, data.settings) });
  const energy = energyBalance(data.items, data.today);
  if (!review && !energy) return null;
  const adjustNow = data.settings.dietAdjustKcal ?? 0;
  async function apply(delta: number) {
    setBusy(true);
    try { await actions.saveSettings({ ...data.settings, dietAdjustKcal: Math.max(-600, Math.min(600, adjustNow + delta)) }); toast(`计划已${delta < 0 ? "减" : "加"} ${Math.abs(delta)} kcal/天`); }
    catch (cause) { toast(cause instanceof Error ? cause.message : "没改成"); } finally { setBusy(false); }
  }
  return <Section title="复盘" meta={energy ? `实际消耗 ${energy.expenditure.toLocaleString("zh-CN")} kcal/天` : undefined}>
    {review && <div className="line"><span className={`dot ${review.tone === "care" ? "care" : review.tone === "hold" ? "hold" : "good"}`} /><span className="line-value" style={{ marginLeft: 0 }}>{review.title}</span></div>}
    {review && (review.tone === "hold" || review.tone === "care") && <p className="line-note">{review.text}</p>}
    {review?.adjust && <button className="btn small" style={{ margin: "2px 0 8px 17px" }} disabled={busy} onClick={() => void apply(review.adjust!)}>{review.adjust < 0 ? `每天减 ${-review.adjust} kcal` : `每天加回 ${review.adjust} kcal`}</button>}
    {!review && energy && <p className="line-note" style={{ margin: 0 }}>按最近 3 周的摄入和体重变化反推。</p>}
    {adjustNow !== 0 && <p className="line-note">计划已调整 {signed(adjustNow, 0)} kcal/天，可在下方“饮食计划”里恢复。</p>}
  </Section>;
}

/* ── Body ─────────────────────────────────────────────────────────────── */
/** Weight, waist and strength since the phase began, read together. */
export function PhaseVerdict() {
  const { data } = useApp();
  const start = data.settings.phaseStart;
  if (!start || data.settings.phase === "unspecified") return null;
  const avg = (metric: "weight" | "waist", end: string) => { const rows = metricSeries(data.items, metric).filter(p => p.date > addDays(end, -7) && p.date <= end); return rows.length ? rows.reduce((n, r) => n + r.value, 0) / rows.length : null; };
  const firstAfter = (metric: "weight" | "waist") => metricSeries(data.items, metric).find(p => p.date >= addDays(start, -7))?.value ?? null;
  const weightNow = avg("weight", data.today), weightThen = avg("weight", addDays(start, 6)) ?? firstAfter("weight");
  const waistNow = metricSeries(data.items, "waist").at(-1)?.value ?? null, waistThen = firstAfter("waist");
  const comparisons = exerciseList(data.items).map(e => phaseComparison(e.sessions, data.settings, e.measure)).filter((c): c is NonNullable<typeof c> => !!c);
  const strength = comparisons.length ? comparisons.reduce((n, c) => n + c.ratio, 0) / comparisons.length - 1 : null;
  if (weightNow === null || weightThen === null || dayOf(data.today) === undefined || data.today < addDays(start, 10)) return null;
  const dw = weightNow - weightThen, dwaist = waistNow !== null && waistThen !== null ? waistNow - waistThen : null;
  const kept = strength === null ? null : strength > -.03;
  const fatLoss = data.settings.phase === "fat_loss";
  const verdict = fatLoss
    ? dw < -.3 && (dwaist ?? -1) < 0 && kept !== false ? "体重和腰围都在降，力量守住了：大概率掉的主要是脂肪。"
      : dw < -.3 && kept === false ? "体重在降但力量在掉：留意减得是否过快，蛋白质和睡眠是否够。"
      : "体重和腰围变化还不明显，再多观察一两周。"
    : dw > .2 && kept ? `体重在升、力量在涨${dwaist !== null && dwaist > 1.5 ? "，但腰围长得偏快，留意热量盈余是否过多" : ""}。`
      : "力量和体重的变化还不明显，增肌期以月为单位看。";
  return <Section title={`${phaseLabels[data.settings.phase]}以来`} meta={`${dayLabel(start)} 起`}>
    <div className="trio">
      <div><span>体重</span><strong>{signed(dw, 1)} kg</strong></div>
      <div><span>腰围</span><strong>{dwaist === null ? "—" : `${signed(dwaist, 1)} cm`}</strong></div>
      <div><span>力量</span><strong>{strength === null ? "—" : `${strength >= 0 ? "+" : "−"}${Math.abs(strength * 100).toFixed(0)}%`}</strong></div>
    </div>
    <p className={`verdict ${verdict.includes("留意") ? "hold" : ""}`}>{verdict}</p>
  </Section>;
}
