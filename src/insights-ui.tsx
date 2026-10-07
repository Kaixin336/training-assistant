import { useMemo, useState } from "react";
import { addDays, dayOf, metricSeries, weekStart } from "@/lib/domain";
import { isStrengthDay } from "@/lib/diet";
import { deloadAdvice, dietReview, e1rm, energyBalance, lowReadinessDays, LEVELS, MUSCLES, muscleSets, plateaus, SETS_RANGE, strengthLevel, trainingLoad } from "@/lib/insights";
import { useApp } from "./context";
import { phaseLabels } from "./labels";
import { dayLabel, exerciseList, fmt, phaseComparison, signed, weightTrend } from "./metrics";
import { Note, Section, useNav, useToast } from "./ui";

/* ── Strength ─────────────────────────────────────────────────────────── */
export function StrengthStandards() {
  const { data } = useApp();
  const nav = useNav();
  const sex = data.settings.strengthSex ?? null;
  const bodyweight = weightTrend(data.items, data.today).avg ?? metricSeries(data.items, "weight").at(-1)?.value ?? null;
  const rows = useMemo(() => exerciseList(data.items).flatMap(e => {
    const best = Math.max(0, ...e.sessions.filter(w => w.date >= addDays(data.today, -90)).map(w => e1rm(w) ?? 0));
    const level = sex && bodyweight && best ? strengthLevel(e.name, e.unit, best, bodyweight, sex) : null;
    return level ? [{ id: e.id, name: e.name, best, ...level }] : [];
  }), [data.items, data.today, sex, bodyweight]);
  if (!sex) return exerciseList(data.items).some(e => /卧推|深蹲|硬拉|推举|划船/.test(e.name))
    ? <Note>想看卧推、深蹲等处在什么水平？<button className="link" onClick={() => nav.push({ screen: "goals" })}>选择力量标准（男/女）</button></Note> : null;
  if (!rows.length) return null;
  return <Section title="力量水平" meta={`按体重 ${fmt(bodyweight, 1)} kg`}>
    <div className="list">{rows.map(r => <div key={r.id} className="list-row static">
      <div><div className="list-title">{r.name}</div><div className="list-sub">估算 1RM {fmt(r.best, 1)} kg · {r.ratio.toFixed(2)} 倍体重{r.next ? ` · 到「${r.next.level}」约 ${r.next.kg} kg` : ""}</div></div>
      <span />
      <div className="list-value"><strong className={`level l${LEVELS.indexOf(r.level)}`}>{r.level}</strong></div>
    </div>)}</div>
    <p className="footnote flush">参考常见的力量标准，按最近 90 天的最好成绩估算，只作参考。</p>
  </Section>;
}

export function PlateauNotes() {
  const { data } = useApp();
  const list = plateaus(data.items, data.today, data.settings);
  if (!list.length) return null;
  return <Section title="需要留意">{list.map(p => <Note key={p.id} tone={p.tone}>{p.text}</Note>)}</Section>;
}

/* ── Weekly ───────────────────────────────────────────────────────────── */
export function TrainingCalendar() {
  const { data, setDate, actions } = useApp();
  const [monthOffset, setMonthOffset] = useState(0);
  const first = (() => { const d = new Date(`${data.today.slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - monthOffset); return d.toISOString().slice(0, 10); })();
  const month = first.slice(0, 7);
  // Whole weeks of the month, but not the empty weeks after this one.
  const lastOfMonth = (() => { const d = new Date(`${month}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); })();
  const lastWeek = weekStart([lastOfMonth, data.today].sort()[0]);
  const days = Array.from({ length: Math.round((Date.parse(lastWeek) - Date.parse(weekStart(first))) / 86400000) + 7 }, (_, i) => addDays(weekStart(first), i));
  const monday = weekStart(data.today);
  const thisWeek = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter(d => d <= data.today && isStrengthDay(data.items, d)).length;
  const goal = data.settings.trainingPattern === "free" ? null : 4;
  const cardio = new Set(data.items.filter(i => i.kind === "workout" && !i.sets.length).map(i => i.date));
  return <Section title="训练日历" meta={goal ? `本周 ${thisWeek} 次 · 练一休一约 3–4 次` : `本周 ${thisWeek} 次`}>
    {goal && <div className="meter" aria-hidden="true"><span style={{ width: `${Math.min(100, thisWeek / goal * 100)}%`, background: "var(--accent)" }} /></div>}
    <div className="cal-head"><button className="icon-btn" aria-label="上个月" onClick={() => setMonthOffset(m => m + 1)}>‹</button><strong>{Number(month.slice(5))} 月</strong><button className="icon-btn" aria-label="下个月" disabled={monthOffset === 0} onClick={() => setMonthOffset(m => Math.max(0, m - 1))}>›</button></div>
    <div className="cal">{["一", "二", "三", "四", "五", "六", "日"].map(d => <span key={d} className="cal-dow">{d}</span>)}
      {days.map(d => <button key={d} className={`cal-day${d.slice(0, 7) !== month ? " other" : ""}${isStrengthDay(data.items, d) ? " lift" : cardio.has(d) ? " move" : ""}${d === data.today ? " today" : ""}`} disabled={d > data.today} onClick={() => { setDate(d); actions.openTab("today"); }}>{Number(d.slice(8))}</button>)}
    </div>
    <div className="legend" style={{ marginTop: 8 }}><span><i className="dot-lift" />力量训练</span><span><i className="dot-move" />其他运动</span></div>
  </Section>;
}

export function MuscleVolume({ from, to }: { from: string; to: string }) {
  const { data } = useApp();
  const { sets, unknown } = muscleSets(data.items, from, to);
  const max = Math.max(SETS_RANGE[1] + 4, ...Object.values(sets));
  if (!Object.values(sets).some(Boolean)) return null;
  return <Section title="各肌群训练组数" meta={`增肌常用 ${SETS_RANGE[0]}–${SETS_RANGE[1]} 组/周`}>
    <div className="bars">{MUSCLES.map(m => {
      const value = sets[m], tone = value === 0 ? "none" : value < SETS_RANGE[0] / 2 ? "low" : value < SETS_RANGE[0] ? "mid" : value > SETS_RANGE[1] ? "high" : "ok";
      return <div key={m} className="bar-row"><span className="bar-label">{m}</span>
        <span className="bar-track"><span className="bar-band" style={{ left: `${SETS_RANGE[0] / max * 100}%`, width: `${(SETS_RANGE[1] - SETS_RANGE[0]) / max * 100}%` }} /><span className={`bar-fill ${tone}`} style={{ width: `${value / max * 100}%` }} /></span>
        <span className="bar-value">{fmt(value, 1)}</span></div>;
    })}</div>
    <p className="footnote flush">主要发力的肌群算 1 组，辅助发力的算半组。{unknown.length ? `没认出部位的动作：${unknown.slice(0, 4).join("、")}。` : ""}减脂期组数少一些是正常的，重点是守住力量。</p>
  </Section>;
}

export function LoadAndCycle() {
  const { data } = useApp();
  const load = trainingLoad(data.items, data.today, data.settings);
  const stalls = plateaus(data.items, data.today, data.settings).length;
  const cycle = deloadAdvice(data.items, data.today, data.settings, { loadRatio: load.ratio, plateaus: stalls, lowReadinessDays: lowReadinessDays(data.items, data.today, data.settings) });
  const tone = load.tone === "low" ? "" : load.tone;
  return <Section title="负荷与周期">
    <div className="kv"><span>近 7 天负荷</span><strong>{load.acute}{load.ratio !== null && <small> · 是过去 4 周均值的 {load.ratio.toFixed(2)} 倍</small>}</strong></div>
    <Note tone={tone}>{load.text}</Note>
    <Note tone={cycle.due ? "hold" : ""}>{cycle.text}</Note>
    <p className="footnote flush">负荷按手表心率和时长计算（TRIMP）；没有心率的力量训练按组数估算。</p>
  </Section>;
}

/* ── Body ─────────────────────────────────────────────────────────────── */
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
  return <Section title="饮食计划复盘" meta={adjustNow ? `已调整 ${signed(adjustNow, 0)} kcal/天` : "按 14 天规则"}>
    {review && <Note tone={review.tone}><strong>{review.title}</strong> · {review.text}
      {review.adjust && <span style={{ display: "block", marginTop: 8 }}><button className="btn small" disabled={busy} onClick={() => void apply(review.adjust!)}>{review.adjust < 0 ? `每天减 ${-review.adjust} kcal` : `每天加回 ${review.adjust} kcal`}</button></span>}
    </Note>}
    {energy && <div className="kv"><span>按体重变化反推的每日消耗</span><strong>{energy.expenditure.toLocaleString("zh-CN")} kcal<small> · 吃 {energy.intake.toLocaleString("zh-CN")} · 每周 {signed(energy.perWeek, 2)} kg</small></strong></div>}
    {adjustNow !== 0 && <p className="footnote flush">调整平均分到午餐和晚餐（主要是土豆的量），可在“设置 › 饮食计划”恢复。</p>}
  </Section>;
}

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
    <Note tone={verdict.includes("留意") ? "hold" : verdict.includes("大概率") || verdict.includes("在涨") ? "good" : ""}>{verdict}</Note>
  </Section>;
}
